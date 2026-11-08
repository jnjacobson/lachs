import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { findCreatorSession } from '../helper/finder.js';

const PR = 'https://github.com/acme/shop/pull/196';
const OTHER_PR = 'https://github.com/acme/shop/pull/195';
const CREATE = 'gh pr create --draft --title "Add cart"';

let projectsDir;

beforeEach(() => {
  projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lachs-test-'));
});

afterEach(() => {
  fs.rmSync(projectsDir, { recursive: true, force: true });
});

function writeTranscript(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
}

function sessionFile(sessionId, project = '-Users-jan-shop') {
  return path.join(projectsDir, project, `${sessionId}.jsonl`);
}

function createCommand(id, at, command = CREATE) {
  return {
    type: 'assistant',
    timestamp: at,
    cwd: '/Users/jan/shop',
    message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  };
}

function createResult(id, at, urls, action = 'created') {
  const stdout = urls.join('\n');
  return {
    type: 'user',
    timestamp: at,
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: stdout }] },
    toolUseResult: { stdout, stderr: '', gitOperation: { pr: { url: urls.at(-1), action } } },
  };
}

function prLink(url, at) {
  return { type: 'pr-link', prUrl: url, timestamp: at };
}

function creation(at, urls = [PR]) {
  return [createCommand('toolu_1', at), prLink(urls.at(-1), at), createResult('toolu_1', at, urls)];
}

test('finds the session that created the PR', () => {
  writeTranscript(sessionFile('s1'), [
    ...creation('2026-10-09T12:55:17.000Z'),
    { type: 'ai-title', aiTitle: 'Add cart', sessionId: 's1' },
    { type: 'custom-title', customTitle: 'cart work', sessionId: 's1' },
    { type: 'user', cwd: '/Users/jan/shop/.claude/worktrees/cart', message: { content: 'thanks' } },
  ]);

  assert.deepEqual(findCreatorSession(PR, { projectsDir }), {
    sessionId: 's1',
    title: 'cart work',
    cwd: '/Users/jan/shop/.claude/worktrees/cart',
    createdAt: '2026-10-09T12:55:17.000Z',
  });
});

test('matches the PR URL regardless of case', () => {
  writeTranscript(sessionFile('s1'), creation('2026-10-09T12:55:17.000Z'));

  assert.equal(findCreatorSession(PR.replace('acme', 'ACME'), { projectsDir }).sessionId, 's1');
});

test('opens the parent session when a subagent created the PR', () => {
  writeTranscript(sessionFile('parent'), [prLink(PR, '2026-10-30T12:44:23.030Z')]);
  writeTranscript(path.join(projectsDir, '-Users-jan-shop', 'parent', 'subagents', 'agent-a1.jsonl'), [
    createCommand('toolu_1', '2026-10-30T12:44:18.000Z'),
    createResult('toolu_1', '2026-10-30T12:44:23.000Z', [PR]),
  ]);

  assert.equal(findCreatorSession(PR, { projectsDir }).sessionId, 'parent');
});

test('ignores a fork that copied the creation', () => {
  writeTranscript(sessionFile('original'), creation('2026-10-16T11:11:21.000Z'));
  writeTranscript(sessionFile('fork'), [
    createCommand('toolu_1', '2026-10-16T11:11:21.000Z'),
    createResult('toolu_1', '2026-10-16T11:11:21.000Z', [PR]),
    prLink(PR, '2026-10-20T09:00:00.000Z'),
  ]);

  assert.equal(findCreatorSession(PR, { projectsDir }).sessionId, 'original');
});

test('ignores sessions that only touched the PR', () => {
  writeTranscript(sessionFile('reviewer'), [prLink(PR, '2026-10-20T09:00:00.000Z')]);

  assert.equal(findCreatorSession(PR, { projectsDir }), null);
});

test('prefers the earliest creation over a later false one', () => {
  writeTranscript(sessionFile('real'), creation('2026-10-16T11:11:21.000Z'));
  writeTranscript(sessionFile('grep'), creation('2026-11-08T14:00:00.000Z'));

  assert.equal(findCreatorSession(PR, { projectsDir }).sessionId, 'real');
});

test('ignores gh calls that did not create a PR', () => {
  writeTranscript(sessionFile('s1'), [
    createCommand('toolu_1', '2026-10-09T12:55:17.000Z'),
    prLink(PR, '2026-10-09T12:55:17.000Z'),
    createResult('toolu_1', '2026-10-09T12:55:17.000Z', [PR], 'edited'),
  ]);

  assert.equal(findCreatorSession(PR, { projectsDir }), null);
});

test('finds every PR created by one gh call', () => {
  writeTranscript(sessionFile('s1'), [
    createCommand('toolu_1', '2026-10-09T12:55:07.000Z', `${CREATE}; ${CREATE}`),
    prLink(PR, '2026-10-09T12:55:17.000Z'),
    createResult('toolu_1', '2026-10-09T12:55:17.700Z', [OTHER_PR, PR]),
    prLink(OTHER_PR, '2026-10-10T08:00:00.000Z'),
  ]);

  assert.equal(findCreatorSession(PR, { projectsDir }).sessionId, 's1');
  assert.equal(findCreatorSession(OTHER_PR, { projectsDir }).sessionId, 's1');
});

test('does not mistake a PR for one with a longer number', () => {
  writeTranscript(sessionFile('s1'), creation('2026-10-09T12:55:17.000Z'));

  assert.equal(findCreatorSession('https://github.com/acme/shop/pull/19', { projectsDir }), null);
});

test('finds a creation from before compaction', () => {
  writeTranscript(sessionFile('s1'), [
    ...creation('2026-10-09T12:55:17.000Z'),
    { type: 'system', subtype: 'compact_boundary', parentUuid: null, timestamp: '2026-10-09T14:28:53.000Z' },
    { type: 'user', isCompactSummary: true, message: { content: 'Summary' } },
  ]);

  assert.equal(findCreatorSession(PR, { projectsDir }).sessionId, 's1');
});

test('follows a background handoff to the newer session', () => {
  writeTranscript(sessionFile('old'), [
    ...creation('2026-10-09T12:55:17.000Z'),
    { type: 'continued-in', sessionId: 'old', continuedInSessionId: 'new' },
  ]);
  writeTranscript(sessionFile('new'), [{ type: 'ai-title', aiTitle: 'Cart, continued', sessionId: 'new' }]);

  const session = findCreatorSession(PR, { projectsDir });
  assert.equal(session.sessionId, 'new');
  assert.equal(session.title, 'Cart, continued');
});

test('rejects a URL that is not a pull request', () => {
  assert.throws(() => findCreatorSession('https://github.com/acme/shop', { projectsDir }), TypeError);
});
