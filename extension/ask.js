// "Ask Claude" on the Files changed tab: a button in GitHub's comment forms, for lines or
// a whole file, sends the comment text as a question to the session that created the PR,
// and the answer appears below the lines or above the file's diff.
// Runs after content.js and uses its `current`, `send`, `scheduleUpdate` and `mascotIcon`.
const ASK_BUTTON_CLASS = 'lachs-ask-button';
const ANSWER_CLASS = 'lachs-answer';
const FILES_TAB = /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)(\/|$)/;
const FILE_CONTAINER = '[class*="diffTargetable"]';
const HEADINGS = 'h1, h2, h3, h4, h5, h6';
// "Add a comment on line R88", "Add a comment on lines L9 to R11"
const LINES_HEADING = /\b([LR])(\d+)(?:\s+to\s+([LR])(\d+))?\s*$/;
// "Add comment on file"
const FILE_HEADING = /\bcomment on file\b/i;
const SIDES = { L: 'left', R: 'right' };

// Answers of the current PR: the saved ones, plus failed and still pending questions.
// An answer about a whole file has no startLine, endLine or side.
let answers = { prUrl: null, items: [] };
// Questions waiting for an answer, on any PR, so they survive a visit to another PR.
const inFlight = new Set();
// The block shown for each answer id, and the Ask button added to each comment textarea.
const blocks = new Map();
const askButtons = new WeakMap();
let pendingCount = 0;

// biome-ignore lint/correctness/noUnusedVariables: called by content.js with the lookup's answers
function showAnswers(prUrl, saved) {
  for (const block of blocks.values()) block.remove();
  blocks.clear();
  const waiting = [...inFlight].filter((item) => item.prUrl === prUrl);
  answers = { prUrl, items: [...saved, ...waiting] };
  scheduleUpdate();
}

// Runs on every DOM change, so it skips what is already in place before searching the page.
// biome-ignore lint/correctness/noUnusedVariables: called by content.js
function placeAsk() {
  if (!current?.session || !FILES_TAB.test(location.pathname)) return;
  for (const textarea of document.querySelectorAll(`${FILE_CONTAINER} textarea`)) {
    if (!askButtons.get(textarea)?.isConnected) addAskButton(textarea);
  }
  const unplaced = answers.items.filter((item) => !blocks.get(item.id)?.isConnected);
  if (unplaced.length === 0) return;
  const containers = new Map(
    [...document.querySelectorAll(FILE_CONTAINER)].map((container) => [
      filePath(container),
      container,
    ]),
  );
  for (const item of unplaced) placeAnswer(item, containers.get(item.path));
}

