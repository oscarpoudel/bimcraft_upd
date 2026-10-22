/* SPDX-License-Identifier: Apache-2.0 */
/**
 * model-beam-extend.js — extend a beam to another beam (0.6, Modify › Extend beam). No DOM: the geometry, the maths and the
 * op run in Node (tests/tools/bimcraft-test/beam-extend-test.mjs), the same way model-trim.js does for walls.
 *
 * A beam's axis is read from its flat mesh (the same mesh the 3D view shows: an I-shape, a round bar, a mapped item — any
 * body), so picking and the preview work on what the person sees. The mesh is brought back into the model's own frame first
 * (the viewer hands it out in the coordination frame that places the model on the survey), so it sits where the beam's own
 * placement says and the plan draws it where the model is. The change itself is only made to a beam whose body is one
 * straight IfcExtrudedAreaSolid (directly, or one IfcMappedItem deep): its profile and placement stay, only the end moves —
 * the extrusion's direction and Depth, and for the start end a new Axis2Placement3D with the location point moved. A beam
 * clipped with a Boolean, a beam of several solids, a beam whose depth is an expression, and a beam that does not meet the
 * other (parallel, a line that does not reach, a different level) are refused before anything changes.
 *
 * Everything in model millimetres, Z up (the file's own axes; the plan's own axes are model-planview's, not this file's).
 *
 *   readBeam(api, mid, id)         → { ok, unitMm, M, L, R, loc, depthMm, PX, PY, PZ, solidId, posId } | { ok: false, why }
 *                                    M: the beam's frame, local mm → model mm; L, R: the extrusion's two ends in model mm;
 *                                    loc: the solid's position point in that frame; PX, PY, PZ: the axes of the solid's own
 *                                    Position frame (the extrusion direction is written in that frame)
 *   beamMesh(api, mid, id, unitMm) → { a3, b3, verts } | null   the axis (principal direction) and the mesh, model mm (from
 *                                    the coordination frame the viewer gives, back into the model's own frame); null for a
 *                                    body that is a stub (shorter than 100 mm), where there is no axis to read
 *   lineClosest(a, b, c, d)        → { t, u, pA, pB, dist } | null (parallel)
 *   extendPlan(src, tgt)           → { target, movingEnd, newLen } | { error }   target: on src's own axis, where it meets
 *                                    the face of tgt; movingEnd: src's end that moves (a3 | b3); newLen: what is left
 *   extendBeam({ guid, target, movingEnd }) → op for IfcEditor.modelChange: one undo step, and the beam's Length property
 *                                    and GrossLength quantity follow (only when the element already has them).
 * Errors (lang keys): model.err.beam.parallel, .skew, .miss, .short, .same, .kind, .gone.
 */
import { op } from './model-ops.js';
import { ids, val, lengthUnitMm, productTriangles, inv4, mul4, apply4 } from './ifc-util.js';
import { round, scaleT } from './model-write.js';

const MIN = 50;         // mm: a beam is not left shorter than this (as when a wall is trimmed)
const SKEW_MAX = 150;   // mm: how far apart the two lines may be and still meet (a different level is far more)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const dist3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const norm = (a) => { const l = len3(a); return l < 1e-12 ? [0, 0, 1] : mul(a, 1 / l); };
const err = (key) => ({ error: key });

const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const line = (api, mid, id) => (id ? api.GetLine(mid, id, false) : null);
const ref = (h) => (h && typeof h === 'object' && 'value' in h ? h.value : (typeof h === 'number' ? h : null));
const cls = (l) => (l && l.constructor ? String(l.constructor.name).toUpperCase() : '');
const nums = (list) => (list || []).map((v) => Number(val(v)));
const coords = (api, mid, h) => nums(line(api, mid, ref(h))?.Coordinates);
const ratios = (api, mid, h) => nums(line(api, mid, ref(h))?.DirectionRatios);

