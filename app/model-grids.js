/* SPDX-License-Identifier: Apache-2.0 */
/**
 * model-grids.js — grids (0.6 DF.16, session `bim-draw`): grid lines with bubbles and labels (1, 2, 3 / A, B, C), placed by
 * spacing or drawn one by one, written as IfcGrid with its axes. No DOM: bin/test-bimcraft.mjs --draw06 runs it in Node.
 * Plan millimetres; points given in a storey's own plan axes (the level the person draws on).
 *
 * One grid system per building: an IfcGrid contained in the IfcBuilding, placed at the building's placement, shown on every
 * level's plan. Its lines are IfcGridAxis (AxisTag = the label, AxisCurve = a 2D IfcPolyline in the grid's axes, SameSense
 * true) in two families: numbered lines (UAxes) and lettered lines (VAxes). IFC wants each list to hold one line or more and
 * every line in exactly one list (IfcGridAxis WR2), so a grid of one family only is written IRREGULAR with its last line in
 * the other list, and a single line gets an untagged twin (SameSense false) in the other list; `CadCraft_Grid` (Families
 * "tag=u|v;…", Bubbles, Twin) says how to read it back. A 'FootPrint' 'GeometricCurveSet' of the lines lets other programs
 * draw it. IfcGrid lines from other programs are read for display and snapping (2D polylines/indexed polylines), never changed.
 *
 *   nextTag(tag)               '1' → '2', '9' → '10', 'A' → 'B', 'H' → 'J' (I and O are skipped, as on drawings), 'Z' → 'AA',
 *                              'A.1' → 'A.2'
 *   tagFamily(tag)             'u' (ends in a number) | 'v'
 *   gridLayout({ origin, angle, u: { count, spacing, first }, v: { count, spacing, first }, extend }) → [{ tag, a, b, fam }]
 *                              numbered lines run along the layout's Y and are placed across X (spacing: one length or a
 *                              list); lettered lines run along X and are placed up Y; each line runs `extend` past the last
 *                              lines of the other family
 *   readGrids(w) → [{ id, guid, own, bubbles, axes: [{ tag, a, b (file mm, world), fam }] }]
 *   toPlan(w, storey, grids) → the same with a, b in that storey's plan
 *   gridSnap(axes) → { lines: [{ a, b }], points: [[x, y]] }   the lines and where they cross (plan mm)
 *   gridSnapPoint(p, axes, tol) → { p, kind: 'cross' | 'line', tags } | null   the anchor (a crossing first, then a
 *                              line) nearest plan point p within tol mm, with the labels it snaps to (placing in 3D)
 *   suggestGridAxes(points, { tol, extend }) → [{ tag, a, b, fam }]   a grid through the distinct x's and y's of the
 *                              points (column centres, beam/wall ends): numbered lines across, lettered lines up
 *   structurePoints(w, storey) → [[x, y]…]   imported/authored columns' centres, else beam ends, else authored wall ends
 *   autoGridFor(w, storey) → [{ tag, a, b, fam }]   the lines Auto grid writes for that level, in its plan mm
 *   suggestGrid(w, { tol, extend }) → { own: false, auto: true, bubbles, axes } | null   the grid to draw for a model
 *                              that has no IfcGrid: through imported/authored columns, else beams or walls, in world mm
 *   gridsInView(axes, dir) → [{ tag, x }]   the lines an elevation or section looking along `dir` sees end on (within 30° of
 *                              it), at x = along the view's right ([dir.y, −dir.x], res-views.js), for the sheets
 *   ops (IfcEditor.modelChange, one undo step each): placeGrid({ storey, axes: [{ tag?, a, b, fam? }] }) (added to the
 *   building's grid, made when it has none; a tag that is taken or missing gets the next free one of its family),
 *   changeGridAxis(tag, { tag, a, b, storey }), removeGridAxes(tags), changeGrid({ bubbles })
 *   Errors: model.err.grid.tag (a label already used), model.err.grid.short (a line under 100 mm), model.err.grid.none.
 */
import { op } from './model-ops.js';
import { scaleT } from './model-write.js';
import { ids, val, inv4, mul4, apply4 } from './ifc-util.js';
import { readWalls } from './model-walls.js';
import { beamMesh } from './model-beam-extend.js';
import { beamStackAxis } from './model-frame-stack.js';
import { labelParts } from './model-part.js';

