chrome.storage.local.get('status').then(({ status }) => {
  if (!status) return;
  const element = document.getElementById('status');
  element.textContent = status.error ?? 'Helper works.';
  element.className = status.error ? 'error' : '';
  const checkedAt = new Date(status.checkedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  document.getElementById('checked-at').textContent = `Last check: ${checkedAt} (v${chrome.runtime.getManifest().version})`;
});
