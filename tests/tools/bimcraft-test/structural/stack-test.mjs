#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * stack-test.mjs — Select vertical stack without a screen (model-frame-stack.js, model-frame-move-ui.js): two storeys,
 * columns and beams each with (or without) a counterpart directly above, read through cc-ifc the way the plan reads
 * them. One seed matches its own stack; several seeds at different places match their own stacks at once, and the
 * union is what the selection becomes.
 *
 *   npm test -- --only test-bimcraft-structural.mjs        # or, standalone:
 *   CADCRAFT_APPS=<folder holding bimcraft/ → the app's own folder> node tests/tools/bimcraft-test/structural/stack-test.mjs
 *   (the repository itself has no public_html build, so the app's modules are found through CADCRAFT_APPS; see
 *    tests/tools/cli/headless/apps.mjs)
 */
import { IfcSession } from '../../cli/headless/ifc.mjs';
import { load } from '../../cli/headless/apps.mjs';

let bad = 0, good = 0;
const ok = (cond, label, detail = '') => { if (cond) good++; else bad++; console.log((cond ? '  ok   ' : '  FAIL ') + label + (!cond && detail ? ' (' + detail + ')' : '')); };
const setEq = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message)); } };

/**
 * A small IFC4 file we own: two storeys (Level 1 at 0, Level 2 at 4000), 300 × 300 columns 4000 tall and 200 × 300
 * beams, each body one IfcExtrudedAreaSolid.
 *
 *   Level 1   C-1 (0, 0)        C-2 (6000, 0)     C-5 (12000, 0)     C-6 (12000, 4000, no shape)
 *             B-1 x 0…6000, y 3000, axis z 3000   B-2 x 0…6000, y 4000   B-5 x 0…6000, y 8000
 *   Level 2   C-3 (0, 0)        C-4 (6000, 0)
 *             B-3 x 0…6000, y 3000, axis z 7000   B-4 x 0…6000, y 4000
 *
 * C-3 sits on C-1 and C-4 on C-2; B-3 runs over B-1 and B-4 over B-2. C-5, B-5 and C-6 have no counterpart.
 */