export const GRID_PSET = 'CadCraft_Grid';
export const BUBBLES = ['both', 'start', 'end', 'none'];
const SKIP = new Set(['I', 'O']);

export function nextTag(tag) {
  const s = String(tag || '');
  const n = /^(.*?)(\d+)$/.exec(s);
  if (n) return n[1] + (Number(n[2]) + 1);
  const l = /^(.*?)([A-Z]+)$/.exec(s);
  if (l) {
    const chars = l[2].split('');
    let i = chars.length - 1;
    for (;;) {
      if (i < 0) { chars.unshift('A'); break; }
      let c = chars[i].charCodeAt(0) + 1;
      while (SKIP.has(String.fromCharCode(c))) c++;
      if (c <= 90) { chars[i] = String.fromCharCode(c); break; }
      chars[i] = 'A'; i--;
    }
    return l[1] + chars.join('');
  }
  return s ? s + '1' : '1';
}
export const tagFamily = (tag) => (/\d$/.test(String(tag || '')) ? 'u' : 'v');

export function gridLayout({ origin = [0, 0], angle = 0, u = {}, v = {}, extend = 1500 } = {}) {
  const at = (sp, n) => { const out = [0]; for (let i = 1; i < n; i++) out.push(out[i - 1] + (Array.isArray(sp) ? Number(sp[i - 1] ?? sp[sp.length - 1]) : Number(sp))); return out; };
  const nu = Math.max(0, Math.floor(u.count || 0)), nv = Math.max(0, Math.floor(v.count || 0));
  const xs = at(u.spacing ?? 6000, nu), ys = at(v.spacing ?? 6000, nv);
  const xMax = xs.length ? xs[xs.length - 1] : 0, yMax = ys.length ? ys[ys.length - 1] : 0;
  const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
  const P = (x, y) => [origin[0] + x * c - y * s, origin[1] + x * s + y * c];
  const out = [];
  let tg = u.first || '1';
  for (const x of xs) { out.push({ tag: tg, a: P(x, -extend), b: P(x, yMax + extend), fam: 'u' }); tg = nextTag(tg); }
  tg = v.first || 'A';
  for (const y of ys) { out.push({ tag: tg, a: P(-extend, y), b: P(xMax + extend, y), fam: 'v' }); tg = nextTag(tg); }
  return out;
}

// ------------------------------------------------------------------------------------------------------------- reading
const worldMm = (w, lp) => scaleT(lp ? w.api.GetWorldTransformMatrix(w.mid, lp) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], w.unitMm);
function curvePoints(w, cid) {
  const c = cid ? w.api.GetLine(w.mid, cid, false) : null;
  if (!c) return null;
  const cls = c.constructor?.name || '';
  if (/IfcPolyline$/i.test(cls)) return (c.Points || []).map((h) => {
    const p = w.api.GetLine(w.mid, h.value, false);
    return (p.Coordinates || []).map((x) => Number(val(x)) * w.unitMm);
  });
  if (!/IfcIndexedPolyCurve$/i.test(cls)) return null;
  const list = c.Points ? w.api.GetLine(w.mid, c.Points.value, false) : null;
  const points = (list?.CoordList || []).map((row) => row.map((x) => Number(val(x)) * w.unitMm));
  if (!c.Segments?.length) return points;
  const ordered = [];
  for (const segment of c.Segments) {
    // An arc cannot be displayed/snapped as the chord between its endpoints.
    const name = segment.name || segment.constructor?.name || '';
    if (/ArcIndex/i.test(name)) return null;
    const indices = segment.value ?? segment;
    if (!Array.isArray(indices)) return null;
    for (const index of indices) {
      const point = points[Number(val(index)) - 1];
      if (!point) return null;
      if (ordered.at(-1) !== point) ordered.push(point);
    }
  }
  return ordered;
}

