// "Ask Claude": answers a reviewer's question about some lines of a PR with a
// throwaway fork of the session that created it. The fork is never written to
// disk, so it shows up neither in /resume nor in the finder, and it can only read.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isExecutableFile } from './files.js';

const READ_ONLY_TOOLS = 'Read,Grep,Glob';
const ASK_TIMEOUT_MS = 3 * 60 * 1000;
const HISTORY_LIMIT = 20;
const FALLBACK_DIRS = [
  path.join(os.homedir(), '.local', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

/**
 * Resolves to the answer text, or rejects with an error to show next to the question.
 * `question`: { prUrl, path, side, startLine, endLine, code, text }; `history`: earlier answers.
 * `checkout`: where the PR's repository is checked out, readable even outside `cwd`.
 */
export function askSession(
  { sessionId, cwd, checkout = null, question, history = [] },
  { claude, timeoutMs = ASK_TIMEOUT_MS },
) {
  const outsideCwd = checkout && checkout !== cwd && !cwd.startsWith(`${checkout}/`);
  const args = [
    '--print',
    '--resume',
    sessionId,
    '--fork-session',
    '--no-session-persistence',
    ...(outsideCwd ? ['--add-dir', checkout] : []),
    '--tools',
    READ_ONLY_TOOLS,
    '--strict-mcp-config',
    // Hooks would run shell commands on every question.
    '--settings',
    JSON.stringify({ disableAllHooks: true }),
    '--permission-mode',
    'dontAsk',
    '--output-format',
    'json',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(claude, args, { cwd, env: claudeEnv(), stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`No answer after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = parseJson(stdout);
      if (code === 0 && result && !result.is_error && typeof result.result === 'string') {
        resolve(result.result.trim());
      } else {
        const detail = result?.result || stderr.trim() || `exit code ${code}`;
        reject(new Error(`Claude failed: ${detail}`));
      }
    });
    // If claude exits before reading the prompt, the close handler reports why.
    child.stdin.on('error', () => {});
    child.stdin.end(buildPrompt(question, history, checkout));
  });
}

export function buildPrompt(question, history, checkout = null) {
  const earlier = history
    .slice(-HISTORY_LIMIT)
    .map(
      (answer) =>
        `Question about ${lineLabel(answer)}: ${answer.question}\nYour answer: ${answer.answer}`,
    );
  return [
    `I'm reviewing ${question.prUrl}, the pull request you created, and have a question about some lines.`,
    'Answer briefly, in the language of my question, as plain text without headings.',
    'You can read and search files with Read, Grep and Glob, but have no shell and cannot change anything.',
    'The branch may have moved on since you created the PR, so read the files when the current state matters.',
    ...(checkout
      ? [`The PR's repository is checked out at ${checkout}, possibly on another branch.`]
      : []),
    ...(earlier.length > 0
      ? ['', 'Earlier questions in this review:', '', earlier.join('\n\n')]
      : []),
    '',
    `${lineLabel(question)}${question.code ? ':' : ''}`,
    ...(question.code ? ['```', question.code, '```'] : []),
    '',
    question.text,
  ].join('\n');
}

// "helper/host.js, new lines 9–11" ("old" for removed lines), "helper/host.js, old line 9 to
// new line 11" for a range across both sides, or "helper/host.js (the whole file)"
function lineLabel({ path: file, startSide, side, startLine, endLine }) {
  if (startLine === undefined) return `${file} (the whole file)`;
  const version = (lineSide) => (lineSide === 'L' ? 'old' : 'new');
  if (startSide && startSide !== side) {
    return `${file}, ${version(startSide)} line ${startLine} to ${version(side)} line ${endLine}`;
  }
  const lines = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
  return `${file}, ${version(side)} ${lines}`;
}

// lachs only finds sessions under ~/.claude, Claude Code's default, which applies only while
// CLAUDE_CONFIG_DIR is unset.
function claudeEnv() {
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  return env;
}

/**
 * The browser starts the host without your shell's PATH, so the claude binary is
 * looked up in your login shell's PATH once and remembered in `cacheFile`.
 */
export function claudeBinary({ cacheFile, shell = process.env.SHELL || '/bin/zsh' }) {
  const cached = readText(cacheFile);
  if (cached && isExecutableFile(cached)) return cached;
  const dirs = [...loginShellPath(shell), ...FALLBACK_DIRS];
  const found = dirs.map((dir) => path.join(dir, 'claude')).find(isExecutableFile);
  if (!found) throw new Error('Could not find the claude command in your login shell’s PATH.');
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, found);
  } catch {
    // Only a cache.
  }
  return found;
}

// `env` prints PATH colon-separated in every shell, fish included.
function loginShellPath(shell) {
  try {
    const env = execFileSync(shell, ['-l', '-c', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
    const line = env.split('\n').find((entry) => entry.startsWith('PATH='));
    return line ? line.slice('PATH='.length).split(':').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
