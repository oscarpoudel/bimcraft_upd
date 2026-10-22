/* SPDX-License-Identifier: Apache-2.0 */
/** Translate frame products in a storey's XY plane without rewriting their solids. */
import { ModelWriter } from './model-write.js';
import { inv4, val } from './ifc-util.js';

export const isFrameClass = (name) => /^IFC(BEAM|COLUMN)(STANDARDCASE)?$/i.test(String(name || ''));
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Plan mm -> world vector -> parent-placement vector in native file units. */
export function frameMoveDelta(plan, parent, dx, dy, unitMm) {
  if (!Array.isArray(plan) || plan.length !== 16 || !plan.every(Number.isFinite) ||
      !Array.isArray(parent) || parent.length !== 16 || !parent.every(Number.isFinite) ||
      ![dx, dy, unitMm].every(Number.isFinite) || unitMm <= 0) throw new Error('Invalid frame move coordinates.');
  const world = [0, 1, 2].map((k) => (plan[k] * dx + plan[4 + k] * dy) / unitMm);
  const inverse = inv4(parent);
  if (!inverse) throw new Error('The member parent placement cannot be inverted.');
  return [0, 1, 2].map((k) => inverse[k] * world[0] + inverse[4 + k] * world[1] + inverse[8 + k] * world[2]);
}

/** GUIDs survive undo/redo; each moved product receives its own new placement. */
export function moveFrameMembers({ guids, plan, dx, dy }) {
  const members = [...new Set(guids)], frame = [...plan];
  return (ed) => new ModelWriter(ed.W, ed.api, ed.mid).run((w) => {
    const moved = [];
    for (const guid of members) {
      const id = w.byGuid(guid), line = id ? w.api.GetLine(w.mid, id, false) : null;
      if (!line || !isFrameClass(w.api.GetNameFromTypeCode(line.type))) throw new Error('Select beams or columns in the active model to move.');
      const placement = line.ObjectPlacement ? w.api.GetLine(w.mid, line.ObjectPlacement.value, false) : null;
      if (!placement || w.api.GetNameFromTypeCode(placement.type).toUpperCase() !== 'IFCLOCALPLACEMENT') throw new Error('This member needs a local placement to move.');
      const axis = w.api.GetLine(w.mid, placement.RelativePlacement.value, false);
      if (!axis || w.api.GetNameFromTypeCode(axis.type).toUpperCase() !== 'IFCAXIS2PLACEMENT3D') throw new Error('This member needs a 3D placement to move.');
      const point = w.api.GetLine(w.mid, axis.Location.value, false);
      const parent = placement.PlacementRelTo ? [...w.api.GetWorldTransformMatrix(w.mid, placement.PlacementRelTo.value)] : IDENTITY;
      const delta = frameMoveDelta(frame, parent, dx, dy, w.unitMm);
      const coordinates = point.Coordinates.map((v) => Number(val(v)));
      if (coordinates.length !== 3 || !coordinates.every(Number.isFinite)) throw new Error('Invalid member placement coordinates.');
      const location = w.point3(...coordinates.map((v, k) => v + delta[k]));
      const relative = w.make('IFCAXIS2PLACEMENT3D', w.H(location), axis.Axis || null, axis.RefDirection || null);
      const local = w.make('IFCLOCALPLACEMENT', placement.PlacementRelTo || null, w.H(relative));
      const changed = w.touch(id); changed.ObjectPlacement = w.H(local); w.write(changed);
      moved.push(id);
    }
    return { id: moved[0] ?? null, ids: moved };
  });
}