function parseFamilies(text) {
  const m = new Map();
  for (const part of String(text || '').split(';')) { const i = part.lastIndexOf('='); if (i > 0) m.set(part.slice(0, i), part.slice(i + 1)); }
  return m;
}
export function readGrids(w) {
  const out = [];
  let list = [];
  try { list = ids(w.api, w.mid, 'IFCGRID'); } catch (e) { return out; }
  for (const id of list) {
    const g = w.api.GetLine(w.mid, id, false);
    if (!g) continue;
    const ps = w.readPset(id, GRID_PSET);
    const fams = parseFamilies(ps?.Families), twin = !!ps && String(ps.Twin) === 'true';
    const M = worldMm(w, g.ObjectPlacement?.value);
    const axes = [];
    const take = (list2, fam) => {
      for (const h of list2 || []) {
        const ax = w.api.GetLine(w.mid, h.value, false);
        if (!ax) continue;
        const tag = val(ax.AxisTag);
        if (twin && (tag === null || tag === undefined || tag === '')) continue;   // our single line's twin
        const pts = curvePoints(w, ax.AxisCurve?.value);
        if (!pts || pts.length < 2) continue;
        const ends = val(ax.SameSense) === false ? [pts[pts.length - 1], pts[0]] : [pts[0], pts[pts.length - 1]];
        const [a, b] = ends.map((q) => { const r = apply4(M, q[0], q[1], 0); return [r[0], r[1]]; });
        axes.push({ tag: tag === null || tag === undefined ? '' : String(tag), a, b, fam: fams.get(String(tag)) || fam, axisId: h.value });
      }
    };
    take(g.UAxes, 'u'); take(g.VAxes, 'v'); take(g.WAxes, 'w');
    out.push({ id, guid: val(g.GlobalId), own: !!ps, bubbles: BUBBLES.includes(ps?.Bubbles) ? ps.Bubbles : 'both', axes });
  }
  return out;
}

/** Repeated IFC grids on different storeys share plan lines. Draw/snap each
 * labelled line once, while preserving every original IfcGrid in the file. */
export function distinctGridAxes(grids) {
  const unique = new Map();
  for (const grid of grids) for (const axis of grid.axes) {
    const ends = [axis.a, axis.b].map((p) => p.map((v) => Math.round(v)).join(',')).sort();
    const key = JSON.stringify([axis.tag, axis.fam, ...ends]);
    const value = { ...axis, own: grid.own, auto: !!grid.auto, bubbles: grid.bubbles };
    const previous = unique.get(key);
    if (!previous || (value.own && !previous.own) || (!value.auto && previous.auto)) unique.set(key, value);
  }
  return [...unique.values()];
}

/**
 * A grid drawn from the structural points of a model that has none (0.6 DF.16 (b)): each distinct x is a numbered line,
 * each distinct y a lettered one, extended `extend` past the outermost. Points within `tol` of an earlier one join it,
 * so columns in a row make one line. Input/output use the same millimetre frame;
 * optional angle is its grid direction in radians.
 */
export function suggestGridAxes(points, { tol = 300, extend = 1500, maxLines = 40, angle = 0 } = {}) {
  // Rotate around a nearby origin to cluster the building grid, rather than
  // the file/survey axes. Rotate the finished lines back into the input frame.
  if (angle && Number.isFinite(angle)) {
    const origin = (points || []).find((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!origin) return [];
    const c = Math.cos(angle), s = Math.sin(angle);
    const local = points.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => { const x = p[0] - origin[0], y = p[1] - origin[1]; return [c * x + s * y, -s * x + c * y]; });
    const world = (p) => [origin[0] + c * p[0] - s * p[1], origin[1] + s * p[0] + c * p[1]];
    return suggestGridAxes(local, { tol, extend, maxLines }).map((axis) => ({ ...axis, a: world(axis.a), b: world(axis.b) }));
  }
  const pts = (points || []).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return [];
  const cluster = (vals) => {
    const s = [...vals].sort((a, b) => a - b), out = [];
    for (const v of s) if (!out.length || Math.abs(v - out[out.length - 1]) > tol) out.push(v);
    return out;
  };
  const xs = cluster(pts.map((p) => p[0])), ys = cluster(pts.map((p) => p[1]));
  if (!xs.length || !ys.length || xs.length + ys.length > maxLines) return [];
  const x0 = xs[0] - extend, x1 = xs[xs.length - 1] + extend, y0 = ys[0] - extend, y1 = ys[ys.length - 1] + extend;
  const out = [];
  let tg = '1';
  for (const x of xs) { out.push({ tag: tg, a: [x, y0], b: [x, y1], fam: 'u' }); tg = nextTag(tg); }
  tg = 'A';
  for (const y of ys) { out.push({ tag: tg, a: [x0, y], b: [x1, y], fam: 'v' }); tg = nextTag(tg); }
  return out;
}

