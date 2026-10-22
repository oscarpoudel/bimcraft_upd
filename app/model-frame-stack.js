/* SPDX-License-Identifier: Apache-2.0 */
/** Same projected frame span across floors, never just a shared midpoint. */
import { beamMesh } from './model-beam-extend.js';
import { isFrameClass } from './model-frame-move.js';
import { labelParts } from './model-part.js';

export const STACK_TOLERANCE_MM = 10;
export const BEAM_END_TOLERANCE_MM = 150;
const kindOf = (name) => /^IFCBEAM/i.test(name) ? 'beam' : /^IFCCOLUMN/i.test(name) ? 'column' : null;
const xyDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const finiteAxis = (m) => [m.a, m.b].every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite));

/** Stable plan axis: a deep, short beam's vertical section must not become its span.
 * Minimum-area rectangle of the XY hull is independent of triangle duplication,
 * section depth, and mesh tessellation. Coordinates are already model mm.
 */
export function beamStackAxis(mesh) {
  const points = (mesh?.verts || []).filter((p) => p.length === 3 && p.every(Number.isFinite))
    .map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (unique.length < 2) return null;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list) => {
    const hull = [];
    for (const p of list) { while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), p) <= 0) hull.pop(); hull.push(p); }
    return hull;
  };
  const lower = half(unique), upper = half([...unique].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const origin = hull[i], next = hull[(i + 1) % hull.length];
    const length = xyDistance(origin, next); if (length < 1e-6) continue;
    const u = [(next[0] - origin[0]) / length, (next[1] - origin[1]) / length], v = [-u[1], u[0]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of hull) {
      const dx = p[0] - origin[0], dy = p[1] - origin[1], x = dx * u[0] + dy * u[1], y = dx * v[0] + dy * v[1];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const area = (x1 - x0) * (y1 - y0);
    if (best && area >= best.area) continue;
    const z = (mesh.a3[2] + mesh.b3[2]) / 2;
    const point = (x, y) => [origin[0] + u[0] * x + v[0] * y, origin[1] + u[1] * x + v[1] * y, z];
    const wide = x1 - x0 >= y1 - y0;
    best = { area, a: wide ? point(x0, (y0 + y1) / 2) : point((x0 + x1) / 2, y0),
      b: wide ? point(x1, (y0 + y1) / 2) : point((x0 + x1) / 2, y1) };
  }
  return best && xyDistance(best.a, best.b) >= 100 ? { a: best.a, b: best.b } : null;
}

function alignedBeamSpan(seed, member, tolerance) {
  const vector = (a, b) => [b[0] - a[0], b[1] - a[1]];
  const s = vector(seed.a, seed.b), m = vector(member.a, member.b), sl = Math.hypot(...s), ml = Math.hypot(...m);
  if (sl < 100 || ml < 100) return false;
  const offLine = (p, a, d, length) => Math.abs(d[0] * (p[1] - a[1]) - d[1] * (p[0] - a[0])) / length;
  if (Math.max(offLine(member.a, seed.a, s, sl), offLine(member.b, seed.a, s, sl),
    offLine(seed.a, member.a, m, ml), offLine(seed.b, member.a, m, ml)) > tolerance) return false;
  const forward = s[0] * m[0] + s[1] * m[1] >= 0;
  const a = forward ? member.a : member.b, b = forward ? member.b : member.a;
  // End trims vary with supporting column sizes. Never extend this to adjacent
  // bays: cap each end at 150 mm and 10% of the shorter member's plan span.
  const endTolerance = Math.max(tolerance, Math.min(BEAM_END_TOLERANCE_MM, .1 * Math.min(sl, ml)));
  const along = (p, q) => Math.abs((p[0] - q[0]) * s[0] + (p[1] - q[1]) * s[1]) / sl;
  return along(seed.a, a) <= endTolerance && along(seed.b, b) <= endTolerance;
}

