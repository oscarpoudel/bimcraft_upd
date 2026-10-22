/* SPDX-License-Identifier: Apache-2.0 */
/**
 * model-beams.js — beams drawn on the plan (0.6, session `bim-draw`: "feature to add beams"). No DOM:
 * tests/tools/bimcraft-test/beam-create-test.mjs runs it in Node. Plan millimetres in the storey's own axes.
 *
 * A beam is IfcBeam (IFC4 .BEAM.) contained in its level, drawn from one point to another: its body is its section (a
 * rectangle, Width across, Depth down) swept along the line, so its top sits at the level's top (plus TopOffset, mm:
 * positive is higher) and its centre line half a depth below that. The solid's own placement carries the frame, with its
 * Z along the beam, so model-beam-extend.js finds the beam's axis and can extend it like any other straight beam.
 * Concrete material, Pset_BeamCommon (IsExternal false, LoadBearing true), Qto_BeamBaseQuantities (Length,
 * CrossSectionArea, NetVolume), CadCraft_Beam (Width, Depth, TopOffset) so the tools know a beam they made.
 *
 *   BEAM_DEFAULTS, readBeams(w, storey?) → [{ id, guid, storey, a: [x, y], b: [x, y], width, depth, topOffset, length }]
 *   placeBeams({ storey (guid), a, b, width, depth, topOffset }) → op (one undo step) · placeBeams({ storey, beams: [{ a, b }], … })
 *   removeBeams(guids) → op
 *   Errors: model.err.beam.size (a section under 50 mm), model.err.beam.len (ends under 100 mm apart).
 *
 * The ends are read from the beam's own solid (model-beam-extend.js readBeam), not kept in a set beside it, so a beam
 * that was extended or moved still reads back where it is.
 */
import { op } from './model-ops.js';
import { readLevels } from './model-levels.js';
import { ids, val, inv4, apply4 } from './ifc-util.js';
import { round } from './model-write.js';
import { readBeam } from './model-beam-extend.js';
import { markStructural } from './model-part-write.js';

export const BEAM_PSET = 'CadCraft_Beam';
const IN = 25.4;
export const BEAM_DEFAULTS = { width: 8 * IN, depth: 16 * IN, topOffset: 0 };
const refuse = (key) => { throw Object.assign(new Error(key), { key }); };

/** The beams of a model (both beam classes), read back from their solids: points in the storey's plan axes. */
export function readBeams(w, storey = null) {
  const out = [];
  let list = [];
  try { list = [...ids(w.api, w.mid, 'IFCBEAM'), ...ids(w.api, w.mid, 'IFCBEAMSTANDARDCASE')]; } catch (e) { return out; }
  const so = w.storeyOf();
  for (const id of list) {
    const ps = w.readPset(id, BEAM_PSET);
    if (!ps) continue;
    const st = so.get(id);
    if (storey !== null && st !== storey) continue;
    const r = readBeam(w.api, w.mid, id);
    if (!r.ok) continue;
    let M = null;
    try { M = w.storeyWorld(st); } catch (e) { M = null; }
    const a = M ? apply4(inv4(M), r.L[0], r.L[1], r.L[2]) : r.L;
    const b = M ? apply4(inv4(M), r.R[0], r.R[1], r.R[2]) : r.R;
    const u = w.unitMm;
    out.push({
      id, guid: val(w.api.GetLine(w.mid, id, false)?.GlobalId), storey: st, a: [a[0], a[1]], b: [b[0], b[1]],
      width: Number(ps.Width) * u, depth: Number(ps.Depth) * u, topOffset: (Number(ps.TopOffset) || 0) * u,
      length: Math.hypot(r.R[0] - r.L[0], r.R[1] - r.L[1], r.R[2] - r.L[2]),
    });
  }
  return out;
}

/** Write a beam. */
function writeBeam(w, b) {
  if (!(Number(b.width) >= 50) || !(Number(b.depth) >= 50)) refuse('model.err.beam.size');
  const [ax, ay] = b.a || [], [bx, by] = b.b || [];
  if (![ax, ay, bx, by].every(Number.isFinite)) refuse('model.err.beam.len');
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if (!(len >= 100)) refuse('model.err.beam.len');
  const st = w.api.GetLine(w.mid, b.storey, false);
  if (!st?.ObjectPlacement) refuse('model.err.nolevel');
  const lv = readLevels(w).find((l) => l.id === b.storey);
  const h = Number(lv?.height) > 0 ? Number(lv.height) : 3000;
  const zc = h + (Number(b.topOffset) || 0) - Number(b.depth) / 2;
  const u = [dx / len, dy / len, 0];            // the beam's own axis (local Z of its solid's frame)
  const X = [-u[1], u[0], 0];                   // across it, level (local X: the section's Width)
  const pos = w.axisFrame([ax, ay, zc], u, X);  // local Y is then up: the section's Depth
  const prof = w.profile([[-b.width / 2, -b.depth / 2], [b.width / 2, -b.depth / 2], [b.width / 2, b.depth / 2], [-b.width / 2, b.depth / 2]]);
  const name = 'Beam';   // i18n-ignore: IFC Name (a person renames it in Properties)
  const args = [b.guid || w.guid(), w.ownerHistory(), w.L(name), null, null,
    w.H(w.placeAt(st.ObjectPlacement.value, 0, 0, 0, 0)), null, null];
  if (w.v4) args.push('BEAM');
  const id = w.make('IFCBEAM', ...args);
  w.contain(id, b.storey);
  w.associateMaterial(id, w.material('Concrete'));   // i18n-ignore: material name in the file
  markStructural(w, id);
  w.setShape(id, [w.rep('body', 'Body', 'SweptSolid', [w.extrudeAt(prof, pos, len)])]);
  const area = Number(b.width) * Number(b.depth);
  w.upsertPset(id, 'Pset_BeamCommon', [['IsExternal', 'IFCBOOLEAN', false], ['LoadBearing', 'IFCBOOLEAN', true]]);
  w.upsertQto(id, 'Qto_BeamBaseQuantities', [['Length', 'length', len], ['CrossSectionArea', 'area', area], ['NetVolume', 'volume', area * len]]);
  w.upsertPset(id, BEAM_PSET, [
    ['Width', 'IFCLENGTHMEASURE', round(w.u(b.width))], ['Depth', 'IFCLENGTHMEASURE', round(w.u(b.depth))],
    ['TopOffset', 'IFCLENGTHMEASURE', round(w.u(b.topOffset || 0))],
  ]);
  return id;
}

/** Draw one beam, or a run of them ({ beams: [{ a, b }, …] }): one undo step. */
export function placeBeams(spec) {
  const s = { ...BEAM_DEFAULTS, ...spec };
  const guids = [];
  return op((w) => {
    const st = w.byGuid(s.storey);
    if (!st) refuse('model.err.nolevel');
    const list = s.beams || [{ a: s.a, b: s.b }];
    const made = new Map(), out = [];
    list.forEach((b, i) => {
      if (!guids[i]) guids[i] = val(w.guid());
      const id = writeBeam(w, { ...s, guid: guids[i], storey: st, a: b.a, b: b.b });
      made.set(guids[i], id); out.push(id);
    });
    return { id: out[0] ?? null, ids: out, made };
  });
}

export function removeBeams(guids) {
  return op((w) => {
    const list = guids.map((g) => w.byGuid(g)).filter(Boolean);
    if (list.length) w.dropProduct(list);
    return { id: null, ids: [] };
  });
}