/** Grid geometry is read from all IFC frame members, not just CadCraft-authored
 * property sets. Keep this separate from the editing readers, which must only
 * offer their own parametrically editable products to the authoring tools. */
function gridStructure(w) {
  if (w._gridStructure) return w._gridStructure;
  const classes = ['IFCBEAM', 'IFCBEAMSTANDARDCASE', 'IFCCOLUMN', 'IFCCOLUMNSTANDARDCASE'];
  const classOf = new Map();
  for (const cls of classes) { try { for (const id of ids(w.api, w.mid, cls)) classOf.set(id, cls); } catch { /* schema may omit a standard-case class */ } }
  const parts = labelParts(w.api, w.mid, { keyBase: 0, classOf }, w.W), storeys = w.storeyOf();
  const levels = new Set(w.info().storeys.map((s) => s.id));
  const parents = new Map();
  for (const rid of ids(w.api, w.mid, 'IFCRELAGGREGATES')) {
    const rel = w.api.GetLine(w.mid, rid, false);
    for (const h of rel.RelatedObjects || []) parents.set(h.value, rel.RelatingObject?.value);
  }
  const by = new Map(), matrices = new Map();
  for (const [id, cls] of classOf) {
    if (parts.get(id) === 'architecture') continue;
    let storey = storeys.get(id), guard = 0;
    while (storey && !levels.has(storey) && guard++ < 20) storey = parents.get(storey);
    if (!levels.has(storey)) continue;
    try {
      const mesh = beamMesh(w.api, w.mid, id, w.unitMm);
      if (!mesh) continue;
      if (!matrices.has(storey)) matrices.set(storey, inv4(w.storeyWorld(storey)));
      const Mi = matrices.get(storey), plan = (p) => { const q = apply4(Mi, ...p); return [q[0], q[1]]; };
      const row = by.get(storey) || { columns: [], beams: [] };
      if (/COLUMN/.test(cls)) {
        // Mesh bounds include section/profile offsets absent from ObjectPlacement.
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const p of mesh.verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
        row.columns.push(plan(lo.map((v, k) => (v + hi[k]) / 2)));
      } else {
        const axis = beamStackAxis(mesh);
        if (axis) row.beams.push({ a: plan(axis.a), b: plan(axis.b) });
      }
      by.set(storey, row);
    } catch { /* an unreadable product must not discard all other structure */ }
  }
  w._gridStructure = by;
  return by;
}
function gridSource(w, storey) {
  const row = gridStructure(w).get(storey);
  const points = row?.columns.length ? row.columns : (row?.beams || []).flatMap((b) => [b.a, b.b]);
  let x = 0, y = 0, weight = 0;
  for (const b of row?.beams || []) {
    const dx = b.b[0] - b.a[0], dy = b.b[1] - b.a[1], length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
    x += length * Math.cos(4 * angle); y += length * Math.sin(4 * angle); weight += length;
  }
  const angle = weight && Math.hypot(x, y) > .25 * weight ? Math.atan2(y, x) / 4 : 0;
  if (points.length) return { points, angle };
  // Preserve the wall-only authoring workflow for models without frame members.
  const walls = readWalls(w, storey);
  return { points: walls.flatMap((wall) => [wall.a, wall.b]), angle: 0 };
}

/** Column centres first; beam plan endpoints, then authored walls, as fallback. */
export function structurePoints(w, storey) { return gridSource(w, storey).points; }

export function autoGridFor(w, storey) {
  const source = gridSource(w, storey);
  return suggestGridAxes(source.points, { angle: source.angle });
}

/** Unsaved reference grid for a model without IfcGrid. Choose the richest usable
 * level, skipping levels whose irregular coordinates exceed the line limit. */
export function suggestGrid(w, opts = {}) {
  let best = null;
  for (const level of w.info().storeys) {
    const source = gridSource(w, level.id);
    const axes = suggestGridAxes(source.points, { angle: source.angle, ...opts });
    if (axes.length && (!best || source.points.length > best.points)) best = { storey: level.id, points: source.points.length, axes };
  }
  if (!best) return null;
  return { id: null, guid: null, own: false, auto: true, bubbles: 'both',
    axes: best.axes.map((axis) => ({ ...axis, a: planToWorld(w, best.storey, axis.a), b: planToWorld(w, best.storey, axis.b) })) };
}