/** An IfcAxis2Placement3D's frame in its parent's axes, and a matrix row-major as 3 basis vectors + origin. */
function placementFrame(api, mid, h) {
  const a = line(api, mid, ref(h));
  const O = coords(api, mid, a?.Location);
  const Z = a?.Axis ? norm(ratios(api, mid, a.Axis)) : [0, 0, 1];
  let X = a?.RefDirection ? norm(ratios(api, mid, a.RefDirection)) : null;
  if (!X) { const r = Math.abs(Z[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0]; X = norm(sub(r, mul(Z, dot(r, Z)))); }
  return { X, Y: norm(cross(Z, X)), Z, O };
}

/**
 * The transform an IfcMappedItem adds (file units): the map's origin, its operator's axes and scale, and its local origin.
 * T(p) = O + R · (s · (p − Lo)) — the operator's LocalOrigin is what the map's own geometry is measured from.
 */
function mapMatrix(api, mid, map) {
  if (!map) return null;
  const F = placementFrame(api, mid, map.MappingOrigin);
  const opr = line(api, mid, ref(map.Self));
  if (!opr) return null;
  const s = opr.Scale !== undefined && opr.Scale !== null ? Number(val(opr.Scale)) : 1;
  const axes = [opr.Axis1, opr.Axis2, opr.Axis3].map((h) => (h ? norm(ratios(api, mid, h)) : null));
  const X = axes[0] || F.X, Y1 = axes[1] || F.Y;
  let Z = axes[2] || null;
  const Y = norm(sub(Y1, mul(X, dot(X, Y1))));
  if (!Z) Z = norm(cross(X, Y)); else Z = norm(sub(Z, mul(X, dot(X, Z))));
  const Lo = coords(api, mid, opr.LocalOrigin);
  const O = F.O;
  const R = [X[0] * s, X[1] * s, X[2] * s, Y[0] * s, Y[1] * s, Y[2] * s, Z[0] * s, Z[1] * s, Z[2] * s];
  return [
    R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0,
    O[0] - (R[0] * Lo[0] + R[3] * Lo[1] + R[6] * Lo[2]),
    O[1] - (R[1] * Lo[0] + R[4] * Lo[1] + R[7] * Lo[2]),
    O[2] - (R[2] * Lo[0] + R[5] * Lo[1] + R[8] * Lo[2]),
    1,
  ];
}

/**
 * The beam's body as one straight IfcExtrudedAreaSolid: its frame (local mm → model mm), its position and extrusion in
 * that frame, and its two ends in model mm. A body with a Boolean, several solids, no extrusion, or a depth written as an
 * expression is refused with `why` (the UI says it in its own words; the op says model.err.beam.kind).
 */
export function readBeam(api, mid, id) {
  const el = line(api, mid, id);
  if (!el) return { ok: false, why: 'gone' };
  const unitMm = lengthUnitMm(api, mid);
  const lp = ref(el.ObjectPlacement);
  const M0 = lp ? scaleT(api.GetWorldTransformMatrix(mid, lp), unitMm) : ID;
  const sh = line(api, mid, ref(el.Representation));
  const reps = (sh?.Representations || []).map((h) => line(api, mid, h.value)).filter(Boolean);
  const body = reps.find((r) => /^BODY$/i.test(String(val(r.RepresentationIdentifier) || '')))
    || reps.find((r) => /SWEPT|SOLID|CLIPPING|CSG|MAPPED/i.test(String(val(r.RepresentationType) || ''))) || reps[0];
  let found = null, why = null;
  const walk = (items, M, depth) => {
    if (found || why) return;
    for (const h of items || []) {
      const it = line(api, mid, h.value);
      if (!it) continue;
      const c = cls(it);
      if (c === 'IFCEXTRUDEDAREASOLID') {
        if (found) { why = 'twosolids'; return; }   // two solids: which one is "the beam" is the person's call, not ours
        found = { solid: it, M };
      } else if (c === 'IFCMAPPEDITEM' && depth < 2) {
        const map = line(api, mid, ref(it.MappingSource));
        const Tm = mapMatrix(api, mid, map);
        if (!Tm) { why = 'mapped'; return; }
        walk(map?.Items, mul4(M, scaleT(Tm, unitMm)), depth + 1);
      } else if (c.startsWith('IFCBOOLEAN')) { why = 'boolean'; return; }
      else { why = 'shape'; return; }
    }
  };
  walk(body?.Items, M0, 0);
  if (!found) return { ok: false, why: why || 'nobody' };
  const s = found.solid;
  const pos = line(api, mid, ref(s.Position));
  if (!pos || cls(pos) !== 'IFCAXIS2PLACEMENT3D') return { ok: false, why: 'shape' };
  const raw = ratios(api, mid, s.ExtrusionDirection);
  const sweep = norm(raw.some((v) => v) ? raw : [0, 0, 1]);
  const depthMm = Number(val(s.Depth)) * unitMm;
  if (!Number.isFinite(depthMm) || depthMm <= 0) return { ok: false, why: 'depth' };
  const loc = coords(api, mid, pos.Location).map((v) => v * unitMm);
  const M = found.M;
  // the sweep is along the solid's Position frame (its Axis is that frame's Z), not the placement's: an I-shape is swept
  // along (0, 0, 1) with its Position turned, as often as not
  const F = placementFrame(api, mid, s.Position);
  const dir = norm(add(add(mul(F.X, sweep[0]), mul(F.Y, sweep[1])), mul(F.Z, sweep[2])));
  const L = apply4(M, loc[0], loc[1], loc[2]);
  const R = add(L, mul([M[0] * dir[0] + M[4] * dir[1] + M[8] * dir[2],
    M[1] * dir[0] + M[5] * dir[1] + M[9] * dir[2],
    M[2] * dir[0] + M[6] * dir[1] + M[10] * dir[2]], depthMm));
  return { ok: true, unitMm, M, L, R, loc, depthMm, PX: F.X, PY: F.Y, PZ: F.Z, solidId: s.expressID, posId: ref(s.Position) };
}

/** The beam's mesh as its axis (principal direction: a straight beam is all one way) and its vertices, in model mm. */
export function beamMesh(api, mid, id, unitMm) {
  // The mesh comes out in the model's *coordination* frame (the survey frame the viewer places the model by); the beam's
  // own placement (readBeam) is in the model's own frame. Undo the coordination matrix, or the mesh and the solid would be
  // metres apart while both look right: the plan would draw the beams somewhere else and the change would be measured
  // from the wrong place. Everything after this point is model millimetres, as readBeam is.
  let Ci = null;
  try { Ci = inv4(api.GetCoordinationMatrix(mid)); } catch (e) { Ci = null; }
  let tri;
  try { tri = productTriangles(api, mid, id, unitMm, Ci); } catch (e) { return null; }
  const raw = tri?.positions;
  if (!raw || raw.length < 9) return null;
  const p = new Float64Array(raw.length);   // file units → millimetres
  for (let i = 0; i < raw.length; i++) p[i] = raw[i] * unitMm;
  const n = p.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] - cx, y = p[i + 1] - cy, z = p[i + 2] - cz;
    s00 += x * x; s01 += x * y; s02 += x * z; s11 += y * y; s12 += y * z; s22 += z * z;
  }
  const C = [s00, s01, s02, s01, s11, s12, s02, s12, s22];
  let v = norm([C[0] + C[1], C[3] + C[4] + C[5], C[6] + C[8]]);   // the first row plus the diagonal: never zero for a beam
  if (!Number.isFinite(v[0]) || len3(v) < 1e-9) v = [1, 0, 0];
  for (let k = 0; k < 32; k++) {   // power iteration on the covariance: the longest direction (the beam's axis)
    const w = [C[0] * v[0] + C[1] * v[1] + C[2] * v[2], C[3] * v[0] + C[4] * v[1] + C[5] * v[2], C[6] * v[0] + C[7] * v[1] + C[8] * v[2]];
    const l = len3(w);
    if (l < 1e-12) break;
    v = mul(w, 1 / l);
  }
  let tmin = Infinity, tmax = -Infinity;
  const verts = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    verts.push([x, y, z]);
    const t = (x - cx) * v[0] + (y - cy) * v[1] + (z - cz) * v[2];
    if (t < tmin) tmin = t;
    if (t > tmax) tmax = t;
  }
  const a3 = [cx + v[0] * tmin, cy + v[1] * tmin, cz + v[2] * tmin];
  const b3 = [cx + v[0] * tmax, cy + v[1] * tmax, cz + v[2] * tmax];
  if (dist3(a3, b3) < 100) return null;   // a stub: nothing to extend
  return { a3, b3, verts };
}

