/* SPDX-License-Identifier: Apache-2.0 */
/** Select, then drag a beam/column in Draw; the existing pointer system owns pan. */
import { isFrameClass, moveFrameMembers } from './model-frame-move.js';
import { fmtLen } from './model-units.js';
import { readVerticalStacks } from './model-frame-stack.js';

export function mountFrameMove(modelUi) {
  let A;
  const R = { drag: null, hint: false, stack: null, matching: false };
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn-line btn-sm-cc'; button.dataset.frameStack = '';
  button.textContent = 'Select vertical stack'; button.hidden = true;
  button.title = 'Select the aligned beams above/below for each selected beam (10 mm sideways tolerance; small end trims allowed), or columns at the same plan position.';
  function stackSelected(keys = A.selectedKeys()) {
    return !!R.stack && R.stack.editor === A.ed() && keys.length === R.stack.keys.length && keys.every((key) => R.stack.keys.includes(key));
  }
  function updateButton() {
    const keys = A.selectedKeys(), active = stackSelected(keys), model = A.host.model();
    const frame = keys.length > 0 && keys.every((k) => isFrameClass(model?.classOf.get(k - A.kb())));
    button.hidden = !frame && !active;
    button.disabled = R.matching;
    button.textContent = active ? `Clear stack${R.stack.stacks === 1 ? '' : 's'} (${keys.length})` : 'Select vertical stack';
    button.setAttribute('aria-pressed', String(!!active));
  }
  button.addEventListener('click', async () => {
    if (A.S.busy || A.S.reloading) return;
    if (stackSelected()) {
      const seeds = R.stack.seeds; R.stack = null; A.host.select([...seeds]); updateButton(); return;
    }
    const keys = A.selectedKeys(), model = A.host.model();
    if (!keys.length || !keys.every((k) => isFrameClass(model?.classOf.get(k - A.kb())))) return;
    R.matching = true; button.disabled = true; const editor = A.ed();
    A.host.status('Finding matching frame members above and below…');
    await new Promise(requestAnimationFrame);
    try {
      if (editor !== A.ed() || A.selectedKeys().join() !== keys.join()) return;
      const result = readVerticalStacks(editor, A.host.model(), keys);
      if (A.S.tool !== 'select') A.setTool('select');
      R.stack = { editor, seeds: [...keys], keys: result.keys, stacks: result.stacks };
      A.host.select(result.keys);
      A.host.status(`Selected ${result.keys.length} aligned frame member${result.keys.length === 1 ? '' : 's'}` +
        (result.stacks === 1 ? '' : ` in ${result.stacks} vertical stacks`) +
        `. Drag the visible member or centre grip to move ${result.stacks === 1 ? 'the whole stack' : 'all of them together'}.` +
        (result.skipped ? ` ${result.skipped} members had no readable axis.` : ''));
    } catch (error) { A.host.status(error.message, true); }
    finally { R.matching = false; updateButton(); }
  });
  function selected() {
    const model = A.host.model(), ed = A.ed(), keys = A.selectedKeys();
    if (!model || !ed || !A.pv() || !keys.length) return null;
    const parts = [...A.pv().scene.cut, ...A.pv().scene.below, ...A.pv().scene.above];
    const members = [];
    for (const key of keys) {
      const id = key - A.kb();
      if (!isFrameClass(model.classOf.get(id))) return null;
      const visible = parts.filter((p) => p.key === key);
      // Cross-floor movement is allowed only for the explicitly selected stack.
      if (!visible.length && !stackSelected(keys)) return null;
      const line = ed.api.GetLine(ed.mid, id, false);
      if (!line?.GlobalId || !line.ObjectPlacement) return null;
      members.push({ key, guid: line.GlobalId.value, segs: visible.flatMap((p) => Array.from(p.segs)) });
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const member of members) for (let i = 0; i < member.segs.length; i += 2) {
      x0 = Math.min(x0, member.segs[i]); x1 = Math.max(x1, member.segs[i]);
      y0 = Math.min(y0, member.segs[i + 1]); y1 = Math.max(y1, member.segs[i + 1]);
    }
    if (!Number.isFinite(x0)) return null;
    return { members, centre: [(x0 + x1) / 2, (y0 + y1) / 2] };
  }
  function dragTo(p, event) {
    const d = R.drag;
    const snap = A.snapFrom(p, event, d.from);
    return { dx: snap.p[0] - d.from[0], dy: snap.p[1] - d.from[1], snap };
  }
  A = modelUi.extend({
    down(p, event) {
      if (A.S.busy || A.S.reloading || event.ctrlKey || event.metaKey || !A.S.planM) return false;
      const selection = selected();
      if (!selection) return false;
      const hit = A.pv().hit(event.clientX, event.clientY);
      const onGrip = Math.hypot(p[0] - selection.centre[0], p[1] - selection.centre[1]) <= A.pv().pxToMm(9);
      if (!onGrip && !selection.members.some((m) => m.key === hit)) return false;
      R.drag = { ...selection, from: [...p], plan: [...A.S.planM], at: null };
      return true;
    },
    drag(p, event) { if (R.drag) R.drag.at = dragTo(p, event); },
    up(p, event, { moved, cancel }) {
      const d = R.drag; R.drag = null;
      if (!d || cancel || moved <= 4) return;
      // Use the release position as well as intermediate pointer moves.
      R.drag = d; const at = dragTo(p, event); R.drag = null;
      if (Math.hypot(at.dx, at.dy) < .5) return;
      A.commit(moveFrameMembers({ guids: d.members.map((m) => m.guid), plan: d.plan, dx: at.dx, dy: at.dy }),
        { label: d.members.length === 1 ? 'Frame member' : `${d.members.length} frame members`, verb: 'Moved', select: d.members.map((m) => m.key) });
    },
    overlay(o) {
      if (A.S.tool !== 'select') return;
      const selection = R.drag || selected();
      if (!selection) return;
      (o.grips ||= []).push({ p: selection.centre, kind: 'mid' });
      const d = R.drag;
      if (!d?.at) return;
      const { dx, dy, snap } = d.at;
      for (const member of d.members) for (let i = 0; i < member.segs.length; i += 4) {
        const s = member.segs; o.dashed.push([s[i] + dx, s[i + 1] + dy, s[i + 2] + dx, s[i + 3] + dy]);
      }
      o.hud = { p: snap.p, text: `Move X ${fmtLen(dx, A.units())} · Y ${fmtLen(dy, A.units())}` };
      if (snap.kind !== 'free') o.snap = snap;
    },
    escape() {
      if (!R.drag) return false;
      R.drag = null; A.S.drag = null; return true;
    },
    toolChanged() { R.drag = null; R.hint = false; },
    refresh() { updateButton(); },
    picked() {
      updateButton();
      if (A.S.tool !== 'select') return;
      const hint = A.root.querySelector('[data-model-hint]');
      if (selected()) {
        if (hint) hint.textContent = stackSelected()
          ? `Drag the visible member or centre grip to move all ${R.stack.keys.length} stack members. Shift: axis lock. Esc: cancel.`
          : 'Drag the selected beam or column, or its centre grip, to move in this plan. Shift: axis lock. Esc: cancel.';
        R.hint = true;
      } else if (R.hint) { if (hint) hint.textContent = A.t('model.hint.select'); R.hint = false; }
    },
  });
  A.root.querySelector('[data-mtool="select"]')?.after(button);
  window.bimcraftFrameMove = { state: R };
}