function addAskButton(textarea) {
  const form = commentForm(textarea);
  if (!form) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${form.cancel.className} ${ASK_BUTTON_CLASS}`;
  button.title = 'Ask the Claude session that created this PR, using the text as the question';
  button.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
  button.append(mascotIcon(16), 'Ask Claude');
  button.addEventListener('click', () => askAbout(textarea, form));
  form.cancel.parentElement.prepend(button);
  askButtons.set(textarea, button);
}

// The comment form around a textarea: { cancel, target }, or null when it isn't one we know.
function commentForm(textarea) {
  const container = textarea.closest(FILE_CONTAINER);
  for (let node = textarea.parentElement; node && node !== container; node = node.parentElement) {
    // Past the form's own box, which holds only its textarea, lies another form.
    if (node.querySelectorAll('textarea').length > 1) return null;
    const cancel = [...node.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Cancel',
    );
    const target = cancel && commentTarget(node);
    if (target) return { cancel, target };
  }
  return null;
}

// { file: true } or { start, end } with { side, line } each, from the form's heading.
function commentTarget(form) {
  for (const heading of form.querySelectorAll(HEADINGS)) {
    const text = heading.textContent.trim();
    if (FILE_HEADING.test(text)) return { file: true };
    const match = text.match(LINES_HEADING);
    if (match) {
      const start = { side: match[1], line: Number(match[2]) };
      const end = match[3] ? { side: match[3], line: Number(match[4]) } : start;
      return { start, end };
    }
  }
  return null;
}

async function askAbout(textarea, form) {
  const text = textarea.value.trim();
  const where = commentedCode(textarea, form.target);
  if (!text || !where) {
    textarea.focus();
    return;
  }
  const { prUrl } = answers;
  const pending = { id: `pending-${++pendingCount}`, prUrl, ...where, question: text };
  pending.pending = true;
  inFlight.add(pending);
  answers.items.push(pending);
  closeForm(textarea, form.cancel);
  scheduleUpdate();

  const response = await send({ type: 'ask', prUrl, ...where, text });
  inFlight.delete(pending);
  if (answers.prUrl !== prUrl) return;
  const failed = response.failed ?? response.error ?? (response.answer ? null : 'No answer');
  const result = failed ? { ...pending, pending: false, failed } : response.answer;
  // Answers reloaded meanwhile may already hold the saved answer.
  answers.items = answers.items
    .filter((item) => item === pending || item.id !== result.id)
    .map((item) => (item === pending ? result : item));
  removeBlock(pending.id);
}

// What the form comments on: { path, code } for a file,
// { path, startSide, side, startLine, endLine, code } for lines, or null.
function commentedCode(textarea, target) {
  const container = textarea.closest(FILE_CONTAINER);
  const path = container && filePath(container);
  if (!path) return null;
  if (target.file) return { path, code: '' };
  const { start, end } = target;
  const code = linesText(container, start, end);
  if (code === null) return null;
  return {
    path,
    startSide: start.side,
    side: end.side,
    startLine: start.line,
    endLine: end.line,
    code,
  };
}

function filePath(container) {
  return (
    container.querySelector('[data-file-path]')?.getAttribute('data-file-path') ??
    container.querySelector('h3')?.textContent.trim() ??
    null
  );
}

// The lines from start to end as "+code", "-code" or " code", or null when they aren't rendered.
// In the split view a row has both sides; the end's side is used.
function linesText(container, start, end) {
  const lines = [];
  let inside = false;
  for (const row of container.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('td.diff-text-cell[data-line-number]')];
    if (cells.length === 0) continue;
    inside ||= cells.some((cell) => isLine(cell, start));
    if (!inside) continue;
    const cell = cells.find((candidate) => candidate.dataset.diffSide === SIDES[end.side]);
    lines.push(lineText(cell ?? cells[0]));
    if (cells.some((candidate) => isLine(candidate, end))) return lines.join('\n');
  }
  return null;
}

function isLine(cell, { side, line }) {
  return cell.dataset.diffSide === SIDES[side] && Number(cell.dataset.lineNumber) === line;
}

function lineText(cell) {
  const marker = cell.querySelector('.diff-text-marker')?.textContent.trim() || ' ';
  return marker + (cell.querySelector('.diff-text-inner')?.textContent ?? '');
}

function lineCell(container, side, line) {
  return container.querySelector(
    `td.diff-text-cell[data-diff-side="${SIDES[side]}"][data-line-number="${line}"]`,
  );
}

// Whether the lines differ from when the question was asked. Only lines of the answer's side
// count, since the other side's lines show up in the unified view but not in the split view.
// Lines that aren't rendered, e.g. in a collapsed hunk, and answers without code don't count.
function linesChanged(item, container) {
  const current = linesText(
    container,
    { side: item.startSide ?? item.side, line: item.startLine },
    { side: item.side, line: item.endLine },
  );
  if (current === null || !item.code) return false;
  const otherSide = item.side === 'L' ? '+' : '-';
  const ownSide = (code) => code.split('\n').filter((line) => !line.startsWith(otherSide));
  return ownSide(current).join('\n') !== ownSide(item.code).join('\n');
}

function isFileAnswer(item) {
  return item.startLine === undefined;
}

// Line answers go into the cell of the last line. File answers go above the diff, before
// GitHub's file comment form, in the order they were asked.
function placeAnswer(item, container) {
  const parent = isFileAnswer(item)
    ? container?.querySelector('table')?.parentElement
    : container && lineCell(container, item.side, item.endLine);
  if (!parent) return;
  blocks.get(item.id)?.remove();
  const block = answerBlock(item, container);
  blocks.set(item.id, block);
  if (!isFileAnswer(item)) parent.append(block);
  else {
    const fileAnswers = parent.querySelectorAll(`:scope > .${ANSWER_CLASS}`);
    if (fileAnswers.length > 0) fileAnswers[fileAnswers.length - 1].after(block);
    else parent.prepend(block);
  }
}

function removeBlock(id) {
  blocks.get(id)?.remove();
  blocks.delete(id);
  scheduleUpdate();
}

function answerBlock(item, container) {
  const block = element('div', {
    border: '1px solid var(--borderColor-default)',
    borderRadius: '6px',
    background: 'var(--bgColor-default)',
    margin: '8px',
    padding: '8px 12px',
    fontFamily: 'var(--fontStack-sansSerif, -apple-system, sans-serif)',
    fontSize: '14px',
    whiteSpace: 'normal',
    userSelect: 'text',
  });
  block.className = ANSWER_CLASS;
  block.dataset.answerId = item.id;
  // The diff cell would take clicks and keys for selecting lines.
  for (const type of ['click', 'mousedown', 'keydown']) {
    block.addEventListener(type, (event) => event.stopPropagation());
  }

  const header = element('div', { display: 'flex', alignItems: 'center', gap: '8px' });
  header.append(mascotIcon(16), element('strong', {}, 'Claude'));
  const outdated =
    !item.pending && !item.failed && !isFileAnswer(item) && linesChanged(item, container);
  if (outdated) {
    const label = element('span', { color: 'var(--fgColor-attention)' }, 'Outdated');
    label.title = 'These lines changed since the question was asked';
    header.append(label);
  }
  header.append(element('span', { flex: '1' }));
  if (!item.pending) header.append(actionButton('Discard', () => discard(item)));

  const question = element('div', { color: 'var(--fgColor-muted)', margin: '4px 0' });
  question.textContent = item.question;

  const body = element('div', { whiteSpace: 'pre-wrap' });
  if (item.pending) body.textContent = 'Thinking…';
  else if (item.failed) {
    body.style.color = 'var(--fgColor-danger)';
    body.textContent = item.failed;
  } else body.append(...formatted(item.answer));

  block.append(header, question, body);
  return block;
}

// Plain text with `inline code` and ```code blocks``` set in monospace.
function formatted(text) {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/);
  return parts.map((part, index) => {
    if (!part.startsWith('`')) {
      // A code block is a block of its own, so the line breaks around it would add blank lines.
      let plain = part;
      if (parts[index - 1]?.startsWith('```')) plain = plain.replace(/^\n/, '');
      if (parts[index + 1]?.startsWith('```')) plain = plain.replace(/\n$/, '');
      return document.createTextNode(plain);
    }
    const block = part.startsWith('```');
    const code = element(block ? 'pre' : 'code', {
      fontFamily: 'var(--fontStack-monospace, monospace)',
      fontSize: '12px',
      background: 'var(--bgColor-muted)',
      borderRadius: '6px',
      padding: block ? '8px' : '0 4px',
      margin: block ? '4px 0' : '0',
      whiteSpace: 'pre-wrap',
    });
    code.textContent = block ? part.replace(/^```\w*\n?|```$/g, '') : part.slice(1, -1);
    return code;
  });
}

async function discard(item) {
  answers.items = answers.items.filter((candidate) => candidate !== item);
  removeBlock(item.id);
  if (!item.failed) await send({ type: 'discard', prUrl: answers.prUrl, id: item.id });
}

// The question now lives in the answer block. The form is emptied first, so Cancel doesn't
// ask whether to discard it, and closed once React has seen the empty text.
function closeForm(textarea, cancel) {
  setTextareaValue(textarea, '');
  requestAnimationFrame(() => cancel.click());
}

// GitHub's textarea is a React input: set the value natively, then tell React with an input event.
function setTextareaValue(textarea, value) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function actionButton(label, onClick) {
  const button = element(
    'button',
    {
      background: 'none',
      border: 'none',
      padding: '0',
      color: 'var(--fgColor-accent)',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: '12px',
    },
    label,
  );
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function element(tag, style, text) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}
