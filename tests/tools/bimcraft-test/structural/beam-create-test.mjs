#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * beam-create-test.mjs — Build › Beam without a screen (model-beams.js) and the Draw tab's Parts view (model-part.js):
 * an IFC4 file made here with one storey, a beam drawn into it through the same IfcEditor the window uses (one undo
 * step), read back from its own property set and from its mesh, then extended to a second beam with Modify › Extend beam
 * — the two features agreeing on the same beam.
 *
 *   npm test -- --only test-bimcraft-structural.mjs        # or, standalone:
 *   CADCRAFT_APPS=<folder holding bimcraft/ → the app's own folder> node tests/tools/bimcraft-test/structural/beam-create-test.mjs
 */
import { IfcSession } from '../../cli/headless/ifc.mjs';
import { load } from '../../cli/headless/apps.mjs';

let bad = 0, good = 0;
const ok = (cond, label, detail = '') => { if (cond) good++; else bad++; console.log((cond ? '  ok   ' : '  FAIL ') + label + (!cond && detail ? ' (' + detail + ')' : '')); };
const near = (a, b, e = 0.5) => Number.isFinite(a) && Math.abs(a - b) <= e;
const near3 = (a, b, e = 0.5) => near(a[0], b[0], e) && near(a[1], b[1], e) && near(a[2], b[2], e);
const f3 = (a) => a.map((v) => Math.round(v * 10) / 10).join(', ');