export function matchingFrameStack(seed, members, tolerance = STACK_TOLERANCE_MM) {
  if (!Number.isFinite(tolerance) || tolerance < 0 || !finiteAxis(seed)) throw new Error('Invalid stack matching coordinates.');
  return members.filter((m) => m.kind === seed.kind && m.part === seed.part && finiteAxis(m) &&
    (((xyDistance(seed.a, m.a) <= tolerance && xyDistance(seed.b, m.b) <= tolerance) ||
      (xyDistance(seed.a, m.b) <= tolerance && xyDistance(seed.b, m.a) <= tolerance)) ||
      (seed.kind === 'beam' && alignedBeamSpan(seed, m, tolerance))));
}

/** Every frame member with a readable plan axis, and the ones without — what stack matching runs on.
 *  Read once, so several seeds match without re-reading every member's mesh. */
function readFrameMembers(ed, model) {
  const base = model.keyBase || 0, unitMm = ed.placer().unitMm;
  const labels = labelParts(ed.api, ed.mid, model, ed.W);
  const members = []; const failed = [];
  for (const [id, cls] of model.classOf) {
    if (!isFrameClass(cls)) continue;
    const kind = kindOf(cls), key = base + id, part = labels.get(key) || 'structure';
    let mesh;
    try { mesh = beamMesh(ed.api, ed.mid, id, unitMm); } catch { mesh = null; }
    const axis = mesh ? (kind === 'beam' ? beamStackAxis(mesh) : { a: mesh.a3, b: mesh.b3 }) : null;
    if (!axis) { failed.push({ key, kind, part }); continue; }
    const line = ed.api.GetLine(ed.mid, id, false);
    members.push({ key, guid: line.GlobalId.value, kind, part, ...axis });
  }
  return { members, failed };
}

/** The vertical stacks of the selected members at once: each seed matches the members of its own kind at its own
 *  projected position (columns at the same plan position, beams on the same line), and the result is their union —
 *  two beams at different places bring back both of their stacks, and a beam and a column each bring their own.
 *  seedKeys = the selected keys, one or more. */
export function readVerticalStacks(ed, model, seedKeys) {
  const base = model.keyBase || 0;
  const seeds = [...new Set(seedKeys)];
  if (!seeds.length) throw new Error('Select at least one beam or column in the active model.');
  for (const key of seeds) if (!isFrameClass(model.classOf.get(key - base)))
    throw new Error(seeds.length === 1 ? 'Select one beam or column in the active model.' : 'Select beams or columns in the active model.');
  const { members, failed } = readFrameMembers(ed, model);
  const byKey = new Map(members.map((m) => [m.key, m]));
  const order = new Map(members.map((m, i) => [m.key, i]));
  const matched = new Set();
  const perSeed = [];
  const scope = new Set();
  for (const key of seeds) {
    const seed = byKey.get(key);
    if (!seed) throw new Error(seeds.length === 1 ? 'This member has no readable frame axis for stack matching.'
      : 'One of the selected members has no readable frame axis for stack matching.');
    scope.add(seed.kind + '|' + seed.part);
    const hits = matchingFrameStack(seed, members).map((m) => m.key);
    perSeed.push(hits);
    for (const k of hits) matched.add(k);
  }
  // Two seeds are one stack when their matches meet: members at the same position match each other's seed.
  const stacks = [];
  for (const hits of perSeed) {
    const merged = stacks.find((s) => hits.some((k) => s.has(k)));
    if (merged) for (const k of hits) merged.add(k);
    else stacks.push(new Set(hits));
  }
  const keys = [...matched].sort((a, b) => order.get(a) - order.get(b));
  return { keys, members: keys.map((k) => byKey.get(k)), stacks: stacks.length,
    skipped: failed.filter((m) => scope.has(m.kind + '|' + m.part)).length, toleranceMm: STACK_TOLERANCE_MM };
}

/** The vertical stack of one selected member (its matches plus itself), with the members it matched. */
export function readVerticalStack(ed, model, seedKey) {
  const base = model.keyBase || 0;
  if (!isFrameClass(model.classOf.get(seedKey - base))) throw new Error('Select one beam or column in the active model.');
  return readVerticalStacks(ed, model, [seedKey]);
}
