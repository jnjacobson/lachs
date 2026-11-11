// Native messaging host for the lachs extension.
// CLI for debugging: node helper/host.js lookup|open <pr-url>
//                    node helper/host.js ask <pr-url> <file> <line>[-<line>]|file <question>
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discardAnswer, listAnswers, saveAnswer } from './answers.js';
import { askSession, claudeBinary } from './ask.js';
import { isExecutableFile, readJson } from './files.js';
import { findCreatorSession, normalizePrUrl } from './finder.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = os.homedir();
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const INDEX_FILE = path.join(HOME, '.cache', 'lachs', 'index.json');
const CLAUDE_PATH_FILE = path.join(HOME, '.cache', 'lachs', 'claude-path');
const ANSWERS_DIR = path.join(HOME, '.local', 'state', 'lachs', 'answers');
const RUNNING_SESSIONS_DIR = path.join(HOME, '.claude', 'sessions');
const CONFIG_FILE = path.join(HOME, '.config', 'lachs', 'config.json');
const CLAUDE_WORKTREE = /^(.+?)\/\.claude\/worktrees\/([^/]+)/;
// An app is an executable, bin/lachs-<name>, picked by "app" in the config. See README.md.
const APPS_DIR = path.join(REPO, 'bin');
const DEFAULT_APP = 'terminal';
const APP_TIMEOUT_MS = 5000;

// Browsers start the host with arguments of their own, so anything else means native messaging.
const CLI_COMMANDS = ['lookup', 'open', 'ask'];
const [command, prUrl, ...rest] = process.argv.slice(2);
if (CLI_COMMANDS.includes(command)) {
  console.log(JSON.stringify(await handle(cliMessage(command, prUrl, rest)), null, 2));
} else {
  readMessage(process.stdin)
    .then(handle)
    .catch((error) => ({ error: error.message }))
    .then(writeMessage);
}

async function handle(message) {
  const version = extensionVersion();
  if (message.type === 'lookup') {
    const session = lookup(message.prUrl);
    const answers = session ? listAnswers(ANSWERS_DIR, message.prUrl) : [];
    return { version, session, answers };
  }
  if (message.type === 'open') return { version, ...(await open(message.prUrl)) };
  if (message.type === 'ask') return { version, ...(await ask(message)) };
  if (message.type === 'discard') {
    discardAnswer(ANSWERS_DIR, message.prUrl, message.id);
    return { version };
  }
  throw new TypeError(`Unknown message type: ${message.type}`);
}

function lookup(prUrl) {
  const session = findCreatorSession(prUrl, { projectsDir: PROJECTS_DIR, indexFile: INDEX_FILE });
  if (!session) return null;
  const pid = runningPid(session.sessionId);
  return { ...session, running: pid !== null, pid };
}

async function open(prUrl) {
  const session = lookup(prUrl);
  if (!session) return { status: 'not-found' };

  const { title } = session;
  if (!session.cwd) return { status: 'folder-missing', title };
  const app = configuredApp();
  const repoRoot = mainCheckout(session.cwd, repoSlug(prUrl));
  const where = place(session.cwd, repoRoot);
  if (session.running) {
    const hint = await runApp(app, [
      'focus',
      session.sessionId,
      session.cwd,
      repoRoot,
      String(session.pid),
    ]);
    return { status: 'running', title, place: where, hint };
  }

  const cwdExists = fs.existsSync(session.cwd);
  if (!cwdExists && !fs.existsSync(repoRoot)) return { status: 'folder-missing', title };
  const hint = await runApp(app, [
    'resume',
    session.sessionId,
    cwdExists ? session.cwd : repoRoot,
    repoRoot,
  ]);
  return { status: 'opened', title, place: where, inMainCheckout: !cwdExists, hint };
}