export function toPlan(w, storey, grids) {
  const Mi = inv4(w.storeyWorld(storey));
  const P = (q) => { const r = apply4(Mi, q[0], q[1], 0); return [r[0], r[1]]; };
  return grids.map((g) => ({ ...g, axes: g.axes.map((x) => ({ ...x, a: P(x.a), b: P(x.b) })) }));
}

export function gridSnap(axes) {
  const lines = axes.map((x) => ({ a: x.a, b: x.b })), points = [];
  for (let i = 0; i < axes.length; i++) for (let j = i + 1; j < axes.length; j++) {
    const p = axes[i].a, r = [axes[i].b[0] - p[0], axes[i].b[1] - p[1]], q = axes[j].a, s = [axes[j].b[0] - q[0], axes[j].b[1] - q[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-6 * Math.hypot(...r) * Math.hypot(...s)) continue;
    const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den, u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
    if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) continue;
    points.push([p[0] + r[0] * t, p[1] + r[1] * t]);
  }
  return { lines, points };
}

/**
 * The grid anchor nearest plan point p within `tol` mm: a crossing of two lines first (kind 'cross', both labels),
 * then a line (kind 'line', its label), else null. `axes` = readGrids' axes in any consistent space. Where an item
 * placed in the 3D view snaps to (bimcraft.js); the plan's snapping (snapPoint, model-tools.js) already uses the
 * same lines and crossings through gridSnap.
 */
export function gridSnapPoint(p, axes, tol = 1000) {
  let cross = null;
  for (let i = 0; i < axes.length; i++) for (let j = i + 1; j < axes.length; j++) {
    const a = axes[i], b = axes[j];
    const r = [a.b[0] - a.a[0], a.b[1] - a.a[1]], s = [b.b[0] - b.a[0], b.b[1] - b.a[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-6 * Math.hypot(...r) * Math.hypot(...s)) continue;
    const t = ((b.a[0] - a.a[0]) * s[1] - (b.a[1] - a.a[1]) * s[0]) / den, u = ((b.a[0] - a.a[0]) * r[1] - (b.a[1] - a.a[1]) * r[0]) / den;
    if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) continue;
    const q = [a.a[0] + r[0] * t, a.a[1] + r[1] * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d <= tol && (!cross || d < cross.d)) cross = { p: q, d, tags: [a.tag, b.tag].filter(Boolean) };
  }
  if (cross) return { p: cross.p, kind: 'cross', tags: cross.tags };
  let line = null;
  for (const x of axes) {
    const d = [x.b[0] - x.a[0], x.b[1] - x.a[1]], l2 = d[0] * d[0] + d[1] * d[1];
    if (!l2) continue;
    const s = Math.max(0, Math.min(1, ((p[0] - x.a[0]) * d[0] + (p[1] - x.a[1]) * d[1]) / l2));
    const q = [x.a[0] + d[0] * s, x.a[1] + d[1] * s], dd = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (dd <= tol && (!line || dd < line.d)) line = { p: q, d: dd, tags: [x.tag].filter(Boolean) };
  }
  return line ? { p: line.p, kind: 'line', tags: line.tags } : null;
}

export function gridsInView(axes, dir) {
  const l = Math.hypot(dir[0], dir[1]), d = [dir[0] / l, dir[1] / l], right = [d[1], -d[0]], out = [];
  for (const x of axes) {
    const e = [x.b[0] - x.a[0], x.b[1] - x.a[1]], m = Math.hypot(...e);
    if (!m || Math.abs(e[0] * d[0] + e[1] * d[1]) / m < 0.866) continue;
    out.push({ tag: x.tag, x: x.a[0] * right[0] + x.a[1] * right[1] });
  }
  return out.sort((p, q) => p.x - q.x);
}

