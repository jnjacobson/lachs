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
// An app is an executable, bin/lachs-<name>, picked by "app" in the config. See README.md.
const APPS_DIR = path.join(REPO, 'bin');
const DEFAULT_APP = 'zed';
const APP_TIMEOUT_MS = 5000;

// Browsers start the host with arguments of their own, so anything else means native messaging.
const CLI_COMMANDS = ['lookup', 'open'];
const [command, prUrl] = process.argv.slice(2);
if (CLI_COMMANDS.includes(command)) {
  console.log(JSON.stringify(await handle({ type: command, prUrl }), null, 2));
} else {
  readMessage(process.stdin)
    .then(handle)
    .catch(error => ({ error: error.message }))
    .then(writeMessage);
}

async function handle(message) {
  const version = extensionVersion();
  if (message.type === 'lookup') return { version, session: lookup(message.prUrl) };
  if (message.type === 'open') return { version, ...(await open(message.prUrl)) };
  throw new TypeError(`Unknown message type: ${message.type}`);
}

function lookup(prUrl) {
  const session = findCreatorSession(prUrl, { projectsDir: PROJECTS_DIR });
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
    const hint = await runApp(app, ['focus', session.sessionId, session.cwd, repoRoot, String(session.pid)]);
    return { status: 'running', title, place: where, hint };
  }

  const cwdExists = fs.existsSync(session.cwd);
  if (!cwdExists && !fs.existsSync(repoRoot)) return { status: 'folder-missing', title };
  const hint = await runApp(app, ['resume', session.sessionId, cwdExists ? session.cwd : repoRoot, repoRoot]);
  return { status: 'opened', title, place: where, inMainCheckout: !cwdExists, hint };
}

// "app" is a name from bin/lachs-<name> or a path to your own executable.
function configuredApp() {
  const config = readJson(CONFIG_FILE) ?? {};
  if ('resume' in config || 'focus' in config) {
    throw new Error(`"resume" and "focus" in ${CONFIG_FILE} are no longer supported. Move the command into a script and set "app" to its path.`);
  }
  const name = config.app ?? DEFAULT_APP;
  const executable = typeof name === 'string' && (name.includes('/') ? appPath(name) : path.join(APPS_DIR, `lachs-${name}`));
  if (executable && isExecutableFile(executable)) return executable;
  const apps = fs.globSync('lachs-*', { cwd: APPS_DIR }).map(file => file.slice('lachs-'.length));
  throw new Error(`Unknown app ${JSON.stringify(name)} in ${CONFIG_FILE}. Use one of: ${apps.join(', ')}, or a path to an executable.`);
}

// "~/bin/x" and paths relative to the home folder work too.
function appPath(name) {
  return path.resolve(HOME, name.replace(/^~(?=\/)/, HOME));
}

function isExecutableFile(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// Resolves to what the app printed, a hint for the notification, or rejects when it fails.
// An app still running after APP_TIMEOUT_MS keeps running, and its output so far counts.
function runApp(app, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(app, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    const done = () => resolve(stdout.trim() || null);
    const timer = setTimeout(() => {
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      done();
    }, APP_TIMEOUT_MS);
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) done();
      else reject(new Error(`${path.basename(app)} failed: ${stderr.trim() || `exit code ${code}`}`));
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
