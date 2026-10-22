#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * beam-extend-test.mjs — Modify › Extend beam without a screen (model-beam-extend.js): a model made here, two beams
 * meeting end to end, one carried on, one across in front and one across behind, read through cc-ifc the way the plan
 * reads them, and changed through the same IfcEditor the window uses (one undo step).
 *
 *   npm test -- --only test-bimcraft-structural.mjs        # or, standalone:
 *   CADCRAFT_APPS=<folder holding bimcraft/ → the app's own folder> node tests/tools/bimcraft-test/structural/beam-extend-test.mjs
 *   (the repository itself has no public_html build, so the app's modules are found through CADCRAFT_APPS; see
 *    tests/tools/cli/headless/apps.mjs)
 */
import { IfcSession } from '../../cli/headless/ifc.mjs';
import { load } from '../../cli/headless/apps.mjs';

let bad = 0, good = 0;
const ok = (cond, label, detail = '') => { if (cond) good++; else bad++; console.log((cond ? '  ok   ' : '  FAIL ') + label + (!cond && detail ? ' (' + detail + ')' : '')); };
const near = (a, b, e = 0.5) => Number.isFinite(a) && Math.abs(a - b) <= e;
const near3 = (a, b, e = 0.5) => near(a[0], b[0], e) && near(a[1], b[1], e) && near(a[2], b[2], e);
const f3 = (a) => a.map((v) => Math.round(v * 10) / 10).join(', ');

/**
 * A small IFC4 file we own: a storey, and beams of 200 × 300 whose bodies are one IfcExtrudedAreaSolid each (the
 * Position's Z is the beam's axis, the sweep is (0, 0, 1) in that frame — the shape the tool changes, and the one the
 * real models use).
 *
 *   B-1  (0, 0, 2500) → (3000, 0, 2500)   the beam to extend
 *   B-2  carried on from B-1: (3900, 0, 2500) → (5000, 0, 2500)   parallel, on the same line
 *   B-3  across, in front: x = 3600, y −1500…1500      B-1's far end runs to its face at x = 3500
 *   B-4  across, behind: x = −400, y −1500…1500        B-1's near end runs to its face at x = −300
 *   B-5  a stub across, right at B-1's middle: x = 40   a crossing trims B-1 back past it (not an error)
 *   B-6  across but 2.5 m higher: x = 3600, z = 5000   not the same level
 * The shapes a beam of 60 mm or a beam 3.5 m above a parallel one make are made here, not built: their axes are read
 * from a mesh, and a stub shorter than its own depth is no beam to read an axis from.
 */