/** A small IFC4 file we own: a project, a site and one storey at elevation 0 (its height falls back to 3000 mm). */
function storeyFixture() {
  const L = [];
  let n = 0;
  const line = (s) => { n++; L.push('#' + n + '=' + s + ';'); return '#' + n; };
  const str = (s) => (s === null || s === undefined ? '$' : "'" + String(s).replace(/'/g, "''") + "'");
  const list = (a) => '(' + a.join(',') + ')';
  const pt = (p) => line('IFCCARTESIANPOINT(' + list(p.map((v) => Number(v).toFixed(1))) + ')');
  const dir = (d) => line('IFCDIRECTION(' + list(d.map((v) => Number(v).toFixed(1))) + ')');
  const ax3 = (p, z, x) => line('IFCAXIS2PLACEMENT3D(' + pt(p) + ',' + (z ? dir(z) : '$') + ',' + (x ? dir(x) : '$') + ')');
  const place = (rel, p) => line('IFCLOCALPLACEMENT(' + (rel || '$') + ',' + ax3(p) + ')');
  const guid = (k) => str(('0BimCraftBeamMake' + k).slice(0, 22));
  const oh = line('IFCOWNERHISTORY($,$,$,.NOCHANGE.,$,$,$,0)');
  const units = line('IFCUNITASSIGNMENT(' + list([
    line('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)'), line('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'),
    line('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'), line('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)')]) + ')');
  const ctx = line("IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05," + ax3([0, 0, 0]) + ',$)');
  line("IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*," + ctx + ',$,.MODEL_VIEW.,$)');
  const project = line('IFCPROJECT(' + guid('P') + ',' + oh + ",'Beam make fixture',$,$,$,$," + list([ctx]) + ',' + units + ')');
  const sitePl = place(null, [0, 0, 0]);
  const site = line('IFCSITE(' + guid('S') + ',' + oh + ",'Site',$,$," + sitePl + ',$,$,.ELEMENT.,$,$,$,$,$)');
  const bldPl = place(sitePl, [0, 0, 0]);
  const building = line('IFCBUILDING(' + guid('B') + ',' + oh + ",'Fixture building',$,$," + bldPl + ',$,$,.ELEMENT.,$,$,$)');
  const stPl = place(bldPl, [0, 0, 0]);
  const st = line('IFCBUILDINGSTOREY(' + guid('L') + ',' + oh + ",'Level 1',$,$," + stPl + ',$,$,.ELEMENT.,0.)');
  line('IFCRELAGGREGATES(' + guid('R1') + ',' + oh + ',$,$,' + project + ',' + list([site]) + ')');
  line('IFCRELAGGREGATES(' + guid('R2') + ',' + oh + ',$,$,' + site + ',' + list([building]) + ')');
  line('IFCRELAGGREGATES(' + guid('R3') + ',' + oh + ',$,$,' + building + ',' + list([st]) + ')');
  return { text: L.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n', storey: st };
}

const { text: body } = storeyFixture();
const file = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME('beam-create.ifc','2026-01-01T00:00:00',(''),(''),'BimCraft','BimCraft','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n" + body;

const s = await IfcSession.open(new TextEncoder().encode(file), 'beam-create.ifc');
const Make = await load('bimcraft', 'model-beams.js');
const Ext = await load('bimcraft', 'model-beam-extend.js');
const Part = await load('bimcraft', 'model-part.js');
const { ModelWriter } = await load('bimcraft', 'model-write.js');
const ed = await s.editor();
const api = ed.api, mid = ed.mid, unitMm = ed.placer().unitMm;
const W = () => new ModelWriter(ed.W, api, mid);
const storeyGuid = s.str(s.f.ofType('IFCBUILDINGSTOREY', true)[0], 'GlobalId');

console.log('== Parts: the class rule and the explicit labels');
ok(Part.classPart('IfcBeam') === 'structure' && Part.classPart('IfcColumn') === 'structure' && Part.classPart('IfcFooting') === 'structure', 'beams, columns and footings are structure');
ok(Part.classPart('IfcWallStandardCase') === 'architecture' && Part.classPart('IfcDoor') === 'architecture' && Part.classPart('IfcSpace') === 'architecture', 'walls, doors and rooms are architecture');
ok(Part.classPart('IfcSlab') === null && Part.classPart('IfcDuctSegment') === null, 'a slab or a duct is in every part view');
const cp = Part.classParts({ keyBase: 10, classOf: new Map([[1, 'IfcBeam'], [2, 'IfcWall'], [3, 'IfcSlab'], [4, 'IfcColumn']]) });
ok(cp.get(11) === 'structure' && cp.get(12) === 'architecture' && cp.get(14) === 'structure' && !cp.has(13), 'classParts keys the class rule by element key, and leaves slabs out', JSON.stringify([...cp]));
const fakeApi = {
  GetTypeCodeFromName: (n) => n,
  GetLineIDsWithType: () => ({ size: () => 1, get: () => 10 }),
  GetLine: (m, id) => (id === 10
    ? { RelatingGroup: { value: 20 }, RelatedObjects: [{ value: 7 }, { value: 8 }] }
    : { Name: { value: 'StructAlign Structure' } }),
};
const lp = Part.labelParts(fakeApi, 1, { keyBase: 100, classOf: new Map([[7, 'IfcWall'], [8, 'IfcDoor'], [9, 'IfcBeam']]) }, null);
ok(lp.get(107) === 'structure' && lp.get(108) === 'structure' && !lp.has(109), 'a file\'s label wins over the class: its wall and door are structure, its unlabelled beam is not placed', JSON.stringify([...lp]));

console.log('== placeBeams: a beam on the plan');
const r = await s.apply('Beam', Make.placeBeams({ storey: storeyGuid, a: [0, 0], b: [4000, 0], width: 200, depth: 400 }));
ok(r && r.ids.length === 1 && s.f.ofType('IFCBEAM', true).includes(r.id), 'the op makes one IfcBeam and says which', JSON.stringify(r && r.ids));
const beam1 = r.id;
const read1 = Make.readBeams(W())[0];
ok(read1 && near3([read1.a[0], read1.a[1], 0], [0, 0, 0]) && near3([read1.b[0], read1.b[1], 0], [4000, 0, 0]), 'read back: it runs from (0, 0) to (4000, 0) on the plan', read1 ? f3([read1.a[0], read1.a[1], 0]) + ' → ' + f3([read1.b[0], read1.b[1], 0]) : 'none');
ok(read1 && near(read1.width, 200) && near(read1.depth, 400) && near(read1.length, 4000), 'its section is 200 × 400 and its length 4000', read1 ? [read1.width, read1.depth, read1.length].join(' / ') : '');
const e1 = Ext.readBeam(api, mid, beam1);
ok(e1.ok, 'Extend beam reads it as one straight extruded solid', e1.why);
ok(e1.ok && near3(e1.L, [0, 0, 2800], 1) && near3(e1.R, [4000, 0, 2800], 1), 'its top sits at the level top (3000): the axis is at 2800', e1.ok ? f3(e1.L) + ' → ' + f3(e1.R) : e1.why);
const m1 = Ext.beamMesh(api, mid, beam1, unitMm);
ok(m1 && near3(m1.a3, e1.L, 1) && near3(m1.b3, e1.R, 1), 'its mesh lies on the same axis: what the plan draws and what the tool changes agree', m1 ? f3(m1.a3) + ' → ' + f3(m1.b3) : 'no mesh');
const ys = m1 ? m1.verts.map((v) => v[1]) : [], zs = m1 ? m1.verts.map((v) => v[2]) : [];
ok(m1 && near(Math.max(...ys) - Math.min(...ys), 200, 1) && near(Math.max(...zs) - Math.min(...zs), 400, 1), 'and it is 200 wide and 400 deep', m1 ? [Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)].join(' / ') : '');
ok(near(Math.max(...zs), 3000, 1), 'its top is the level top', String(Math.max(...zs)));

console.log('== a second beam, and Extend beam on what the tool made');
const r2 = await s.apply('Beam', Make.placeBeams({ storey: storeyGuid, a: [5000, -1000], b: [5000, 1000], width: 200, depth: 400 }));
const beam2 = r2.id;
const m2 = Ext.beamMesh(api, mid, beam2, unitMm);
ok(!!m2, 'the crossing beam has an axis too');
const plan = Ext.extendPlan(m1, m2);
ok(!plan.error && near3(plan.target, [4900, 0, 2800], 1) && near(plan.newLen, 4900), 'the first runs to the second\'s near face at x 4900', plan.error || f3(plan.target) + ' / ' + plan.newLen);
await s.apply('Extend beam', Ext.extendBeam({ guid: s.str(beam1, 'GlobalId'), target: plan.target, movingEnd: plan.movingEnd }));
const e1b = Ext.readBeam(api, mid, beam1);
ok(e1b.ok && near3(e1b.R, [4900, 0, 2800], 1) && near(e1b.depthMm, 4900, 1), 'the drawn beam is now 4900 long', e1b.ok ? f3(e1b.R) + ' / ' + e1b.depthMm : e1b.why);
const back = Make.readBeams(W())[0];
ok(back && near(back.length, 4900), 'and its own property set follows (the plan reads it back)', back ? String(back.length) : 'none');

console.log('== refusals change nothing');
const before = s.f.ofType('IFCBEAM', true).length;
try {
  await s.apply('Beam', Make.placeBeams({ storey: storeyGuid, a: [0, 5000], b: [3000, 5000], width: 40, depth: 400 }));
  ok(false, 'a 40 mm wide beam is refused');
} catch (e) { ok(e.key === 'model.err.beam.size', 'a 40 mm wide beam is refused, with a reason the plan can say', String(e.key || e.message)); }
try {
  await s.apply('Beam', Make.placeBeams({ storey: storeyGuid, a: [0, 6000], b: [50, 6000] }));
  ok(false, 'a 50 mm long beam is refused');
} catch (e) { ok(e.key === 'model.err.beam.len', 'two points 50 mm apart are refused', String(e.key || e.message)); }
ok(s.f.ofType('IFCBEAM', true).length === before, 'nothing was written by either refusal', String(s.f.ofType('IFCBEAM', true).length));

console.log(bad ? `\n${bad} failed, ${good} ok` : `\nall ${good} ok`);
process.exit(bad ? 1 : 0);