/** Where line a→b comes closest to line c→d (3D); null when they are parallel. */
export function lineClosest(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c), w0 = sub(a, c);
  const den = len3(cross(r, s));
  if (den < 1e-4 * len3(r) * len3(s)) return null;   // within ~0.006°: parallel (beams drawn on a grid)
  const A = dot(r, r), B = dot(r, s), C = dot(s, s), D = dot(r, w0), E = dot(s, w0);
  const q = A * C - B * B;
  const t = (B * E - C * D) / q, u = (A * E - B * D) / q;
  const pA = add(a, mul(r, t)), pB = add(c, mul(s, u));
  return { t, u, pA, pB, dist: dist3(pA, pB) };
}

/**
 * Where the source beam has to end to meet the target, and which of its ends moves. The source stays on its own axis
 * (as a wall is trimmed on its centre line): the point is the source's axis meeting the plane of the target's face
 * toward it — so beams of the same level meet face to face, not centre to centre. The end nearer the target moves,
 * which trims a beam that already runs past it (as EXTEND does in a drawing). Two beams on one line (a beam carried on
 * from another) are parallel, and meet at the target's nearer end.
 */
export function extendPlan(src, tgt) {
  if (!src || !tgt || src === tgt || src.guid && src.guid === tgt.guid) return err('model.err.beam.same');
  if (!src.verts?.length || !tgt.verts?.length) return err('model.err.beam.kind');
  const m = lineClosest(src.a3, src.b3, tgt.a3, tgt.b3);
  let pB;
  if (m) {
    if (m.dist > SKEW_MAX) return err('model.err.beam.skew');
    if (m.u < -0.05 || m.u > 1.05) return err('model.err.beam.miss');
    pB = add(tgt.a3, mul(sub(tgt.b3, tgt.a3), Math.min(1, Math.max(0, m.u))));
  } else {
    // parallel: two beams on one line meet (a beam carried on from another); side by side or on another level, they
    // never do, and that is said as parallel rather than as a gap
    const v = norm(sub(src.b3, src.a3));
    const foot = add(src.a3, mul(v, dot(sub(tgt.a3, src.a3), v)));
    if (dist3(foot, tgt.a3) > SKEW_MAX) return err('model.err.beam.parallel');
    let best = null;   // the target end nearest one of the source's
    for (const se of [src.a3, src.b3]) for (const te of [tgt.a3, tgt.b3]) {
      const d = dist3(se, te);
      if (!best || d < best.d) best = { d, te };
    }
    pB = best.te;
  }
  // the end nearer the target moves; the other stays, and the beam still runs along its own line
  const dA = dist3(src.a3, pB), dB = dist3(src.b3, pB);
  const movingEnd = dA <= dB ? src.a3 : src.b3;
  const stay = movingEnd === src.a3 ? src.b3 : src.a3;
  const u = norm(sub(movingEnd, stay));
  // where the target's face toward the beam is, along the beam: its nearest point in the direction of the moving end.
  // Beams meet face to face (a wall's thickness matters as much); a beam carried on meets the other's end the same way.
  let sN = Infinity;
  for (const q of tgt.verts) sN = Math.min(sN, dot(sub(q, stay), u));
  const newLen = sN;
  if (!(newLen >= MIN)) return err('model.err.beam.short');   // the target is over this end, or all but: nothing to keep
  const target = add(stay, mul(u, newLen));
  return { target, movingEnd, newLen };
}

