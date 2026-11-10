import fs from 'node:fs';
import path from 'node:path';

const PR_CREATE_COMMAND = /\bgh\s+pr\s+create\b/;
const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi;
const NEWLINE = 0x0a;

export function normalizePrUrl(url) {
  const match = new RegExp(PR_URL.source, 'i').exec(url);
  if (!match) throw new TypeError(`Not a pull request URL: ${url}`);
  return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`.toLowerCase();
}

/**
 * Finds the session that ran `gh pr create` for this PR.
 * Returns null when no transcript on this machine created it.
 */
export function findCreatorSession(prUrl, { projectsDir }) {
  const target = normalizePrUrl(prUrl);
  let creator = null;
  for (const file of fs.globSync('*/*.jsonl', { cwd: projectsDir })) {
    const transcript = path.join(projectsDir, file);
    const linkTimes = prLinkTimes(transcript, target);
    if (linkTimes.length === 0) continue;
    const createdTimes = creationTimes(transcript, target);
    if (createdTimes.length === 0) continue;
    // Forks copy the creation, but no pr-links, so the original linked the PR first.
    const linkedAt = Math.min(...linkTimes);
    if (!creator || linkedAt < creator.linkedAt) {
      creator = { transcript, linkedAt, createdAt: Math.min(...createdTimes) };
    }
  }
  if (!creator) return null;

  const session = followHandoffs(creator.transcript);
  return {
    sessionId: session.sessionId,
    title: session.title,
    cwd: session.cwd,
    createdAt: new Date(creator.createdAt).toISOString(),
  };
}

function prLinkTimes(file, target) {
  return recordsContaining(fs.readFileSync(file), '"prUrl":"')
    .filter((record) => record.type === 'pr-link' && record.prUrl?.toLowerCase() === target)
    .map((record) => Date.parse(record.timestamp));
}

function creationTimes(file, target) {
  const subagentDir = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
  const subagentFiles = fs
    .globSync('*.jsonl', { cwd: subagentDir })
    .map((name) => path.join(subagentDir, name));
  const times = [];
  for (const transcript of [file, ...subagentFiles]) {
    const createCommandIds = new Set();
    const lines = (line) => PR_CREATE_COMMAND.test(line) || line.includes('"gitOperation"');
    for (const record of readRecords(transcript, lines)) {
      for (const block of contentBlocks(record)) {
        if (
          record.type === 'assistant' &&
          block.type === 'tool_use' &&
          block.name === 'Bash' &&
          PR_CREATE_COMMAND.test(block.input?.command ?? '')
        ) {
          createCommandIds.add(block.id);
        }
        if (
          record.type === 'user' &&
          block.type === 'tool_result' &&
          createCommandIds.has(block.tool_use_id) &&
          reportsCreatedPr(record, target)
        ) {
          times.push(Date.parse(record.timestamp));
        }
      }
    }
  }
  return times;
}

// One gh call can create several PRs; gitOperation only names the last one.
function reportsCreatedPr(record, target) {
  const result = record.toolUseResult;
  if (result?.gitOperation?.pr?.action !== 'created') return false;
  const urls = (result.stdout ?? '').match(PR_URL) ?? [];
  return urls.some((url) => url.toLowerCase() === target);
}

function followHandoffs(file) {
  const seen = new Set();
  let session = readSession(file);
  while (session.continuedIn && !seen.has(session.continuedIn)) {
    seen.add(session.continuedIn);
    const next = path.join(path.dirname(file), `${session.continuedIn}.jsonl`);
    if (!fs.existsSync(next)) break;
    const nextSession = readSession(next);
    // A handoff that never ran leaves a transcript with a title but no conversation, so no cwd.
    if (!nextSession.cwd) break;
    file = next;
    session = nextSession;
  }
  return session;
}

function readSession(file) {
  const buffer = fs.readFileSync(file);
  const last = (marker) => recordsContaining(buffer, marker).at(-1);
  const sessionId = path.basename(file, '.jsonl');
  return {
    sessionId,
    title:
      last('"type":"custom-title"')?.customTitle || last('"type":"ai-title"')?.aiTitle || sessionId,
    cwd: lastCwd(buffer),
    continuedIn: last('"type":"continued-in"')?.continuedInSessionId ?? null,
  };
}

function lastCwd(buffer) {
  const marker = Buffer.from('"cwd":"');
  for (let at = buffer.lastIndexOf(marker); at !== -1; at = buffer.lastIndexOf(marker, at - 1)) {
    const cwd = lineAt(buffer, at).record?.cwd;
    if (cwd) return cwd;
  }
  return null;
}

// Searching the raw bytes avoids decoding and splitting whole transcripts.
function recordsContaining(buffer, text) {
  const marker = Buffer.from(text);
  const records = [];
  for (let at = buffer.indexOf(marker); at !== -1; ) {
    const { record, end } = lineAt(buffer, at);
    if (record) records.push(record);
    at = buffer.indexOf(marker, end);
  }
  return records;
}

function lineAt(buffer, at) {
  const start = buffer.lastIndexOf(NEWLINE, at) + 1;
  const newline = buffer.indexOf(NEWLINE, at);
  const end = newline === -1 ? buffer.length : newline;
  return { record: parse(buffer.subarray(start, end).toString('utf8')), end };
}

function* readRecords(file, lineFilter) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!lineFilter(line)) continue;
    const record = parse(line);
    if (record) yield record;
  }
}

function contentBlocks(record) {
  const content = record.message?.content;
  return Array.isArray(content) ? content : [];
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
