/* SPDX-License-Identifier: Apache-2.0 */
import { captureFloorFrames, missingFloorFrames, pasteFloorFrames } from './model-frame-copy.js';
import { isFrameClass } from './model-frame-move.js';

export function mountFrameCopy(modelUi) {
  let A;
  const state = { buffer: null };
  const copy = document.createElement('button'), paste = document.createElement('button');
  for (const button of [copy, paste]) { button.type = 'button'; button.className = 'btn-line btn-sm-cc'; }
  copy.dataset.frameCopy = ''; copy.textContent = 'Copy to floor';
  copy.title = 'Keep selected beams/columns, then switch floors and paste at the same world X/Y coordinates.';
  paste.dataset.framePaste = ''; paste.textContent = 'Paste on this floor';
  function update() {
    const keys = A.selectedKeys(), model = A.host.model();
    copy.hidden = !keys.length || !keys.every((key) => isFrameClass(model?.classOf.get(key - A.kb())));
    paste.hidden = !state.buffer || state.buffer.editor !== A.ed();
    paste.disabled = !state.buffer || state.buffer.storey === A.S.level;
    paste.title = state.buffer ? `Copy ${state.buffer.members.length} members from ${state.buffer.name}. Existing matching members are skipped (10 mm tolerance).` : '';
  }
  copy.addEventListener('click', () => {
    if (A.S.busy || A.S.reloading) return;
    try {
      state.buffer = captureFloorFrames(A.ed(), A.host.model(), A.selectedKeys(), A.S.level);
      state.buffer.name = A.level()?.name || 'source floor'; update();
      A.host.status(`Copied ${state.buffer.members.length} frame members from ${state.buffer.name}. Switch floors, then click Paste on this floor.`);
    } catch (error) { A.host.status(error.message, true); }
  });
  paste.addEventListener('click', () => {
    if (A.S.busy || A.S.reloading || !state.buffer) return;
    try {
      const { missing, skipped } = missingFloorFrames(state.buffer, A.ed(), A.host.model(), A.S.level);
      if (!missing.length) { A.host.status(`All ${skipped} copied members already exist on this floor; nothing pasted.`); return; }
      A.commit(pasteFloorFrames(state.buffer, missing, A.S.level, A.mergeJournals), { label: `${missing.length} frame members to ${A.level()?.name || 'floor'}`, verb: 'Pasted', select: [] });
      A.host.status(`Pasted ${missing.length} frame members at the same X/Y coordinates. ${skipped} existing matches skipped. Member sizes and heights preserved.`);
    } catch (error) { A.host.status(error.message, true); }
  });
  A = modelUi.extend({ refresh: update, picked: update });
  A.root.querySelector('[data-frame-stack]')?.after(copy, paste);
  update(); window.bimcraftFrameCopy = { state, api: A };
}