function beamFixture() {
  const L = [];
  let n = 0;
  const line = (s) => { n++; L.push('#' + n + '=' + s + ';'); return '#' + n; };
  const str = (s) => (s === null || s === undefined ? '$' : "'" + String(s).replace(/'/g, "''") + "'");
  const list = (a) => '(' + a.join(',') + ')';
  const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const pt = (p) => line('IFCCARTESIANPOINT(' + list(p.map((v) => num(Math.abs(v) < 1e-9 ? 0 : v))) + ')');
  const dir = (d) => line('IFCDIRECTION(' + list(d.map((v) => num(Math.abs(v) < 1e-9 ? 0 : v))) + ')');
  const ax3 = (p, z, x) => line('IFCAXIS2PLACEMENT3D(' + pt(p) + ',' + (z ? dir(z) : '$') + ',' + (x ? dir(x) : '$') + ')');
  const place = (rel, p) => line('IFCLOCALPLACEMENT(' + (rel || '$') + ',' + ax3(p) + ')');
  const guid = (k) => str(('0BimCraftBeamFixture' + k).slice(0, 22));

  const oh = line('IFCOWNERHISTORY($,$,$,.NOCHANGE.,$,$,$,0)');
  const units = line('IFCUNITASSIGNMENT(' + list([
    line('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)'), line('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'),
    line('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'), line('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)')]) + ')');
  const ctx = line("IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05," + ax3([0, 0, 0]) + ',$)');
  const body = line("IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*," + ctx + ',$,.MODEL_VIEW.,$)');
  const project = line('IFCPROJECT(' + guid('P') + ',' + oh + ",'Beam fixture',$,$,$,$," + list([ctx]) + ',' + units + ')');
  const sitePl = place(null, [0, 0, 0]);
  const site = line('IFCSITE(' + guid('S') + ',' + oh + ",'Site',$,$," + sitePl + ',$,$,.ELEMENT.,$,$,$,$,$)');
  const bldPl = place(sitePl, [0, 0, 0]);
  const building = line('IFCBUILDING(' + guid('B') + ',' + oh + ",'Fixture building',$,$," + bldPl + ',$,$,.ELEMENT.,$,$,$)');
  const stPl = place(bldPl, [0, 0, 0]);
  const st = line('IFCBUILDINGSTOREY(' + guid('L') + ',' + oh + ",'Level 1',$,$," + stPl + ',$,$,.ELEMENT.,0.)');
  line('IFCRELAGGREGATES(' + guid('R1') + ',' + oh + ',$,$,' + project + ',' + list([site]) + ')');
  line('IFCRELAGGREGATES(' + guid('R2') + ',' + oh + ',$,$,' + site + ',' + list([building]) + ')');
  line('IFCRELAGGREGATES(' + guid('R3') + ',' + oh + ',$,$,' + building + ',' + list([st]) + ')');

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const beams = [];
  /** One beam: from a to b, 200 wide and 300 deep, one extruded solid; `props` adds Pset_BeamCommon Length and GrossLength. */
  function beam(key, name, a, b, props = false) {
    const axis = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const helper = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const X = unit(cross(helper, axis));
    const depth = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const prof = line("IFCRECTANGLEPROFILEDEF(.AREA.,'200x300'," + line('IFCAXIS2PLACEMENT2D(' + pt([0, 0]) + ',$)') + ',200.,300.)');
    const pos = ax3([0, 0, 0], axis, X);
    const es = line('IFCEXTRUDEDAREASOLID(' + prof + ',' + pos + ',' + dir([0, 0, 1]) + ',' + num(depth) + ')');
    const shape = line('IFCPRODUCTDEFINITIONSHAPE($,$,' + list([line("IFCSHAPEREPRESENTATION(" + body + ",'Body','SweptSolid'," + list([es]) + ')')]) + ')');
    const pl = place(stPl, a);
    const id = line('IFCBEAM(' + guid(key) + ',' + oh + ',' + str(name) + ',$,$,' + pl + ',' + shape + ',$)');
    if (props) {
      const p = line('IFCPROPERTYSINGLEVALUE(' + str('Length') + ',$,IFCPOSITIVELENGTHMEASURE(' + num(depth) + '),$)');
      const ps = line('IFCPROPERTYSET(' + guid(key + 'p') + ',' + oh + ',' + str('Pset_BeamCommon') + ',$,' + list([p]) + ')');
      line('IFCRELDEFINESBYPROPERTIES(' + guid(key + 'r') + ',' + oh + ',$,$,' + list([id]) + ',' + ps + ')');
      const q = line('IFCQUANTITYLENGTH(' + str('GrossLength') + ',$,$,' + num(depth) + ',$)');
      const eq = line('IFCELEMENTQUANTITY(' + guid(key + 'q') + ',' + oh + ',' + str('Qto_BeamBaseQuantities') + ',$,$,' + list([q]) + ')');
      line('IFCRELDEFINESBYPROPERTIES(' + guid(key + 'r2') + ',' + oh + ',$,$,' + list([id]) + ',' + eq + ')');
    }
    beams.push({ id, key, name });
    return id;
  }
  beam('1', 'B-1', [0, 0, 2500], [3000, 0, 2500], true);
  beam('2', 'B-2', [3900, 0, 2500], [5000, 0, 2500]);
  beam('3', 'B-3', [3600, -1500, 2500], [3600, 1500, 2500]);
  beam('4', 'B-4', [-400, -1500, 2500], [-400, 1500, 2500]);
  beam('5', 'B-5', [40, -1500, 2500], [40, 1500, 2500]);
  beam('6', 'B-6', [3600, -1500, 5000], [3600, 1500, 5000]);
  line('IFCRELCONTAINEDINSPATIALSTRUCTURE(' + guid('C') + ',' + oh + ',$,$,' + list(beams.map((b) => b.id)) + ',' + st + ')');
  return { text: L.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n', beams };
}

const { text, beams } = beamFixture();
// the fixture's own STEP header (the entities above are its DATA section)
const file = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME('beam-extend.ifc','2026-01-01T00:00:00',(''),(''),'BimCraft','BimCraft','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n" + text;

const s = await IfcSession.open(new TextEncoder().encode(file), 'beam-extend.ifc');
const B = await load('bimcraft', 'model-beam-extend.js');
const { mul4 } = await load('bimcraft', 'ifc-util.js');
const ed = await s.editor();
const api = ed.api, mid = ed.mid, unitMm = ed.placer().unitMm;
const byName = (name) => s.f.ofType('IFCBEAM', true).find((id) => String(s.str(id, 'Name')) === name);

console.log('== read: the beams, their axes and their plan lines');
const b1 = byName('B-1'), b2 = byName('B-2'), b3 = byName('B-3'), b4 = byName('B-4'), b5 = byName('B-5'), b6 = byName('B-6');
ok(!!b1 && !!b2 && !!b3 && !!b4 && !!b5 && !!b6, 'the fixture reads back six IfcBeams', s.f.ofType('IFCBEAM', true).join());
ok(unitMm === 1, 'millimetre units', String(unitMm));
const r1 = B.readBeam(api, mid, b1);
ok(r1.ok, 'B-1 is one straight IfcExtrudedAreaSolid', r1.why);
ok(near3(r1.L, [0, 0, 2500]) && near3(r1.R, [3000, 0, 2500]), 'B-1 runs from (0, 0, 2500) to (3000, 0, 2500)', f3(r1.L) + ' → ' + f3(r1.R));
const m1 = B.beamMesh(api, mid, b1, unitMm);
ok(!!m1 && near3(m1.a3, r1.L, 1) && near3(m1.b3, r1.R, 1), 'its mesh lies on the same line: the solid and the drawn shape agree', m1 ? f3(m1.a3) + ' → ' + f3(m1.b3) : 'no mesh');
ok(m1 && m1.verts.length >= 8, 'the mesh has the 8 corners of a box (and more, one per triangle)', m1 ? String(m1.verts.length) : '');
// In the browser the viewer's meshes come out in the model's coordination frame (the survey frame it places the model by)
// while a beam's own placement is in the model's own frame, so the mesh has to be brought back — or the plan draws the
// beams metres away and the change is measured from the wrong place. cc-ifc here hands out the model's own frame; the
// browser's is stood in for: the coordination matrix and the mesh it has already been applied to.
const COORD = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.5, -2.5, 0, 1];
const placed = new Proxy(api, {
  get(t, k) {
    if (k === 'GetCoordinationMatrix') return () => COORD;
    if (k === 'GetFlatMesh') return (m, id) => {
      const fm = t.GetFlatMesh(m, id), gs = [];
      for (let g = 0; g < fm.geometries.size(); g++) {
        const pg = fm.geometries.get(g);
        gs.push({ geometryExpressID: pg.geometryExpressID, flatTransformation: mul4(COORD, Array.from(pg.flatTransformation)) });
      }
      return { geometries: { size: () => gs.length, get: (i) => gs[i] }, delete: () => fm.delete && fm.delete() };
    };
    return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
  },
});
const ms = B.beamMesh(placed, mid, b1, unitMm);
ok(ms && near3(ms.a3, m1.a3, 1) && near3(ms.b3, m1.b3, 1), "a mesh handed out in the coordination frame is read back in the model's own frame (the same axis)", ms ? f3(ms.a3) + ' → ' + f3(ms.b3) : 'no mesh');
const meshOf = (id) => B.beamMesh(api, mid, id, unitMm);
const src = { ...m1 };
const t2 = meshOf(b2), t3 = meshOf(b3), t4 = meshOf(b4), t5 = meshOf(b5), t6 = meshOf(b6);
ok(t2 && t3 && t4 && t5 && t6, 'the other beams have meshes too');

console.log('== extendPlan: where the beam has to end');
const p3 = B.extendPlan(src, t3);
ok(!p3.error && near3(p3.target, [3500, 0, 2500]), 'across in front: B-1 meets B-3\'s face at x 3500 (not its centre line 3600)', p3.error || f3(p3.target));
ok(near3(p3.movingEnd, [3000, 0, 2500]) && near(p3.newLen, 3500), 'its far end moves; the new length is 3500', p3.error || f3(p3.movingEnd) + ' / ' + p3.newLen);
const p4 = B.extendPlan(src, t4);
ok(!p4.error && near3(p4.target, [-300, 0, 2500]) && near3(p4.movingEnd, [0, 0, 2500]) && near(p4.newLen, 3300),
  'across behind: its near end moves back to x −300, length 3300', p4.error || f3(p4.target) + ' / ' + f3(p4.movingEnd) + ' / ' + p4.newLen);
const p2 = B.extendPlan(src, t2);
ok(!p2.error && near3(p2.target, [3900, 0, 2500]) && near(p2.newLen, 3900), 'carried on from another (parallel, on one line): meets B-2\'s nearer end at 3900', p2.error || f3(p2.target) + ' / ' + p2.newLen);
const p5 = B.extendPlan(src, t5);
ok(!p5.error && near3(p5.target, [140, 0, 2500]) && near(p5.newLen, 2860), 'a beam crossing near its end trims it back past the crossing (to the face the body first meets)', p5.error || f3(p5.target) + ' / ' + p5.newLen);
const box = (x0, x1, y, z, hw = 100, hh = 150) => [
  [x0, y - hw, z - hh], [x0, y + hw, z - hh], [x0, y + hw, z + hh], [x0, y - hw, z + hh],
  [x1, y - hw, z - hh], [x1, y + hw, z - hh], [x1, y + hw, z + hh], [x1, y - hw, z + hh]];
const stub = { a3: [0, 0, 0], b3: [60, 0, 0], verts: box(0, 60, 0, 0) };
const over = { a3: [0, -500, 0], b3: [0, 500, 0], verts: [
  [-100, -500, -150], [100, -500, -150], [100, 500, -150], [-100, 500, -150],
  [-100, -500, 150], [100, -500, 150], [100, 500, 150], [-100, 500, 150]] };
ok(B.extendPlan(stub, over).error === 'model.err.beam.short', 'a 60 mm beam, a crossing right on its end: what is left is under 50 mm', B.extendPlan(stub, over).error || String(B.extendPlan(stub, over).newLen));
const farParallel = { a3: [8000, 0, 6000], b3: [9000, 0, 6000], verts: box(8000, 9000, 0, 6000) };
ok(B.extendPlan(t2, farParallel).error === 'model.err.beam.parallel', 'a parallel beam 3.5 m above is said to be parallel, not a gap', B.extendPlan(t2, farParallel).error);
const p6 = B.extendPlan(src, t6);
ok(p6.error === 'model.err.beam.skew', 'a beam 2.5 m higher is not met (not the same level)', p6.error || f3(p6.target));
ok(B.extendPlan(src, src).error === 'model.err.beam.same', 'a beam cannot be extended to itself');
ok(B.lineClosest([0, 0, 0], [1000, 0, 0], [0, 1000, 0], [1000, 1000, 0]) === null, 'lineClosest says when two lines are parallel');

console.log('== extendBeam: the change (one undo step)');
const props1 = () => {
  let len = null, gross = null;
  for (const ps of s.f.ofType('IFCPROPERTYSET', true)) {
    if (String(s.str(ps, 'Name')) !== 'Pset_BeamCommon') continue;
    for (const p of s.f.attr(ps, 'HasProperties') || []) {
      if (String(s.str(p.ref, 'Name')) !== 'Length') continue;
      const v = s.f.attr(p.ref, 'NominalValue');
      if (v && v.typed === 'IFCPOSITIVELENGTHMEASURE') len = v.value;
    }
  }
  for (const eq of s.f.ofType('IFCELEMENTQUANTITY', true)) {
    for (const q of s.f.attr(eq, 'Quantities') || []) if (String(s.str(q.ref, 'Name')) === 'GrossLength') gross = s.f.attr(q.ref, 'LengthValue');
  }
  return { len, gross };
};
const before = props1();
ok(near(before.len, 3000) && near(before.gross, 3000), 'before: Length 3000 and GrossLength 3000', JSON.stringify(before));
const res = await s.apply('Extend beam', B.extendBeam({ guid: s.str(b1, 'GlobalId'), target: p3.target, movingEnd: p3.movingEnd }));
ok(res && res.id === b1, 'the op says which beam it changed', JSON.stringify(res && res.id));
const r1b = B.readBeam(api, mid, b1);
ok(r1b.ok && near3(r1b.L, [0, 0, 2500], 1) && near3(r1b.R, [3500, 0, 2500], 1), 'B-1 now ends at x 3500', r1b.ok ? f3(r1b.L) + ' → ' + f3(r1b.R) : r1b.why);
const m1b = B.beamMesh(api, mid, b1, unitMm);
ok(m1b && near3(m1b.b3, [3500, 0, 2500], 1), 'and its drawn shape too: the mesh ends where the solid does', m1b ? f3(m1b.a3) + ' → ' + f3(m1b.b3) : 'no mesh');
const after = props1();
ok(near(after.len, 3500) && near(after.gross, 3500), 'Length and GrossLength follow the new length', JSON.stringify(after));
const undo = await s.undo(1, { any: true });
const r1c = B.readBeam(api, mid, b1);
ok(undo.length === 1 && r1c.ok && near3(r1c.R, [3000, 0, 2500], 1), 'one undo step puts it back (moved lines and their new directions all go)', undo.join());
const undone = props1();
ok(near(undone.len, 3000) && near(undone.gross, 3000), 'and the property values come back', JSON.stringify(undone));

console.log('== the near end moves: the placement point, not only the depth');
const p4b = B.extendPlan(src, t4);
await s.apply('Extend beam', B.extendBeam({ guid: s.str(b1, 'GlobalId'), target: p4b.target, movingEnd: p4b.movingEnd }));
const r1d = B.readBeam(api, mid, b1);
ok(r1d.ok && near3(r1d.L, [-300, 0, 2500], 1) && near3(r1d.R, [3000, 0, 2500], 1), 'B-1 now starts at x −300 and still ends at 3000', r1d.ok ? f3(r1d.L) + ' → ' + f3(r1d.R) : r1d.why);

console.log('== a refusal changes nothing');
try {
  await s.apply('Extend beam', B.extendBeam({ guid: s.str(b1, 'GlobalId'), target: [3500, 500, 2500], movingEnd: [3000, 0, 2500] }));
  ok(false, 'a target half a metre off the beam is refused');
} catch (e) {
  ok(/model\.err\.beam\.(gone|kind|short)/.test(String(e.key || '') + ' ' + e.message), 'a target off the beam\'s own line is refused, with a reason the plan can say', String(e.key || e.message));
}
const b1again = B.readBeam(api, mid, b1);
const b5r = B.readBeam(api, mid, b5);
ok(b1again.ok && near(b1again.depthMm, 3300, 1), 'the refused change left the beam as it was (3300 mm)', b1again.ok ? String(b1again.depthMm) : b1again.why);
ok(b5r.ok && near3(b5r.L, [40, -1500, 2500], 1), 'and B-5 is where it was', b5r.ok ? f3(b5r.L) : b5r.why);
ok(ed.changes.length < 2 || !/gone/.test(String(ed.changes[ed.changes.length - 1].label || '')), 'a refused change adds no undo step', String(ed.changes.length));

console.log('== the tool on the plan (model-beam-ui.js): the first beam, then the one to extend to');
const { mountBeamExtend } = await load('bimcraft', 'model-beam-ui.js');
const stId = s.f.ofType('IFCBUILDINGSTOREY', true)[0];
const US = { tool: 'select', on: true, level: stId, planM: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], data: {} };
const state = { hint: '', status: '', statusErr: false, op: null, meta: null, ext: null };
let sel = [];
const hintEl = { get textContent() { return state.hint; }, set textContent(v) { state.hint = v; } };
const ui = {
  S: US, t: (k) => k, units: () => 'mm', ed: () => ed, kb: () => 0,
  pv: () => ({ pxToMm: (n) => n * 10 }),   // a plan drawn at 10 mm to the pixel
  root: { querySelector: (q) => (q === '[data-model-hint]' ? hintEl : null) },
  host: { status: (text, err) => { state.status = text; state.statusErr = !!err; } },
  selectedKeys: () => [...sel],
  commit: (run, meta) => { state.op = run; state.meta = meta; },
  extend: (obj) => { state.ext = obj; return ui; },
};
const mounted = mountBeamExtend(ui);
const E = state.ext, RS = mounted.state, beamAt = mounted.beamAt;
const ov = () => { const o = { lines: [], dashed: [], hud: null }; E.overlay(o); return o; };
US.tool = 'extendbeam'; sel = [b1];
E.toolChanged('extendbeam');
ok(RS.src === s.str(b1, 'GlobalId'), 'a beam picked in the 3D view is the first beam when the tool starts', String(RS.src));
ok(state.hint === 'model.hint.extendbeam2', 'the hint then asks for the beam to extend it to', state.hint);
let o = ov();
ok(o.lines.length === 5 && o.dashed.length === 1, "the plan shows the level's beams, the chosen one dashed", o.lines.length + ' lines / ' + o.dashed.length + ' dashed');
sel = [b2];
E.picked();
ok(!!state.op && state.meta.label === 'model.tool.extendbeam', 'picking the second beam in 3D makes the change (one undo step, nothing left selected)', JSON.stringify(state.meta));
await s.apply('Extend beam', state.op);
US.data = {}; E.refresh();   // what a reload does
const r1u = B.readBeam(api, mid, b1);
ok(r1u.ok && near3(r1u.R, [3900, 0, 2500], 1), 'B-1 ran on to B-2', r1u.ok ? f3(r1u.L) + ' → ' + f3(r1u.R) : r1u.why);
ok(RS.src === s.str(b1, 'GlobalId'), 'and stays the first beam for the next one (as a trim keeps its edge)');
state.op = null;
E.click([3600, 1000]);   // on B-3's line on the plan
ok(!!state.op, 'clicking the beam to extend to on the plan makes the change too');
await s.apply('Extend beam', state.op);
US.data = {}; E.refresh();
const r1v = B.readBeam(api, mid, b1);
ok(r1v.ok && near3(r1v.R, [3500, 0, 2500], 1), 'B-1 now ends at B-3\'s face, at 3500 (it had run past it)', r1v.ok ? f3(r1v.L) + ' → ' + f3(r1v.R) : r1v.why);
ok(beamAt([3600, 1000])?.name === 'B-3', 'the plan hit test knows which beam is under the pointer', beamAt([3600, 1000])?.name);
state.status = '';
E.click([0, 5000]);
ok(state.status === 'model.err.beam.nobeam' && state.statusErr, 'a click away from every beam says which beam to click', state.status);
US.tool = 'select'; E.toolChanged('select');
sel = [];   // nothing picked in 3D now: the first beam comes from the plan
US.tool = 'extendbeam'; E.toolChanged('extendbeam');
E.click([2000, 0]);
E.move([3600, 1000]);
const o2 = ov();
ok(RS.src === s.str(b1, 'GlobalId') && !!o2.hud && /[0-9]/.test(String(o2.hud.text)), 'hovering the beam to extend to shows where it would end and how long it would be', o2.hud && o2.hud.text);
ok(E.escape() === true && RS.src === null, 'Esc lets go of the first beam');
ok(E.escape() === false, 'and Esc again does nothing');

console.log('== the file it saves');
const bytes = await s.save();
ok(bytes && bytes.length > 1000, 'the model saves (' + (bytes || []).length + ' bytes)');
const txt = new TextDecoder().decode(bytes);
ok(txt.includes('IFCEXTRUDEDAREASOLID') && (txt.match(/ENDSEC;/g) || []).length >= 2, 'with its geometry and its sections');
const refs = new Set([...txt.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
const dangling = [...txt.matchAll(/#(\d+)/g)].filter((m) => !refs.has(m[1]));
ok(dangling.length === 0, 'no dangling references', dangling.slice(0, 3).map((m) => m[0]).join(' '));

console.log((bad ? 'FAIL ' : 'ok ') + good + ' ok, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
