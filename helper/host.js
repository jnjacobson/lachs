// Native messaging host for the lachs extension.
// CLI for debugging: node helper/host.js lookup|open <pr-url>
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCreatorSession, normalizePrUrl } from './finder.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = os.homedir();
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const RUNNING_SESSIONS_DIR = path.join(HOME, '.claude', 'sessions');
const CONFIG_FILE = path.join(HOME, '.config', 'lachs', 'config.json');
const CLAUDE_WORKTREE = /^(.+?)\/\.claude\/worktrees\/([^/]+)/;
const LACHS_ZED = shellQuote(path.join(REPO, 'bin', 'lachs-zed'));
const DEFAULT_COMMANDS = {
  resume: `${LACHS_ZED} resume {sessionId} {cwd} {repoRoot}`,
  focus: `${LACHS_ZED} focus {repoRoot}`,
};

// Browsers start the host with arguments of their own, so anything else means native messaging.
const CLI_COMMANDS = ['lookup', 'open'];
const [command, prUrl] = process.argv.slice(2);
if (CLI_COMMANDS.includes(command)) {
  console.log(JSON.stringify(handle({ type: command, prUrl }), null, 2));
} else {
  readMessage(process.stdin)
    .then(handle)
    .catch(error => ({ error: error.message }))
    .then(writeMessage);
}

function handle(message) {
  const version = extensionVersion();
  if (message.type === 'lookup') return { version, session: lookup(message.prUrl) };
  if (message.type === 'open') return { version, ...open(message.prUrl) };
  throw new TypeError(`Unknown message type: ${message.type}`);
}

function lookup(prUrl) {
  const session = findCreatorSession(prUrl, { projectsDir: PROJECTS_DIR });
  return session && { ...session, running: isRunning(session.sessionId) };
}

function open(prUrl) {
  const session = lookup(prUrl);
  if (!session) return { status: 'not-found' };

  const { title } = session;
  if (!session.cwd) return { status: 'folder-missing', title };
  const repoRoot = mainCheckout(session.cwd, repoSlug(prUrl));
  const vars = { sessionId: session.sessionId, cwd: session.cwd, repoRoot };
  const where = place(session.cwd, repoRoot);
  if (session.running) {
    run(commands().focus, vars);
    return { status: 'running', title, place: where };
  }

  const cwdExists = fs.existsSync(session.cwd);
  if (!cwdExists && !fs.existsSync(repoRoot)) return { status: 'folder-missing', title };
  run(commands().resume, { ...vars, cwd: cwdExists ? session.cwd : repoRoot });
  return { status: 'opened', title, place: where, inMainCheckout: !cwdExists };
}

// "core" or "core (worktree pr-a-payment-callers)"
function place(cwd, repoRoot) {
  const project = path.basename(repoRoot);
  const claudeWorktree = cwd.match(CLAUDE_WORKTREE);
  if (claudeWorktree) return `${project} (worktree ${claudeWorktree[2]})`;
  const insideProject = cwd === repoRoot || cwd.startsWith(`${repoRoot}/`);
  return insideProject ? project : `${project} (worktree ${path.basename(cwd)})`;
}

function isRunning(sessionId) {
  return fs.globSync('*.json', { cwd: RUNNING_SESSIONS_DIR }).some(name => {
    const entry = readJson(path.join(RUNNING_SESSIONS_DIR, name));
    return entry?.sessionId === sessionId && isAlive(entry.pid, entry.procStart);
  });
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
    const gitDir = execFileSync('/usr/bin/git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (gitDir.endsWith('/.git')) return path.dirname(gitDir);
  } catch {
    // The folder is gone or not a git checkout.
  }
  return knownCheckout(repo) ?? cwd;
}

function knownCheckout(repo) {
  const repoPaths = readJson(path.join(HOME, '.claude.json'))?.githubRepoPaths ?? {};
  const key = Object.keys(repoPaths).find(slug => slug.toLowerCase() === repo);
  return (repoPaths[key] ?? []).find(dir => !CLAUDE_WORKTREE.test(dir) && fs.existsSync(dir)) ?? null;
}

function repoSlug(prUrl) {
  return normalizePrUrl(prUrl).split('/').slice(3, 5).join('/');
}

function commands() {
  return { ...DEFAULT_COMMANDS, ...readJson(CONFIG_FILE) };
}

// The reply to the browser is already on its way, so a failed spawn can only be logged.
function run(template, vars) {
  const shellCommand = template.replace(/\{(sessionId|cwd|repoRoot)\}/g, (_, name) => shellQuote(vars[name]));
  spawn('/bin/sh', ['-c', shellCommand], { detached: true, stdio: 'ignore' })
    .on('error', error => console.error(error))
    .unref();
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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function squash(text) {
  return text.trim().replace(/\s+/g, ' ');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