function stackFixture() {
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
  const guid = (k) => str(('0BimCraftStackFix' + k).slice(0, 22));

  const oh = line('IFCOWNERHISTORY($,$,$,.NOCHANGE.,$,$,$,0)');
  const units = line('IFCUNITASSIGNMENT(' + list([
    line('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)'), line('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'),
    line('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'), line('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)')]) + ')');
  const ctx = line("IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05," + ax3([0, 0, 0]) + ',$)');
  const body = line("IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*," + ctx + ',$,.MODEL_VIEW.,$)');
  const project = line('IFCPROJECT(' + guid('P') + ',' + oh + ",'Stack fixture',$,$,$,$," + list([ctx]) + ',' + units + ')');
  const sitePl = place(null, [0, 0, 0]);
  const site = line('IFCSITE(' + guid('S') + ',' + oh + ",'Site',$,$," + sitePl + ',$,$,.ELEMENT.,$,$,$,$,$)');
  const bldPl = place(sitePl, [0, 0, 0]);
  const building = line('IFCBUILDING(' + guid('B') + ',' + oh + ",'Fixture building',$,$," + bldPl + ',$,$,.ELEMENT.,$,$,$)');
  const l1Pl = place(bldPl, [0, 0, 0]);
  const l1 = line('IFCBUILDINGSTOREY(' + guid('L1') + ',' + oh + ",'Level 1',$,$," + l1Pl + ',$,$,.ELEMENT.,0.)');
  const l2Pl = place(l1Pl, [0, 0, 4000]);
  const l2 = line('IFCBUILDINGSTOREY(' + guid('L2') + ',' + oh + ",'Level 2',$,$," + l2Pl + ',$,$,.ELEMENT.,4000.)');
  line('IFCRELAGGREGATES(' + guid('R1') + ',' + oh + ',$,$,' + project + ',' + list([site]) + ')');
  line('IFCRELAGGREGATES(' + guid('R2') + ',' + oh + ',$,$,' + site + ',' + list([building]) + ')');
  line('IFCRELAGGREGATES(' + guid('R3') + ',' + oh + ',$,$,' + building + ',' + list([l1, l2]) + ')');

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  /** One member of `cls` from a to b: width × depth profile swept along a→b; shape = false leaves it without one. */
  const members = [];
  function member(key, cls, name, a, b, width, depth, shape = true) {
    const axis = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const helper = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const X = unit(cross(helper, axis));
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let shapeRef = '$';
    if (shape) {
      const prof = line("IFCRECTANGLEPROFILEDEF(.AREA.," + str(width + 'x' + depth) + ',' + line('IFCAXIS2PLACEMENT2D(' + pt([0, 0]) + ',$)') + ',' + num(width) + ',' + num(depth) + ')');
      const es = line('IFCEXTRUDEDAREASOLID(' + prof + ',' + ax3([0, 0, 0], axis, X) + ',' + dir([0, 0, 1]) + ',' + num(length) + ')');
      shapeRef = line('IFCPRODUCTDEFINITIONSHAPE($,$,' + list([line("IFCSHAPEREPRESENTATION(" + body + ",'Body','SweptSolid'," + list([es]) + ')')]) + ')');
    }
    const id = line(cls + '(' + guid(key) + ',' + oh + ',' + str(name) + ',$,$,' + place(null, a) + ',' + shapeRef + ',$)');
    members.push({ id, key, name });
    return id;
  }
  const l1m = [], l2m = [];
  const put = (arr) => (key, cls, name, a, b, w, d, s = true) => arr.push(member(key, cls, name, a, b, w, d, s));
  const M1 = put(l1m), M2 = put(l2m);
  M1('C1', 'IFCCOLUMN', 'C-1', [0, 0, 0], [0, 0, 4000], 300, 300);
  M1('C2', 'IFCCOLUMN', 'C-2', [6000, 0, 0], [6000, 0, 4000], 300, 300);
  M1('C5', 'IFCCOLUMN', 'C-5', [12000, 0, 0], [12000, 0, 4000], 300, 300);
  M1('C6', 'IFCCOLUMN', 'C-6', [12000, 4000, 0], [12000, 4000, 4000], 300, 300, false);
  M1('B1', 'IFCBEAM', 'B-1', [0, 3000, 3000], [6000, 3000, 3000], 200, 300);
  M1('B2', 'IFCBEAM', 'B-2', [0, 4000, 3000], [6000, 4000, 3000], 200, 300);
  M1('B5', 'IFCBEAM', 'B-5', [0, 8000, 3000], [6000, 8000, 3000], 200, 300);
  M2('C3', 'IFCCOLUMN', 'C-3', [0, 0, 4000], [0, 0, 8000], 300, 300);
  M2('C4', 'IFCCOLUMN', 'C-4', [6000, 0, 4000], [6000, 0, 8000], 300, 300);
  M2('B3', 'IFCBEAM', 'B-3', [0, 3000, 7000], [6000, 3000, 7000], 200, 300);
  M2('B4', 'IFCBEAM', 'B-4', [0, 4000, 7000], [6000, 4000, 7000], 200, 300);
  line('IFCRELCONTAINEDINSPATIALSTRUCTURE(' + guid('RL1') + ',' + oh + ',$,$,' + list(l1m) + ',' + l1 + ')');
  line('IFCRELCONTAINEDINSPATIALSTRUCTURE(' + guid('RL2') + ',' + oh + ',$,$,' + list(l2m) + ',' + l2 + ')');
  return { text: L.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n' };
}

const { text } = stackFixture();
const file = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME('stack-test.ifc','2026-01-01T00:00:00',(''),(''),'BimCraft','BimCraft','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n" + text;

const s = await IfcSession.open(new TextEncoder().encode(file), 'stack-test.ifc');
const S = await load('bimcraft', 'model-frame-stack.js');
const ed = await s.editor();
const unitMm = ed.placer().unitMm;
const byName = (name) => s.elements.find((id) => String(s.str(id, 'Name')) === name);

const c1 = byName('C-1'), c2 = byName('C-2'), c3 = byName('C-3'), c4 = byName('C-4'), c5 = byName('C-5'), c6 = byName('C-6');
const b1 = byName('B-1'), b2 = byName('B-2'), b3 = byName('B-3'), b4 = byName('B-4'), b5 = byName('B-5');

console.log('== the fixture reads back');
ok([c1, c2, c3, c4, c5, c6, b1, b2, b3, b4, b5].every(Boolean), 'eleven columns and beams by name', [c1, c2, c3, c4, c5, c6, b1, b2, b3, b4, b5].join());
ok(unitMm === 1, 'millimetre units', String(unitMm));
// The model object the plan passes to stack matching: classes and storeys of the elements it drew.
const classOf = new Map();
for (const id of s.elements) classOf.set(id, s.pretty(id));
const model = {
  keyBase: 0, classOf,
  storeys: s.storeyIds.map((id) => ({ id, name: s.attrText(id, 'Name') })),
  storeyOf: new Map(s.elements.map((id) => [id, s.storeyOf(id)])),
};
ok(model.classOf.get(c1) === 'IfcColumn' && model.classOf.get(b1) === 'IfcBeam', 'the classes are what the plan sees', model.classOf.get(c1) + ' / ' + model.classOf.get(b1));

console.log('== one seed: its own stack (as before)');
const rC1 = S.readVerticalStack(ed, model, c1);
ok(setEq(rC1.keys, [c1, c3]), 'C-1 brings back C-3 above it and nothing else', rC1.keys.join());
ok(rC1.stacks === 1 && rC1.members.length === 2, 'one stack, two members', String(rC1.stacks) + ' / ' + rC1.members.length);
const rB1 = S.readVerticalStack(ed, model, b1);
ok(setEq(rB1.keys, [b1, b3]), 'B-1 brings back B-3 above it', rB1.keys.join());
ok(throws(() => S.readVerticalStack(ed, model, 999999), /Select one beam or column/), 'a member that is not a beam or column is refused');

console.log('== two columns at different places: both stacks at once');
const r2c = S.readVerticalStacks(ed, model, [c1, c2]);
ok(setEq(r2c.keys, [c1, c3, c2, c4]), 'C-1 and C-2 each bring their own counterpart; C-5 and C-6 stay out', r2c.keys.join());
ok(r2c.stacks === 2, 'two stacks, not one', String(r2c.stacks));
ok(r2c.members.length === 4 && r2c.skipped === 1, 'four members; the shapeless C-6 is counted as unreadable', String(r2c.members.length) + ' / ' + r2c.skipped);

console.log('== two beams at different places: both stacks, the lone one stays out');
const r2b = S.readVerticalStacks(ed, model, [b1, b2]);
ok(setEq(r2b.keys, [b1, b3, b2, b4]), 'B-1 and B-2 each bring their own counterpart; B-5 stays out', r2b.keys.join());
ok(r2b.stacks === 2, 'two stacks', String(r2b.stacks));
ok(!r2b.keys.includes(c1) && !r2b.keys.includes(c2), 'beams do not pull in the columns', r2b.keys.join());

console.log('== a column and a beam together: each keeps its own kind');
const rmix = S.readVerticalStacks(ed, model, [c1, b1]);
ok(setEq(rmix.keys, [c1, c3, b1, b3]), 'the column stack and the beam stack, together', rmix.keys.join());
ok(rmix.stacks === 2, 'two stacks', String(rmix.stacks));

console.log('== the same stack from both floors: one stack, nothing duplicated');
const rsame = S.readVerticalStacks(ed, model, [c1, c3]);
ok(setEq(rsame.keys, [c1, c3]) && rsame.stacks === 1, 'picking both members of one stack selects it once', rsame.keys.join() + ' / ' + rsame.stacks);

console.log('== a member without a counterpart: its own one-member stack');
ok(setEq(S.readVerticalStacks(ed, model, [c5]).keys, [c5]), 'C-5 selects only itself', '');
ok(setEq(S.readVerticalStacks(ed, model, [b5]).keys, [b5]), 'B-5 selects only itself', '');
ok(throws(() => S.readVerticalStacks(ed, model, [c1, c6]), /no readable frame axis/), 'a seed without a readable axis is refused, with a reason');
ok(throws(() => S.readVerticalStacks(ed, model, []), /Select at least one/), 'an empty selection is refused');
ok(throws(() => S.readVerticalStacks(ed, model, [b1, 999999]), /Select beams or columns/), 'a non-member in a multi-selection is refused');

console.log('== the button on the model bar (model-frame-move-ui.js)');
const makeBtn = () => {
  const b = { type: '', className: '', dataset: {}, textContent: '', hidden: true, disabled: false, title: '', listeners: {},
    addEventListener: (ev, fn) => { b.listeners[ev] = fn; }, setAttribute() {} };
  return b;
};
let theButton = null;
globalThis.window = globalThis.window || {};
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => { fn(); return 0; });
globalThis.document = { createElement: () => (theButton = makeBtn()) };
let ext = null, sel = [];
const state = { status: '', statusErr: false };
const US = { tool: 'select', on: true, level: s.storeyIds[0], planM: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], data: {} };
const ui = {
  S: US, t: (k) => k, units: () => 'mm', ed: () => ed, kb: () => 0,
  pv: () => null,
  root: { querySelector: () => null },
  host: {
    model: () => model, status: (text, err) => { state.status = text; state.statusErr = !!err; },
    select: (keys) => { sel = [...keys]; },
  },
  selectedKeys: () => [...sel],
  commit: () => {},
  setTool: (t) => { US.tool = t; },
  snapFrom: (p, e, from) => ({ p, kind: 'free' }),
  extend: (x) => { ext = x; return ui; },
};
const { mountFrameMove } = await load('bimcraft', 'model-frame-move-ui.js');
mountFrameMove(ui);
ok(theButton && theButton.dataset.frameStack !== undefined, 'the button is on the model bar', String(!!theButton));
sel = []; ext.refresh();
ok(theButton.hidden === true, 'the button hides with nothing selected');
sel = [c1]; ext.refresh();
ok(theButton.hidden === false && theButton.textContent === 'Select vertical stack', 'one column shows it', theButton.textContent);
sel = [c1, c2]; ext.refresh();
ok(theButton.hidden === false, 'two beams or columns at different places show it too');
state.status = '';
await theButton.listeners.click();
ok(setEq(sel, [c1, c3, c2, c4]), 'clicking selects the union of both stacks', sel.join());
ok(!state.statusErr && /Selected 4 aligned frame members in 2 vertical stacks/.test(state.status), 'and says how many stacks it found', state.status);
ok(theButton.textContent === 'Clear stacks (4)', 'the button becomes Clear stacks (4)', theButton.textContent);
await theButton.listeners.click();
ok(setEq(sel, [c1, c2]), 'Clear restores the selection it started from', sel.join());
ok(theButton.textContent === 'Select vertical stack' && theButton.hidden === false, 'and the button is ready again', theButton.textContent);
// one member of one stack, then Clear: back to the single seed, as before
sel = [b1]; ext.refresh();
await theButton.listeners.click();
ok(setEq(sel, [b1, b3]), 'a single seed still selects its whole stack', sel.join());
await theButton.listeners.click();
ok(setEq(sel, [b1]), 'Clear gives back the single seed', sel.join());

console.log((bad ? 'FAIL ' : 'ok ') + good + ' ok, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
