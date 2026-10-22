/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit viewer-linked editing. Normal standalone BimCraft saves are unchanged. */
export function bridgeAddress(search) {
  const value = new URLSearchParams(search).get('structalign');
  if (!value) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !/^\/api\/bimcraft\/[A-Za-z0-9_-]{32,}$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('Invalid structural viewer edit link');
  }
  return url.href;
}

export async function mountViewerBridge({ search = location.search, openIfc, current, editor, status, after }) {
  const address = bridgeAddress(search);
  if (!address) return null;
  const panel = document.createElement('div');
  panel.dataset.structalignBridge = '';
  Object.assign(panel.style, { padding: '10px', background: '#173347', color: '#fff', zIndex: '20', overflowWrap: 'anywhere' });
  const text = document.createElement('span');
  text.textContent = 'Opening the combined IFC from the structural viewer…';
  panel.append(text);
  after.prepend(panel);
  let revision = null, entry = null, saving = false;
  const viewer = new URL(address);
  const viewerOrigin = viewer.origin;
  async function json(response) {
    let body = {};
    try { body = await response.json(); } catch { /* not JSON: the server is not the viewer (a proxy, a 404 page) */ }
    if (!response.ok) {
      const error = new Error(body.error || `Viewer request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  }
  const bridge = {
    owns: (active) => !!entry && active === entry,
    get revision() { return revision; },
    async save(bytes) {
      if (saving) return { ok: false, error: new Error('A viewer save is already in progress') };
      saving = true;
      text.textContent = 'Saving a revision and rebuilding analytical geometry…';
      try {
        const result = await json(await fetch(address, {
          method: 'PUT', headers: { 'Content-Type': 'application/x-step', 'If-Match': revision }, body: bytes,
        }));
        revision = result.revision;
        text.textContent = `Saved to structural viewer · ${result.saved_at} · analysis needs rerunning`;
        status('Saved to structural viewer. Its model will refresh automatically.');
        return { ok: true, name: 'viewer revision ' + revision.slice(0, 8) };
      } catch (error) {
        // A fetch that never reached the server rejects with TypeError (connection refused, server stopped, a
        // CORS failure): say which viewer, so it is clear what to start again.
        if (error instanceof TypeError) {
          error.message = `Could not reach the structural viewer at ${viewerOrigin}. Is it still running?`;
        }
        error.unreachable = error instanceof TypeError || error.status === 403 || error.status >= 500;
        text.textContent = 'Viewer save failed: ' + error.message + ' Your edits remain in this tab; use Download IFC copy until the viewer is back.';
        status(text.textContent, true);
        return { ok: false, error, unreachable: error.unreachable };
      } finally { saving = false; }
    },
  };
  // Public status is also useful to browser integration tests and local tools.
  window.structalignBridge = bridge;
  try {
    const info = await json(await fetch(address, { cache: 'no-store' }));
    revision = info.revision;
    const response = await fetch(address + '/ifc', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load combined IFC (${response.status})`);
    await openIfc(new Uint8Array(await response.arrayBuffer()), info.file_name);
    entry = current();
    if (!entry) throw new Error('BimCraft could not open the combined IFC');
    text.textContent = `${info.case_id} · linked to structural viewer. Save as IFC / Ctrl+S saves back to the viewer.`;
    const app = after.closest('[data-bimcraft]');
    const saveNote = app?.querySelector('[data-changes] .bc-note');
    if (saveNote) saveNote.textContent = 'Saving writes a new revision to your local structural viewer and refreshes its model.';
    const privacyNote = app?.querySelector('.bc-left > .bc-sec .bc-note:last-child');
    if (privacyNote) privacyNote.textContent = 'Linked editing saves this model to your local structural viewer.';
    const download = document.createElement('button');
    download.type = 'button'; download.textContent = 'Download IFC copy';
    download.style.marginLeft = '12px';
    download.addEventListener('click', () => {
      if (!bridge.owns(current())) { status('Select the linked model before downloading it.', true); return; }
      const url = URL.createObjectURL(new Blob([editor().save()], { type: 'application/x-step' }));
      const link = document.createElement('a'); link.href = url; link.download = info.file_name;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    panel.append(download);
    return bridge;
  } catch (error) {
    const reason = error instanceof TypeError
      ? `no answer from ${viewerOrigin}. Is the viewer still running? Open the edit link again from the viewer.`
      : error.message;
    text.textContent = 'Could not connect to structural viewer: ' + reason;
    status(text.textContent, true);
    return null;
  }
}
