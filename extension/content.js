const BUTTON_ID = 'lachs-session-button';
const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;
const HEADER_ACTIONS = '[data-component="PageHeader"] [data-component="PH_Actions"]';
const CLAUDE_ORANGE = '#D97757';
const EYE_COLOR = '#1F2328';
// Claude Code's mascot from its welcome screen ( ▐▛███▜▌ / ▝▜█████▛▘ / ▝▝   ▘▘ ),
// one rect per block, a quarter block being 1 wide and 2 tall. The legs sit on the body's edges.
const MASCOT = [
  { x: 3, y: 0, width: 12, height: 4, fill: CLAUDE_ORANGE },
  { x: 5, y: 2, width: 1, height: 2, fill: EYE_COLOR },
  { x: 12, y: 2, width: 1, height: 2, fill: EYE_COLOR },
  { x: 1, y: 4, width: 16, height: 2, fill: CLAUDE_ORANGE },
  { x: 3, y: 6, width: 12, height: 2, fill: CLAUDE_ORANGE },
  { x: 3, y: 8, width: 1, height: 2, fill: CLAUDE_ORANGE },
  { x: 5, y: 8, width: 1, height: 2, fill: CLAUDE_ORANGE },
  { x: 12, y: 8, width: 1, height: 2, fill: CLAUDE_ORANGE },
  { x: 14, y: 8, width: 1, height: 2, fill: CLAUDE_ORANGE },
];

let current = null;
let updateScheduled = false;

new MutationObserver(scheduleUpdate).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
scheduleUpdate();

// GitHub navigates without page loads and re-renders the header, so this runs on every DOM change.
function scheduleUpdate() {
  if (updateScheduled) return;
  updateScheduled = true;
  requestAnimationFrame(() => {
    updateScheduled = false;
    update();
  });
}

async function update() {
  const prUrl = currentPrUrl();
  if (current?.prUrl !== prUrl) {
    document.getElementById(BUTTON_ID)?.remove();
    current = prUrl ? { prUrl, session: null } : null;
    if (!prUrl) return;
    const response = await send({ type: 'lookup', prUrl });
    if (current?.prUrl !== prUrl) return;
    current.session = response.session ?? null;
  }
  placeButton();
}

function currentPrUrl() {
  const match = location.pathname.match(PR_PATH);
  return match && `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}

function placeButton() {
  if (!current?.session) return;
  const actions = document.querySelector(HEADER_ACTIONS);
  const button = document.getElementById(BUTTON_ID);
  if (!actions || button?.parentElement === actions) return;
  actions.prepend(button ?? createButton(current.session));
}

function createButton(session) {
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.className =
    'Button Button--iconOnly Button--invisible Button--medium tooltipped tooltipped-s';
  button.setAttribute('aria-label', tooltip(session));
  button.append(mascotIcon());
  button.addEventListener('click', () => openSession(button));
  return button;
}

function tooltip(session) {
  const created = new Date(session.createdAt).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const status = session.running ? '\nRunning' : '';
  return `Open Claude session\n${session.title}\nCreated ${created}${status}`;
}

// Drawn in device pixels so every block edge lands on a pixel. Rows get equal whole-pixel heights;
// a unit is as wide as half a terminal cell (cells are 0.475 as wide as tall), so the left half is
// snapped and mirrored onto the right, keeping each eye and leg pair the same width.
function mascotIcon(width = 24) {
  const ratio = window.devicePixelRatio || 1;
  const row = Math.max(1, Math.round(((width * 10) / 16 / 5) * ratio));
  const unit = row * 0.475;
  const half = Math.round(8 * unit);
  const canvas = document.createElement('canvas');
  canvas.width = 2 * half;
  canvas.height = 5 * row;
  canvas.style.width = `${canvas.width / ratio}px`;
  canvas.style.height = `${canvas.height / ratio}px`;
  canvas.style.verticalAlign = 'middle';
  canvas.setAttribute('aria-hidden', 'true');
  // Grid x runs from 1 to 17 with the middle at 9.
  const edge = (x) =>
    x <= 9 ? Math.round((x - 1) * unit) : 2 * half - Math.round((17 - x) * unit);
  const context = canvas.getContext('2d');
  for (const { x, y, width: w, height: h, fill } of MASCOT) {
    context.fillStyle = fill;
    const left = edge(x);
    const top = (y / 2) * row;
    context.fillRect(left, top, edge(x + w) - left, (h / 2) * row);
  }
  return canvas;
}

async function openSession(button) {
  button.disabled = true;
  await send({ type: 'open', prUrl: current.prUrl });
  button.disabled = false;
}

// After the extension reloads itself, this old content script can no longer reach it.
async function send(message) {
  try {
    return (await chrome.runtime.sendMessage(message)) ?? { error: 'no response' };
  } catch (error) {
    return { error: error.message };
  }
}
