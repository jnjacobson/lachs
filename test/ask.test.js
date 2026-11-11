import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { discardAnswer, listAnswers, saveAnswer } from '../helper/answers.js';
import { askSession } from '../helper/ask.js';

const PR = 'https://github.com/acme/shop/pull/196';
const QUESTION = {
  prUrl: PR,
  path: 'src/cart.js',
  side: 'R',
  startLine: 9,
  endLine: 11,
  code: '+  total += item.price;',
  text: 'Why not reduce()?',
};

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lachs-ask-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// A stand-in for claude that records its arguments and stdin, then prints `output`.
function fakeClaude(output, { exitCode = 0, delaySeconds = 0 } = {}) {
  const file = path.join(dir, 'claude');
  fs.writeFileSync(
    file,
    `#!/bin/sh
printf '%s\\n' "$@" > "${dir}/args"
cat > "${dir}/stdin"
sleep ${delaySeconds}
printf '%s' '${JSON.stringify(output)}'
exit ${exitCode}
`,
    { mode: 0o755 },
  );
  return file;
}

function ask(claude, extra = {}) {
  return askSession(
    { sessionId: 'abc', cwd: dir, question: QUESTION, ...extra },
    { claude, timeoutMs: 2000 },
  );
}

test('asks a throwaway, read-only fork and resolves to its answer', async () => {
  const claude = fakeClaude({ result: ' Because of rounding. \n', is_error: false });

  assert.equal(await ask(claude), 'Because of rounding.');

  const args = fs.readFileSync(path.join(dir, 'args'), 'utf8').split('\n');
  for (const flag of ['--fork-session', '--no-session-persistence', '--strict-mcp-config']) {
    assert.ok(args.includes(flag), flag);
  }
  assert.equal(args[args.indexOf('--resume') + 1], 'abc');
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob');
});

test('sends the lines, the question and earlier answers in the prompt', async () => {
  const claude = fakeClaude({ result: 'ok', is_error: false });
  const earlier = { ...QUESTION, question: 'What is item?', answer: 'A cart line.' };

  await ask(claude, { history: [earlier] });

  const prompt = fs.readFileSync(path.join(dir, 'stdin'), 'utf8');
  assert.match(prompt, /src\/cart\.js, new lines 9–11/);
  assert.match(prompt, /\+ {2}total \+= item\.price;/);
  assert.match(prompt, /What is item\?\nYour answer: A cart line\./);
  assert.ok(prompt.trimEnd().endsWith('Why not reduce()?'));
});

test('asks about a whole file without lines', async () => {
  const claude = fakeClaude({ result: 'ok', is_error: false });
  const { side, startSide, startLine, endLine, ...file } = QUESTION;

  await ask(claude, { question: { ...file, code: '' } });

  const prompt = fs.readFileSync(path.join(dir, 'stdin'), 'utf8');
  assert.match(prompt, /src\/cart\.js \(the whole file\)/);
  assert.doesNotMatch(prompt, /```/);
});

test("lets the fork read the PR's checkout when the session ended up elsewhere", async () => {
  const claude = fakeClaude({ result: 'ok', is_error: false });

  await ask(claude, { checkout: '/Users/jan/shop' });

  const args = fs.readFileSync(path.join(dir, 'args'), 'utf8').split('\n');
  assert.equal(args[args.indexOf('--add-dir') + 1], '/Users/jan/shop');
  assert.match(
    fs.readFileSync(path.join(dir, 'stdin'), 'utf8'),
    /checked out at \/Users\/jan\/shop/,
  );
});

test('names both sides for a range across old and new lines', async () => {
  const claude = fakeClaude({ result: 'ok', is_error: false });

  await ask(claude, { question: { ...QUESTION, startSide: 'L', side: 'R' } });

  const prompt = fs.readFileSync(path.join(dir, 'stdin'), 'utf8');
  assert.match(prompt, /src\/cart\.js, old line 9 to new line 11/);
});

test('keeps hooks from running in the fork', async () => {
  const claude = fakeClaude({ result: 'ok', is_error: false });

  await ask(claude);

  const args = fs.readFileSync(path.join(dir, 'args'), 'utf8').split('\n');
  assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), { disableAllHooks: true });
});

test('rejects with what Claude reported when it fails', async () => {
  const claude = fakeClaude({ result: 'No conversation found', is_error: true }, { exitCode: 1 });

  await assert.rejects(ask(claude), /No conversation found/);
});

test('gives up after the timeout', async () => {
  const claude = fakeClaude({ result: 'late', is_error: false }, { delaySeconds: 1 });

  await assert.rejects(
    askSession({ sessionId: 'abc', cwd: dir, question: QUESTION }, { claude, timeoutMs: 200 }),
    /No answer after/,
  );
});

test('keeps answers per PR in the order they were asked', () => {
  const second = saveAnswer(dir, `${PR}/files`, {
    askedAt: '2026-11-11T10:00:02.000Z',
    question: 'two',
    answer: '2',
  });
  const first = saveAnswer(dir, PR, {
    askedAt: '2026-11-11T10:00:01.000Z',
    question: 'one',
    answer: '1',
  });
  saveAnswer(dir, 'https://github.com/acme/shop/pull/195', { question: 'other', answer: '' });

  assert.deepEqual(
    listAnswers(dir, PR).map((answer) => answer.question),
    ['one', 'two'],
  );

  discardAnswer(dir, PR, first.id);
  assert.deepEqual(
    listAnswers(dir, PR).map((answer) => answer.id),
    [second.id],
  );
});

test('refuses answer ids that are paths', () => {
  assert.throws(() => discardAnswer(dir, PR, '../../index'), /Not an answer id/);
});
