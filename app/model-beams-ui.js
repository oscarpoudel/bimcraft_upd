/* SPDX-License-Identifier: Apache-2.0 */
/**
 * model-beams-ui.js — the Beam tool on the plan (0.6, session `bim-draw`: "doesn't have feature to add beams"), through
 * model-ui.js extend():
 *   Beam  [data-mtool="beam"]  click where the beam starts, then where it ends: one IfcBeam there (model-beams.js),
 *                              snapped like the Wall tool (grids, walls, square and typed lengths); Esc stops.
 *                              Options: Width, Depth (its section) and Top (how far above the level's top it sits).
 * The beam is drawn as its outline while the pointer moves, with its length in the HUD. It is written into the model, so
 * the plan's cut, the 3D view, Properties and Undo all show it as any other beam; Modify › Extend beam works on it too.
 * IFC: model-beams.js. Test hook: window.bimcraftBeams = { state, api }.
 */
import { BEAM_DEFAULTS, placeBeams } from './model-beams.js';
import { fmtLen, parseLen } from './model-units.js';

export function mountBeamTool(modelUi) {
  const R = {
    a: null,            // the start point of the beam being drawn
    hover: null,        // the last snapped point
    snap: null,         // and its snap (the marker the plan draws there)
    w: { ...BEAM_DEFAULTS },
  };
  let A = null;
  const t = (...a) => A.t(...a);
  const L = (mm) => fmtLen(mm, A.units());
  const hint = (key) => { const h = A.root.querySelector('[data-model-hint]'); if (h) h.textContent = t(key); };
  const hintNow = () => hint(R.a ? 'model.hint.beam2' : 'model.hint.beam');
  const levelGuid = () => A.S.data.levels.find((l) => l.id === A.S.level)?.guid;
  const spec = () => ({ width: R.w.width, depth: R.w.depth, topOffset: R.w.topOffset });

  // ---- the option row (ui.inc [data-mopts="beam"]) ----
  function bindRows() {
    const root = A.root;
    const len = (sel, key, min) => {
      const i = root.querySelector(sel);
      if (!i || i.dataset.bound) return;
      i.dataset.bound = '1';
      i.addEventListener('change', () => {
        const mm = parseLen(i.value, A.units());
        if (Number.isFinite(mm) && mm >= min) R.w[key] = mm; else A.host.status(t('model.err.length'), true);
        i.value = L(R.w[key]);
        A.drawOverlay();
      });
    };
    len('[data-beam-width]', 'width', 50);
    len('[data-beam-depth]', 'depth', 50);
    len('[data-beam-top]', 'topOffset', -100000);
    const set = (sel, v) => { const i = root.querySelector(sel); if (i && document.activeElement !== i) i.value = v; };
    set('[data-beam-width]', L(R.w.width));
    set('[data-beam-depth]', L(R.w.depth));
    set('[data-beam-top]', L(R.w.topOffset));
  }

  A = modelUi.extend({
    tools: ['beam'],
    hint: () => (R.a ? 'model.hint.beam2' : 'model.hint.beam'),
    move(p, e) {
      R.snap = A.snapAt(p, e);
      R.hover = R.snap.p;
    },
    click(p, e) {
      const q = A.snapAt(p, e).p;
      if (!R.a) { R.a = q; hintNow(); return; }
      const a = R.a; R.a = null;
      if (Math.hypot(q[0] - a[0], q[1] - a[1]) < 100) { A.host.status(t('model.err.beam.len'), true); hintNow(); return; }
      const storey = levelGuid();
      if (!storey) { A.host.status(t('model.err.nolevel'), true); return; }
      A.commit(placeBeams({ storey, a, b: q, ...spec() }), { label: t('model.beam'), verb: t('model.verb.placed') });
      hintNow();
    },
    escape() {
      if (A.S.tool !== 'beam' || !R.a) return false;
      R.a = null; hintNow();
      return true;
    },
    key(e, low) {
      if (low === 'b' && !e.shiftKey && A.S.tool !== 'beam') { A.setTool('beam'); return true; }
      return false;
    },
    toolChanged() { R.a = null; R.hover = null; R.snap = null; bindRows(); const m = A.root.querySelector('[data-res-tools]'); if (m?.open) m.open = false; },
    refresh() { bindRows(); },
    overlay(o) {
      if (A.S.tool !== 'beam') return;
      if (R.snap) o.snap = R.snap;
      if (!R.a || !R.hover) return;
      const a = R.a, b = R.hover, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 1) return;
      const hw = R.w.width / 2, nx = -dy / len, ny = dx / len;
      o.lines.push(
        [a[0] + nx * hw, a[1] + ny * hw, b[0] + nx * hw, b[1] + ny * hw],
        [a[0] - nx * hw, a[1] - ny * hw, b[0] - nx * hw, b[1] - ny * hw],
      );
      o.dashed.push([a[0], a[1], b[0], b[1]]);
      o.points.push(a);
      o.hud = { p: b, text: L(len) + ' × ' + L(R.w.width) + ' × ' + L(R.w.depth) };
    },
  });
  if (typeof window !== 'undefined') window.bimcraftBeams = { state: R, api: A };   // for tests
  return { state: R };
}
