const BUTTON_ID = 'lachs-session-button';
const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;
const HEADER_ACTIONS = '[data-component="PageHeader"] [data-component="PH_Actions"]';
const SVG_NS = 'http://www.w3.org/2000/svg';
const CLAUDE_ORANGE = '#D97757';
const EYE_COLOR = '#1F2328';
// Claude Code's mascot from its welcome screen ( ▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝ ),
// one rect per block, a quarter block being 1 wide and 2 tall.
const MASCOT = [
  { x: 3, y: 0, width: 12, height: 4, fill: CLAUDE_ORANGE },
  { x: 5, y: 2, width: 1, height: 2, fill: EYE_COLOR },
  { x: 12, y: 2, width: 1, height: 2, fill: EYE_COLOR },
  { x: 1, y: 4, width: 16, height: 2, fill: CLAUDE_ORANGE },
  { x: 3, y: 6, width: 12, height: 2, fill: CLAUDE_ORANGE },
  { x: 4, y: 8, width: 1, height: 2, fill: CLAUDE_ORANGE },
  { x: 6, y: 8, width: 1, height: 2, fill: CLAUDE_ORANGE },
  { x: 11, y: 8, width: 1, height: 2, fill: CLAUDE_ORANGE },
  { x: 13, y: 8, width: 1, height: 2, fill: CLAUDE_ORANGE },
];

let current = null;
let updateScheduled = false;

new MutationObserver(scheduleUpdate).observe(document.documentElement, { childList: true, subtree: true });
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
  button.className = 'Button Button--iconOnly Button--invisible Button--medium tooltipped tooltipped-s';
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

function mascotIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '1 0 16 10');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '15');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  for (const block of MASCOT) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    for (const [name, value] of Object.entries(block)) rect.setAttribute(name, value);
    svg.append(rect);
  }
  return svg;
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