// A failed answer is { failed }, not { error }: the helper itself works fine.
async function ask(message) {
  const askedAt = new Date().toISOString();
  try {
    const question = questionFrom(message);
    const session = lookup(question.prUrl);
    if (!session) return { failed: 'The session that created this PR is no longer on this Mac.' };
    const repo = repoSlug(question.prUrl);
    const fallback = session.cwd && !fs.existsSync(session.cwd) && mainCheckout(session.cwd, repo);
    const cwd = fallback && fs.existsSync(fallback) ? fallback : session.cwd;
    if (!cwd || !fs.existsSync(cwd))
      return { failed: `The folder of “${session.title}” no longer exists.` };
    const answer = await askSession(
      {
        sessionId: session.sessionId,
        cwd,
        checkout: repoCheckout(session, cwd, repo),
        question,
        history: listAnswers(ANSWERS_DIR, question.prUrl),
      },
      { claude: claudeBinary({ cacheFile: CLAUDE_PATH_FILE }) },
    );
    const { prUrl, text: asked, ...where } = question;
    return {
      answer: saveAnswer(ANSWERS_DIR, prUrl, { askedAt, ...where, question: asked, answer }),
    };
  } catch (error) {
    return { failed: error.message };
  }
}

// A question about lines has a side (that of the last line) and startSide (differs only for a
// range across both sides); one about a whole file has neither, nor lines.
function questionFrom({
  prUrl,
  path: file,
  side,
  startSide = side,
  startLine,
  endLine,
  code,
  text,
}) {
  const aboutLines = startLine !== undefined || endLine !== undefined;
  const validLines =
    ['L', 'R'].includes(side) &&
    ['L', 'R'].includes(startSide) &&
    Number.isInteger(startLine) &&
    Number.isInteger(endLine);
  const valid =
    typeof file === 'string' &&
    file !== '' &&
    (!aboutLines || validLines) &&
    typeof code === 'string' &&
    typeof text === 'string' &&
    text.trim() !== '';
  if (!valid) throw new TypeError('Incomplete question');
  const lines = aboutLines ? { startSide, side, startLine, endLine } : {};
  return { prUrl: normalizePrUrl(prUrl), path: file, ...lines, code, text: text.trim() };
}

// The CLI asks about the new version of the lines, or "file" for the whole file,
// and sends no code; Claude reads the file.
function cliMessage(type, prUrl, [file, lines, ...words]) {
  if (type !== 'ask') return { type, prUrl };
  const question = { type, prUrl, path: file, code: '', text: words.join(' ') };
  if (lines === 'file') return question;
  if (!/^\d+(-\d+)?$/.test(lines ?? '')) {
    throw new Error('Usage: ask <pr-url> <file> <line>[-<line>]|file <question>');
  }
  const [startLine, endLine = startLine] = lines.split('-').map(Number);
  return { ...question, side: 'R', startLine, endLine };
}

// "app" is a name from bin/lachs-<name> or a path to your own executable.
function configuredApp() {
  const config = readJson(CONFIG_FILE) ?? {};
  if ('resume' in config || 'focus' in config) {
    throw new Error(
      `"resume" and "focus" in ${CONFIG_FILE} are no longer supported. Move the command into a script and set "app" to its path.`,
    );
  }
  const name = config.app ?? DEFAULT_APP;
  const executable =
    typeof name === 'string' &&
    (name.includes('/') ? appPath(name) : path.join(APPS_DIR, `lachs-${name}`));
  if (executable && isExecutableFile(executable)) return executable;
  const apps = fs.globSync('lachs-*', { cwd: APPS_DIR }).map((file) => file.slice('lachs-'.length));
  throw new Error(
    `Unknown app ${JSON.stringify(name)} in ${CONFIG_FILE}. Use one of: ${apps.join(', ')}, or a path to an executable.`,
  );
}

// "~/bin/x" and paths relative to the home folder work too.
function appPath(name) {
  return path.resolve(HOME, name.replace(/^~(?=\/)/, HOME));
}

// Resolves to what the app printed, a hint for the notification, or rejects when it fails.
// An app still running after APP_TIMEOUT_MS keeps running, and its output so far counts.
function runApp(app, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(app, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const done = () => resolve(stdout.trim() || null);
    const timer = setTimeout(() => {
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      done();
    }, APP_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else
        reject(new Error(`${path.basename(app)} failed: ${stderr.trim() || `exit code ${code}`}`));
    });
  });
}