// ------------------------------------------------------------------------------------------------------------- writing
function building(w) {
  const b = ids(w.api, w.mid, 'IFCBUILDING')[0];
  if (b === undefined) throw Object.assign(new Error('model.err.grid.none'), { key: 'model.err.grid.none' });
  return b;
}
const ownGrid = (w) => readGrids(w).find((g) => g.own) || null;
/** The building grid's axes in world mm (file axes), and its frame. */
function gridFrame(w, g) {
  const line = g ? w.api.GetLine(w.mid, g.id, false) : null;
  const lp = line?.ObjectPlacement?.value ?? w.api.GetLine(w.mid, building(w), false).ObjectPlacement?.value;
  return worldMm(w, lp);
}
/** Write (or rewrite) the building's grid with these axes (world mm): its lines, lists, footprint and set. */
function writeGrid(w, g, axes, bubbles) {
  const bid = building(w);
  let id = g?.id, line;
  if (!id) {
    const bl = w.api.GetLine(w.mid, bid, false);
    const lp = w.placeAt(bl.ObjectPlacement?.value ?? null, 0, 0, 0, 0);
    const args = [w.guid(), w.ownerHistory(), w.L('Grid'), null, null, w.H(lp), null, [], [], null];   // i18n-ignore: IFC Name
    if (w.v4) args.push('NOTDEFINED');
    id = w.make('IFCGRID', ...args);
    w.contain(id, bid);
    line = w.touch(id);
  } else {
    line = w.touch(id);
    for (const h of [...(line.UAxes || []), ...(line.VAxes || []), ...(line.WAxes || [])]) w.dropTree(h.value);
  }
  const Gi = inv4(gridFrame(w, { id }));
  const local = (q) => { const r = apply4(Gi, q[0], q[1], 0); return [r[0], r[1]]; };
  const axis = (x, sense = true) => w.make('IFCGRIDAXIS', w.L(x.tag), w.H(w.polyline2(sense ? [local(x.a), local(x.b)] : [local(x.b), local(x.a)])), w.T('IFCBOOLEAN', sense));
  let U = axes.filter((x) => x.fam !== 'v'), V = axes.filter((x) => x.fam === 'v');
  let twin = false, irregular = false;
  if (axes.length === 1) twin = true;
  else if (!U.length || !V.length) { irregular = true; if (!V.length) { V = [U[U.length - 1]]; U = U.slice(0, -1); } else { U = [V[V.length - 1]]; V = V.slice(0, -1); } }
  line.UAxes = U.map((x) => w.H(axis(x)));
  line.VAxes = twin ? [w.H(w.make('IFCGRIDAXIS', null, w.H(w.polyline2([local(axes[0].b), local(axes[0].a)])), w.T('IFCBOOLEAN', false)))] : V.map((x) => w.H(axis(x)));
  line.WAxes = null;
  if (w.v4) line.PredefinedType = irregular || twin || !isRectangular(axes) ? 'IRREGULAR' : 'RECTANGULAR';
  w.write(line);
  // the footprint other programs draw
  const curves = axes.map((x) => w.H(w.polyline2([local(x.a), local(x.b)])));
  w.setShape(id, [w.rep('foot', 'FootPrint', 'GeometricCurveSet', [w.make('IFCGEOMETRICCURVESET', curves)])]);
  w.upsertPset(id, GRID_PSET, [
    ['Families', 'IFCTEXT', axes.map((x) => x.tag + '=' + (x.fam === 'v' ? 'v' : 'u')).join(';')],
    ['Bubbles', 'IFCLABEL', bubbles || 'both'],
    ['Twin', 'IFCBOOLEAN', twin],
  ]);
  return id;
}
function isRectangular(axes) {
  const dir = (x) => { const d = [x.b[0] - x.a[0], x.b[1] - x.a[1]], l = Math.hypot(...d); return [d[0] / l, d[1] / l]; };
  const U = axes.filter((x) => x.fam !== 'v').map(dir), V = axes.filter((x) => x.fam === 'v').map(dir);
  if (!U.length || !V.length) return false;
  const par = (p, q) => Math.abs(p[0] * q[1] - p[1] * q[0]) < 1e-6;
  return U.every((d) => par(d, U[0])) && V.every((d) => par(d, V[0])) && Math.abs(U[0][0] * V[0][0] + U[0][1] * V[0][1]) < 1e-6;
}
const short = (x) => Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) < 100;
const refuse = (key) => { throw Object.assign(new Error(key), { key }); };

