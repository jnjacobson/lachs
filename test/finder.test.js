import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { findCreatorSession } from '../helper/finder.js';

const PR = 'https://github.com/acme/shop/pull/196';
const OTHER_PR = 'https://github.com/acme/shop/pull/195';
const CREATE = 'gh pr create --draft --title "Add cart"';

let configDir;
let projectsDir;
let indexFile;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lachs-test-'));
  projectsDir = path.join(configDir, 'projects');
  indexFile = path.join(configDir, 'cache', 'index.json');
});

afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
});

function writeTranscript(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
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

  assert.deepEqual(findCreatorSession(PR, { configDirs: [configDir] }), {
    sessionId: 's1',
    title: 'cart work',
    cwd: '/Users/jan/shop/.claude/worktrees/cart',
    createdAt: '2026-10-09T12:55:17.000Z',
    configDir,
  });
});

test('finds a creation on a later line of a multi-line command', () => {
  const at = '2026-10-09T12:55:17.000Z';
  writeTranscript(sessionFile('s1'), [
    createCommand('toolu_1', at, `set -e\ngit push -u origin HEAD\n${CREATE}`),
    prLink(PR, at),
    createResult('toolu_1', at, [PR]),
  ]);

  assert.equal(findCreatorSession(PR, { configDirs: [configDir] }).sessionId, 's1');
});

test('matches the PR URL regardless of case', () => {
  writeTranscript(sessionFile('s1'), creation('2026-10-09T12:55:17.000Z'));

  assert.equal(
    findCreatorSession(PR.replace('acme', 'ACME'), { configDirs: [configDir] }).sessionId,
    's1',
  );
});

test('opens the parent session when a subagent created the PR', () => {
  writeTranscript(sessionFile('parent'), [prLink(PR, '2026-10-30T12:44:23.030Z')]);
  writeTranscript(
    path.join(projectsDir, '-Users-jan-shop', 'parent', 'subagents', 'agent-a1.jsonl'),
    [
      createCommand('toolu_1', '2026-10-30T12:44:18.000Z'),
      createResult('toolu_1', '2026-10-30T12:44:23.000Z', [PR]),
    ],
  );

  assert.equal(findCreatorSession(PR, { configDirs: [configDir] }).sessionId, 'parent');
});

test('ignores a fork that copied the creation', () => {
  writeTranscript(sessionFile('original'), creation('2026-10-16T11:11:21.000Z'));
  writeTranscript(sessionFile('fork'), [
    createCommand('toolu_1', '2026-10-16T11:11:21.000Z'),
    createResult('toolu_1', '2026-10-16T11:11:21.000Z', [PR]),
    prLink(PR, '2026-10-20T09:00:00.000Z'),
  ]);

  assert.equal(findCreatorSession(PR, { configDirs: [configDir] }).sessionId, 'original');
});

test('ignores sessions that only touched the PR', () => {
  writeTranscript(sessionFile('reviewer'), [prLink(PR, '2026-10-20T09:00:00.000Z')]);

  assert.equal(findCreatorSession(PR, { configDirs: [configDir] }), null);
});

test('prefers the earliest creation over a later false one', () => {
  writeTranscript(sessionFile('real'), creation('2026-10-16T11:11:21.000Z'));
  writeTranscript(sessionFile('grep'), creation('2026-11-08T14:00:00.000Z'));

  assert.equal(findCreatorSession(PR, { configDirs: [configDir] }).sessionId, 'real');
});

test('ignores gh calls that did not create a PR', () => {
  writeTranscript(sessionFile('s1'), [
    createCommand('toolu_1', '2026-10-09T12:55:17.000Z'),
    prLink(PR, '2026-10-09T12:55:17.000Z'),
    createResult('toolu_1', '2026-10-09T12:55:17.000Z', [PR], 'edited'),
  ]);

  assert.equal(findCreatorSession(PR, { configDirs: [configDir] }), null);
});

test('finds every PR created by one gh call', () => {
  writeTranscript(sessionFile('s1'), [
    createCommand('toolu_1', '2026-10-09T12:55:07.000Z', `${CREATE}; ${CREATE}`),
    prLink(PR, '2026-10-09T12:55:17.000Z'),
    createResult('toolu_1', '2026-10-09T12:55:17.700Z', [OTHER_PR, PR]),
    prLink(OTHER_PR, '2026-10-10T08:00:00.000Z'),
  ]);

  assert.equal(findCreatorSession(PR, { configDirs: [configDir] }).sessionId, 's1');
  assert.equal(findCreatorSession(OTHER_PR, { configDirs: [configDir] }).sessionId, 's1');
});

test('does not mistake a PR for one with a longer number', () => {
  writeTranscript(sessionFile('s1'), creation('2026-10-09T12:55:17.000Z'));

  assert.equal(
    findCreatorSession('https://github.com/acme/shop/pull/19', { configDirs: [configDir] }),
    null,
  );
});

test('finds a creation from before compaction', () => {
  writeTranscript(sessionFile('s1'), [
    ...creation('2026-10-09T12:55:17.000Z'),
    {
      type: 'system',
      subtype: 'compact_boundary',
      parentUuid: null,
      timestamp: '2026-10-09T14:28:53.000Z',
    },
    { type: 'user', isCompactSummary: true, message: { content: 'Summary' } },
  ]);

  assert.equal(findCreatorSession(PR, { configDirs: [configDir] }).sessionId, 's1');
});

test('follows a background handoff to the newer session', () => {
  writeTranscript(sessionFile('old'), [
    ...creation('2026-10-09T12:55:17.000Z'),
    { type: 'continued-in', sessionId: 'old', continuedInSessionId: 'new' },
  ]);
  writeTranscript(sessionFile('new'), [
    { type: 'ai-title', aiTitle: 'Cart, continued', sessionId: 'new' },
    { type: 'user', cwd: '/Users/jan/shop', message: { content: 'go on' } },
  ]);

  const session = findCreatorSession(PR, { configDirs: [configDir] });
  assert.equal(session.sessionId, 'new');
  assert.equal(session.title, 'Cart, continued');
});