// "core" or "core (worktree pr-a-payment-callers)"
function place(cwd, repoRoot) {
  const project = path.basename(repoRoot);
  const claudeWorktree = cwd.match(CLAUDE_WORKTREE);
  if (claudeWorktree) return `${project} (worktree ${claudeWorktree[2]})`;
  const insideProject = cwd === repoRoot || cwd.startsWith(`${repoRoot}/`);
  return insideProject ? project : `${project} (worktree ${path.basename(cwd)})`;
}

function runningPid(sessionId) {
  for (const name of fs.globSync('*.json', { cwd: RUNNING_SESSIONS_DIR })) {
    const entry = readJson(path.join(RUNNING_SESSIONS_DIR, name));
    if (entry?.sessionId === sessionId && isAlive(entry.pid, entry.procStart)) return entry.pid;
  }
  return null;
}

// ps fails for a dead pid. procStart guards against a reused pid; Claude Code writes it in UTC.
function isAlive(pid, procStart) {
  try {
    const started = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { TZ: 'UTC', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return !procStart || squash(started) === squash(procStart);
  } catch {
    return false;
  }
}

function mainCheckout(cwd, repo) {
  const claudeWorktree = cwd.match(CLAUDE_WORKTREE);
  if (claudeWorktree) return claudeWorktree[1];
  try {
    const gitDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (gitDir.endsWith('/.git')) return path.dirname(gitDir);
  } catch {
    // The folder is gone or not a git checkout.
  }
  return knownCheckout(repo) ?? cwd;
}

// A session can work in another repo than its cwd, e.g. after `cd`, so the fork gets the PR's
// checkout too: the cwd if it is one, else the latest folder of that name the transcript mentions.
function repoCheckout(session, cwd, repo) {
  const inCwd = checkoutOf(cwd, repo);
  if (inCwd) return inCwd;
  for (const dir of mentionedFolders(session.sessionId, repo.split('/')[1])) {
    const checkout = fs.existsSync(dir) && checkoutOf(dir, repo);
    if (checkout) return checkout;
  }
  return knownCheckout(repo);
}

// Folders named `name` (any case, the PR URL is lowercased) in the transcript's paths,
// most recently mentioned first.
function mentionedFolders(sessionId, name) {
  const [transcript] = fs.globSync(`*/${sessionId}.jsonl`, { cwd: PROJECTS_DIR });
  if (!transcript) return [];
  const text = fs.readFileSync(path.join(PROJECTS_DIR, transcript), 'utf8');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const folder = new RegExp(`/[^\\s"'\\\\:]*/${escaped}(?=[/\\s"'\\\\]|$)`, 'gi');
  const folders = [...new Set((text.match(folder) ?? []).reverse())];
  return folders;
}

function checkoutOf(dir, repo) {
  try {
    const origin = git(dir, ['remote', 'get-url', 'origin']).toLowerCase();
    if (origin.replace(/\.git$/, '').match(/github\.com[:/](.+)$/)?.[1] === repo) {
      return git(dir, ['rev-parse', '--show-toplevel']);
    }
  } catch {
    // Not a git checkout.
  }
  return null;
}

// Throws when git fails, e.g. because dir is gone or not a checkout.
function git(dir, args) {
  return execFileSync('/usr/bin/git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function knownCheckout(repo) {
  const repoPaths = readJson(path.join(HOME, '.claude.json'))?.githubRepoPaths ?? {};
  const key = Object.keys(repoPaths).find((slug) => slug.toLowerCase() === repo);
  return (
    (repoPaths[key] ?? []).find((dir) => !CLAUDE_WORKTREE.test(dir) && fs.existsSync(dir)) ?? null
  );
}

function repoSlug(prUrl) {
  return normalizePrUrl(prUrl).split('/').slice(3, 5).join('/');
}

function extensionVersion() {
  return readJson(path.join(REPO, 'extension', 'manifest.json'))?.version ?? null;
}

async function readMessage(stream) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      return JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32LE(0)).toString('utf8'));
    }
  }
  throw new Error('No message on stdin');
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
}

function squash(text) {
  return text.trim().replace(/\s+/g, ' ');
}
