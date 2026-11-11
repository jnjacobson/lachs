// Answers from "Ask Claude", one file each under <dir>/<owner>/<repo>/<number>/,
// so answers that finish at the same time can't overwrite each other.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './files.js';
import { normalizePrUrl } from './finder.js';

const ANSWER_ID = /^[\w-]+$/;

export function listAnswers(dir, prUrl) {
  const prDir = answersDir(dir, prUrl);
  return fs
    .globSync('*.json', { cwd: prDir })
    .map((name) => readJson(path.join(prDir, name)))
    .filter(Boolean)
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt) || a.id.localeCompare(b.id));
}

export function saveAnswer(dir, prUrl, fields) {
  const answer = { id: randomUUID(), askedAt: new Date().toISOString(), ...fields };
  const prDir = answersDir(dir, prUrl);
  fs.mkdirSync(prDir, { recursive: true });
  fs.writeFileSync(path.join(prDir, `${answer.id}.json`), JSON.stringify(answer));
  return answer;
}

export function discardAnswer(dir, prUrl, id) {
  if (!ANSWER_ID.test(id ?? '')) throw new TypeError(`Not an answer id: ${id}`);
  fs.rmSync(path.join(answersDir(dir, prUrl), `${id}.json`), { force: true });
}

function answersDir(dir, prUrl) {
  const [owner, repo, , number] = normalizePrUrl(prUrl).split('/').slice(3);
  return path.join(dir, owner, repo, number);
}
