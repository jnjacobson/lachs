const NATIVE_HOST = 'com.jnjacobson.lachs';

chrome.action.setBadgeBackgroundColor({ color: '#d1242f' });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  askHelper(message).then(response => {
    if (message.type === 'open') notify(openResultText(response));
    sendResponse(response);
  });
  return true;
});

async function askHelper(message) {
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, message);
    if (response.error) throw new Error(response.error);
    await reloadIfOutdated(response.version);
    await setStatus(null);
    return response;
  } catch (error) {
    await setStatus(error.message);
    return { error: error.message };
  }
}

// Opening brings Zed to the front, so the result goes to a macOS notification, not the page.
function openResultText(response) {
  switch (response.status) {
    case 'opened': {
      const fallback = response.inMainCheckout ? ' The worktree is gone, so it runs in the main checkout.' : '';
      return `Open a new terminal thread in ${response.place} to resume “${response.title}”.${fallback}`;
    }
    case 'running':
      return `Already running in ${response.place}: “${response.title}”. Pick it in Zed's sidebar.`;
    case 'folder-missing':
      return `The folder of “${response.title}” no longer exists.`;
    case 'not-found':
      return 'The session is no longer on this Mac.';
    default:
      return `Error: ${response.error ?? 'unexpected response'}`;
  }
}

function notify(message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png', title: 'lachs', message });
}

async function setStatus(error) {
  await chrome.storage.local.set({ status: { error, checkedAt: new Date().toISOString() } });
  await chrome.action.setBadgeText({ text: error ? '!' : '' });
}

// The helper reports the manifest version on disk. After a git pull the
// extension reloads itself, once per version, so a mismatch can't loop.
async function reloadIfOutdated(diskVersion) {
  const loadedVersion = chrome.runtime.getManifest().version;
  if (!diskVersion || diskVersion === loadedVersion) return;
  const { reloadedFor } = await chrome.storage.local.get('reloadedFor');
  if (reloadedFor === diskVersion) {
    throw new Error(`Loaded extension ${loadedVersion} differs from ${diskVersion} on disk. Reload it on the extensions page.`);
  }
  await chrome.storage.local.set({ reloadedFor: diskVersion });
  chrome.runtime.reload();
}