/** Storey plan points → world mm. */
function planToWorld(w, storey, p) { const r = apply4(w.storeyWorld(storey), p[0], p[1], 0); return [r[0], r[1]]; }
/** The next free label of a family after what the grid has. */
function freeTag(axes, fam) {
  const used = new Set(axes.map((x) => x.tag));
  const mine = axes.filter((x) => x.fam === fam).map((x) => x.tag);
  let tg = mine.length ? nextTag(mine[mine.length - 1]) : fam === 'v' ? 'A' : '1';
  while (used.has(tg)) tg = nextTag(tg);
  return tg;
}
/** Which family a new line joins: the family of the existing line it runs most nearly along, else by its direction
 *  (more up than across = numbered). */
function familyFor(axes, a, b) {
  const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d);
  let best = null;
  for (const x of axes) {
    const e = [x.b[0] - x.a[0], x.b[1] - x.a[1]], m = Math.hypot(...e);
    const c = Math.abs(d[0] * e[0] + d[1] * e[1]) / (l * m);
    if (c > 0.866 && (!best || c > best.c)) best = { c, fam: x.fam };
  }
  return best ? best.fam : Math.abs(d[1]) >= Math.abs(d[0]) ? 'u' : 'v';
}

export function placeGrid({ storey, axes: add }) {
  const list = add.map((x) => ({ ...x, a: [...x.a], b: [...x.b] }));
  return op((w) => {
    const g = ownGrid(w), axes = g ? g.axes.map((x) => ({ tag: x.tag, a: x.a, b: x.b, fam: x.fam })) : [];
    const st = storey ? w.byGuid(storey) : null;
    for (const x of list) {
      const a = st ? planToWorld(w, st, x.a) : x.a, b = st ? planToWorld(w, st, x.b) : x.b;
      const fam = x.fam === 'u' || x.fam === 'v' ? x.fam : familyFor(axes, a, b);
      if (short({ a, b })) refuse('model.err.grid.short');
      let tag = String(x.tag || '').trim();
      if (!tag || axes.some((y) => y.tag === tag)) tag = freeTag(axes, fam);
      axes.push({ tag, a, b, fam });
    }
    const id = writeGrid(w, g, axes, g?.bubbles || 'both');
    return { id, ids: [id] };
  });
}

export function changeGridAxis(tag, ch) {
  const c = { ...ch };
  return op((w) => {
    const g = ownGrid(w);
    const ax = g?.axes.find((x) => x.tag === tag);
    if (!ax) refuse('model.err.grid.none');
    const axes = g.axes.map((x) => ({ tag: x.tag, a: x.a, b: x.b, fam: x.fam }));
    const me = axes.find((x) => x.tag === tag);
    if (c.tag !== undefined) {
      const nt = String(c.tag).trim();
      if (!nt || (nt !== tag && axes.some((x) => x.tag === nt))) refuse('model.err.grid.tag');
      me.tag = nt;
    }
    const st = c.storey ? w.byGuid(c.storey) : null;
    if (c.a) me.a = st ? planToWorld(w, st, c.a) : c.a;
    if (c.b) me.b = st ? planToWorld(w, st, c.b) : c.b;
    if (short(me)) refuse('model.err.grid.short');
    const id = writeGrid(w, g, axes, g.bubbles);
    return { id, ids: [id] };
  });
}

export function removeGridAxes(tags) {
  const gone = new Set(tags);
  return op((w) => {
    const g = ownGrid(w);
    if (!g) refuse('model.err.grid.none');
    const axes = g.axes.filter((x) => !gone.has(x.tag)).map((x) => ({ tag: x.tag, a: x.a, b: x.b, fam: x.fam }));
    if (!axes.length) {   // the last line: the grid goes, its axes first (they hang off the grid, not a relationship)
      const line = w.api.GetLine(w.mid, g.id, false);
      for (const h of [...(line.UAxes || []), ...(line.VAxes || []), ...(line.WAxes || [])]) w.dropTree(h.value);
      w.dropProduct([g.id]);
      return { id: null, ids: [] };
    }
    const id = writeGrid(w, g, axes, g.bubbles);
    return { id, ids: [id] };
  });
}

export function changeGrid({ bubbles }) {
  return op((w) => {
    const g = ownGrid(w);
    if (!g) refuse('model.err.grid.none');
    const id = writeGrid(w, g, g.axes.map((x) => ({ tag: x.tag, a: x.a, b: x.b, fam: x.fam })), BUBBLES.includes(bubbles) ? bubbles : g.bubbles);
    return { id, ids: [id] };
  });
}