test('stays in the old session when the handoff never ran', () => {
  writeTranscript(sessionFile('old'), [
    ...creation('2026-10-09T12:55:17.000Z'),
    { type: 'ai-title', aiTitle: 'Add cart', sessionId: 'old' },
    { type: 'continued-in', sessionId: 'old', continuedInSessionId: 'new' },
  ]);
  writeTranscript(sessionFile('new'), [
    { type: 'agent-name', sessionId: 'new' },
    { type: 'ai-title', aiTitle: 'Cart, continued', sessionId: 'new' },
  ]);

  assert.deepEqual(findCreatorSession(PR, { configDirs: [configDir] }), {
    sessionId: 'old',
    title: 'Add cart',
    cwd: '/Users/jan/shop',
    createdAt: '2026-10-09T12:55:17.000Z',
    configDir,
  });
});

test('finds a session in another projects folder', () => {
  const otherConfigDir = path.join(configDir, 'other');
  writeTranscript(
    path.join(otherConfigDir, 'projects', '-Users-jan-shop', 's1.jsonl'),
    creation('2026-10-09T12:55:17.000Z'),
  );

  const session = findCreatorSession(PR, { configDirs: [configDir, otherConfigDir] });

  assert.equal(session.sessionId, 's1');
  assert.equal(session.configDir, otherConfigDir);
});

test('rejects a URL that is not a pull request', () => {
  assert.throws(
    () => findCreatorSession('https://github.com/acme/shop', { configDirs: [configDir] }),
    TypeError,
  );
});

test.describe('with an index', () => {
  const lookup = (url = PR) => findCreatorSession(url, { configDirs: [configDir], indexFile });

  // Whole seconds survive every file system's timestamp precision.
  const FIXED_MTIME = 1_790_000_000;

  function setMtime(file) {
    fs.utimesSync(file, FIXED_MTIME, FIXED_MTIME);
  }

  function blankOut(file) {
    fs.writeFileSync(file, ' '.repeat(fs.statSync(file).size));
    setMtime(file);
  }

  test('finds the same session as without one', () => {
    writeTranscript(sessionFile('s1'), creation('2026-10-09T12:55:17.000Z'));

    assert.deepEqual(lookup(), findCreatorSession(PR, { configDirs: [configDir] }));
    assert.equal(lookup().sessionId, 's1');
  });

  test('does not read an unchanged transcript again', () => {
    const file = sessionFile('s1');
    writeTranscript(file, creation('2026-10-09T12:55:17.000Z'));
    setMtime(file);
    lookup();

    blankOut(file);

    assert.equal(lookup().sessionId, 's1');
  });

  test('answers other PRs of an indexed transcript', () => {
    writeTranscript(sessionFile('s1'), [
      createCommand('toolu_1', '2026-10-09T12:55:07.000Z', `${CREATE}; ${CREATE}`),
      prLink(PR, '2026-10-09T12:55:17.000Z'),
      createResult('toolu_1', '2026-10-09T12:55:17.700Z', [OTHER_PR, PR]),
      prLink(OTHER_PR, '2026-10-10T08:00:00.000Z'),
    ]);
    lookup();

    assert.equal(lookup(OTHER_PR).sessionId, 's1');
  });

  test('reads a transcript again once it has grown', () => {
    const file = sessionFile('s1');
    writeTranscript(file, [{ type: 'user', cwd: '/Users/jan/shop', message: { content: 'hi' } }]);
    assert.equal(lookup(), null);

    fs.appendFileSync(
      file,
      `${creation('2026-10-09T12:55:17.000Z')
        .map((record) => JSON.stringify(record))
        .join('\n')}\n`,
    );

    assert.equal(lookup().sessionId, 's1');
  });

  test('keeps transcripts of every projects folder in one index', () => {
    const otherConfigDir = path.join(configDir, 'other');
    const file = sessionFile('s1');
    const otherFile = path.join(otherConfigDir, 'projects', '-Users-jan-shop', 's2.jsonl');
    writeTranscript(file, creation('2026-10-09T12:55:17.000Z'));
    writeTranscript(otherFile, creation('2026-10-09T12:55:17.000Z', [OTHER_PR]));
    setMtime(file);
    setMtime(otherFile);
    const lookupBoth = (url) =>
      findCreatorSession(url, { configDirs: [configDir, otherConfigDir], indexFile });
    lookupBoth(PR);

    blankOut(file);
    blankOut(otherFile);

    assert.equal(lookupBoth(PR).sessionId, 's1');
    assert.equal(lookupBoth(OTHER_PR).sessionId, 's2');
  });

  test('forgets a deleted transcript', () => {
    const file = sessionFile('s1');
    writeTranscript(file, creation('2026-10-09T12:55:17.000Z'));
    lookup();

    fs.rmSync(file);

    assert.equal(lookup(), null);
  });

  test('ignores an index it cannot read', () => {
    writeTranscript(sessionFile('s1'), creation('2026-10-09T12:55:17.000Z'));
    fs.mkdirSync(path.dirname(indexFile), { recursive: true });
    fs.writeFileSync(indexFile, '{ not json');

    assert.equal(lookup().sessionId, 's1');
  });

  test('still works when the index cannot be written', () => {
    writeTranscript(sessionFile('s1'), creation('2026-10-09T12:55:17.000Z'));
    fs.mkdirSync(indexFile, { recursive: true });

    assert.equal(lookup().sessionId, 's1');
  });
});
