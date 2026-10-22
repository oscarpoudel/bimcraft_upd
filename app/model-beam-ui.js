/* SPDX-License-Identifier: Apache-2.0 */
/**
 * model-beam-ui.js — the Extend beam tool on the plan (0.6, Modify › Extend beam), through model-ui.js `extend()`:
 *   Extend beam  [data-mtool="extendbeam"]  click a beam, then the beam to extend it to: the first beam's nearer end runs
 *                                           to the face of the second (one undo step); the first beam stays chosen for the
 *                                           next click until Esc or another tool
 * A plan does not cut a beam, so the tool draws the level's beams as their centre lines while it is on, and picks by them.
 * A beam picked in the 3D view before the tool starts is the first beam; picking beams in the 3D view while it is on works
 * as clicking their lines does. The maths and the op are model-beam-extend.js.
 * Test hook: window.bimcraftBeamExtend = { state, beamAt, beams }.
 */
import { extendBeam, beamMesh, extendPlan, readBeam } from './model-beam-extend.js';
import { fmtLen } from './model-units.js';
import { ids, val, inv4, apply4 } from './ifc-util.js';

const TOOL = 'extendbeam';
const dist3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

export function mountBeamExtend(modelUi) {
  const R = { src: null, hover: null, plan: null, beams: null, forLevel: null, forData: null };   // src: the first beam's guid
  let A = null;
  const t = (...a) => A.t(...a);
  const mine = () => A.S.tool === TOOL;
  const hint = (key) => { const h = A.root.querySelector('[data-model-hint]'); if (h) h.textContent = t(key); };
  const hintNow = () => { if (mine()) hint(R.src ? 'model.hint.extendbeam2' : 'model.hint.extendbeam'); };

  /** The level's beams: their axes in model mm (from the mesh, as the 3D view shows them) and their lines on the plan. */
  function beams() {
    // the model's own snapshot changes on every edit and every reload (undo too): that is when the beams are read again
    if (R.beams && R.forLevel === A.S.level && R.forData === A.S.data) return R.beams;
    R.forLevel = A.S.level;
    R.forData = A.S.data;
    R.beams = [];
    const ed = A.ed();
    if (!ed || !A.S.planM) return R.beams;
    const api = ed.api, mid = ed.mid, Mi = inv4(A.S.planM), out = [];
    const pl = ed.placer();
    const unitMm = pl.unitMm;
    let storey = null;
    try { storey = pl.storeyOf(); } catch (e) { storey = null; }
    const list = [...ids(api, mid, 'IFCBEAM'), ...ids(api, mid, 'IFCBEAMSTANDARDCASE')];
    for (const id of list) {
      if (storey && storey.get(id) !== A.S.level) continue;
      let mesh = null;
      try { mesh = beamMesh(api, mid, id, unitMm); } catch (e) { mesh = null; }
      if (!mesh) continue;
      // a beam no longer than its own depth (a stub) has no length to read an axis from: leave it out rather than pick it
      // by its cross-section
      let rb = null;
      try { rb = readBeam(api, mid, id); } catch (e) { rb = null; }
      if (rb && rb.ok && rb.depthMm < 100) continue;
      const el = api.GetLine(mid, id, false);
      out.push({
        id, guid: String(val(el?.GlobalId) || id), name: String(val(el?.Name) || ''),
        a3: mesh.a3, b3: mesh.b3, verts: mesh.verts,
        pa: apply4(Mi, mesh.a3[0], mesh.a3[1], mesh.a3[2]), pb: apply4(Mi, mesh.b3[0], mesh.b3[1], mesh.b3[2]),
      });
    }
    R.beams = out;
    return out;
  }
  const byGuid = (guid) => beams().find((b) => b.guid === guid) || null;

  /** The beam whose centre line on the plan is under p (8 px), the nearest first. */
  function beamAt(p) {
    const tol = A.pv().pxToMm(8);
    let best = null;
    for (const b of beams()) {
      const ax = b.pa[0], ay = b.pa[1], bx = b.pb[0], by = b.pb[1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      const s = (p[0] - ax) * ux + (p[1] - ay) * uy, d = Math.abs((p[0] - ax) * -uy + (p[1] - ay) * ux);
      if (s < -tol || s > L + tol || d > tol) continue;
      if (!best || d < best.d) best = { d, b };
    }
    return best?.b || null;
  }
  /** What a click at p would do now: { beam, target, movingEnd, newLen } | { beam, error } | null. */
  function planAt(p) {
    const b = beamAt(p);
    if (!b || !R.src) return null;
    if (b.guid === R.src) return { beam: b, error: 'model.err.beam.same' };
    const src = byGuid(R.src);
    if (!src) return null;
    const r = extendPlan(src, b);
    return r.error ? { beam: b, error: r.error } : { beam: b, ...r };
  }

  /** Extend the first beam to the beam b: the change, or the reason it cannot be made, said on the status line. */
  function commitTo(b) {
    const src = byGuid(R.src);
    if (!src) { A.host.status(t('model.err.beam.gone'), true); return; }
    const pl = extendPlan(src, b);
    if (pl.error) { A.host.status(t(pl.error), true); return; }
    A.commit(extendBeam({ guid: R.src, target: pl.target, movingEnd: pl.movingEnd }),
      { label: t('model.tool.extendbeam'), verb: t('model.verb.extended'), select: [] });
    R.plan = null;   // the first beam stays chosen for the next one (as a trim keeps its edge)
  }

  A = modelUi.extend({
    tools: [TOOL],
    hint: (name) => (name === TOOL ? 'model.hint.extendbeam' : ''),
    typed: () => false,
    move(p) { R.hover = p; R.plan = (mine() && R.src) ? planAt(p) : null; },
    click(p) {
      if (!R.src) {
        const b = beamAt(p);
        if (!b) { A.host.status(t('model.err.beam.nobeam'), true); return; }
        R.src = b.guid; R.plan = null; hintNow(); return;
      }
      const pl = planAt(p);
      if (!pl) { A.host.status(t('model.err.beam.nobeam'), true); return; }
      if (pl.error) { A.host.status(t(pl.error), true); return; }
      commitTo(pl.beam);
    },
    /** A pick in the 3D view (model-ui.js picked()): while this tool is on, picking a beam there is a click on its line. */
    picked() {
      if (!mine() || !A.S.on) return;
      const sel = A.selectedKeys();
      if (sel.length !== 1) return;
      const b = beams().find((x) => x.id === sel[0] - A.kb());
      if (!b) return;
      if (!R.src) { R.src = b.guid; R.hover = null; R.plan = null; hintNow(); return; }
      if (b.guid === R.src) return;
      commitTo(b);
    },
    escape() {
      if (!mine() || !R.src) return false;
      R.src = null; R.plan = null; hintNow();
      return true;
    },
    toolChanged(name) {
      R.src = null; R.hover = null; R.plan = null; R.beams = null; R.forLevel = null; R.forData = null;
      if (name === TOOL) {
        // a beam already picked in the 3D view is the first beam
        const sel = A.selectedKeys();
        if (sel.length === 1) { const b = beams().find((x) => x.id === sel[0] - A.kb()); if (b) R.src = b.guid; }
        hintNow();
      } else { const m = A.root.querySelector('[data-modify-tools]'); if (m?.open) m.open = false; }
    },
    refresh() { R.beams = null; R.forLevel = null; R.forData = null; if (R.src && !byGuid(R.src)) R.src = null; },
    overlay(o) {
      if (!mine()) return;
      const list = beams(), src = R.src && byGuid(R.src);
      for (const b of list) {
        if (b === src) continue;
        o.lines.push([b.pa[0], b.pa[1], b.pb[0], b.pb[1]]);   // every beam of the level: what there is to extend to
      }
      if (src) o.dashed.push([src.pa[0], src.pa[1], src.pb[0], src.pb[1]]);
      if (!R.hover) return;
      const b = beamAt(R.hover);
      if (!b) return;
      if (!src) {
        o.hud = { p: R.hover, text: (b.name || t('model.beam')) + '\n' + fmtLen(dist3(b.a3, b.b3), A.units()) };
        return;
      }
      const pl = R.plan;
      if (!pl || pl.beam !== b) return;
      if (pl.error) { o.hud = { p: R.hover, text: t(pl.error) }; return; }
      // the beam where it would go: its other end, the point it meets (both on the plan)
      const Mi = inv4(A.S.planM);
      const at = apply4(Mi, pl.target[0], pl.target[1], pl.target[2]);
      const keep = pl.movingEnd === src.a3 ? src.pb : src.pa;
      o.lines.push([keep[0], keep[1], at[0], at[1]]);
      o.hud = { p: R.hover, text: fmtLen(pl.newLen, A.units()) };
    },
  });
  if (typeof window !== 'undefined') window.bimcraftBeamExtend = { state: R, beamAt, beams };   // for tests
  return { state: R, beamAt, beams };
}