/**
 * The change: the end named by `movingEnd` (its model-mm point, from extendPlan) runs to `target` (model mm, on the beam's
 * axis). The profile and the placement are kept; the extrusion's direction and depth change, and the start end gets a new
 * Axis2Placement3D (the old one may be shared with another beam: nothing is changed in place that someone else uses).
 */
export function extendBeam({ guid, target, movingEnd }) {
  return op((w) => {
    const fail = (key) => Object.assign(new Error(key), { key });
    const id = w.byGuid(guid);
    if (!id) throw fail('model.err.beam.gone');
    const r = readBeam(w.api, w.mid, id);
    if (!r.ok) throw fail('model.err.beam.kind');
    const mesh = beamMesh(w.api, w.mid, id, r.unitMm);
    if (!mesh) throw fail('model.err.beam.kind');
    // the beam may have changed since the plan was made (a Level moved, an Undo): the end must still be where it was clicked
    const atStart = dist3(mesh.a3, movingEnd) <= dist3(mesh.b3, movingEnd);
    if (Math.min(dist3(mesh.a3, movingEnd), dist3(mesh.b3, movingEnd)) > 25) throw fail('model.err.beam.gone');
    const v = norm(sub(mesh.b3, mesh.a3));
    const foot = add(mesh.a3, mul(v, dot(sub(target, mesh.a3), v)));   // the target, on the beam's own line
    if (dist3(foot, target) > 25) throw fail('model.err.beam.gone');
    // the end moves along the solid's own sweep line: the profile's origin need not sit on the beam's centre line
    const dirM = norm(sub(r.R, r.L));
    const proj = dot(sub(target, r.L), dirM);   // how far along the sweep the new end plane is
    const depth = atStart ? r.depthMm - proj : proj;
    if (!(depth >= MIN)) throw fail('model.err.beam.short');
    const fu = (mm) => round(w.u(mm), 6), rd = (x) => round(x, 12);
    const rot = (q) => [r.M[0] * q[0] + r.M[4] * q[1] + r.M[8] * q[2], r.M[1] * q[0] + r.M[5] * q[1] + r.M[9] * q[2], r.M[2] * q[0] + r.M[6] * q[1] + r.M[10] * q[2]];
    const dirLocal = [dot(dirM, rot(r.PX)), dot(dirM, rot(r.PY)), dot(dirM, rot(r.PZ))];   // in the Position frame
    const solid = w.touch(r.solidId);
    solid.ExtrusionDirection = w.H(w.dir(rd(dirLocal[0]), rd(dirLocal[1]), rd(dirLocal[2])));
    solid.Depth = fu(depth);
    if (atStart) {
      const newL = add(r.L, mul(dirM, proj));
      const locM = apply4(inv4(r.M), newL[0], newL[1], newL[2]);   // the position point in the placement's own frame
      const pos = line(w.api, w.mid, r.posId);
      const ax = ref(pos?.Axis), rf = ref(pos?.RefDirection);   // the same directions, shared: they are not ours to change
      solid.Position = w.H(w.make('IFCAXIS2PLACEMENT3D',
        w.H(w.point3(fu(locM[0]), fu(locM[1]), fu(locM[2]))), ax ? w.H(ax) : null, rf ? w.H(rf) : null));
    }
    w.write(solid);
    // what the element itself says about its length follows, when it has such a value (never a new property set)
    for (const d of w.defs(id)) {
      const def = line(w.api, w.mid, d.def);
      if (!def) continue;
      const c = cls(def);
      if (c === 'IFCELEMENTQUANTITY') {
        for (const h of def.Quantities || []) {
          const q = line(w.api, w.mid, h.value);
          if (q && /^GROSSLENGTH$/i.test(String(val(q.Name) || ''))) {
            const qq = w.touch(h.value); qq.LengthValue = fu(depth); w.write(qq);
          }
        }
      } else if (c === 'IFCPROPERTYSET') {
        for (const h of def.HasProperties || []) {
          const p = line(w.api, w.mid, h.value);
          if (!p || !/^LENGTH$/i.test(String(val(p.Name) || ''))) continue;
          if (String(p.NominalValue?.name || '').toUpperCase() !== 'IFCPOSITIVELENGTHMEASURE') continue;
          const pp = w.touch(h.value); pp.NominalValue = w.T('IFCPOSITIVELENGTHMEASURE', fu(depth)); w.write(pp);
        }
      }
    }
    return { id, ids: [id] };
  });
}

/** The beams of a model, by id (both beam classes), for the UI's list and for tests. */
export function beamIds(api, mid) {
  return [...ids(api, mid, 'IFCBEAM'), ...ids(api, mid, 'IFCBEAMSTANDARDCASE')];
}
