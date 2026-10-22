/* SPDX-License-Identifier: Apache-2.0 */
/** Floor copies use world XY and preserve each member's offset from its storey. */
import { beamMesh } from './model-beam-extend.js';
import { isFrameClass } from './model-frame-move.js';
import { labelParts } from './model-part.js';
import { ModelWriter } from './model-write.js';
import { markStructural } from './model-part-write.js';
import { undoJournal } from './ifc-place.js';
import { ids, retypeLine } from './ifc-util.js';

export function sameFrameAxis(a, b, tolerance = 10) {
  const close = (p, q) => Math.hypot(...p.map((v, i) => v - q[i])) <= tolerance;
  return a.kind === b.kind && a.part === b.part &&
    ((close(a.a, b.a) && close(a.b, b.b)) || (close(a.a, b.b) && close(a.b, b.a)));
}
const kind = (cls) => /^IFCBEAM/i.test(cls) ? 'beam' : 'column';
function readMember(ed, model, labels, id) {
  const mesh = beamMesh(ed.api, ed.mid, id, ed.placer().unitMm);
  if (!mesh) throw new Error(`Frame member #${id} has no readable geometry.`);
  return { id, kind: kind(model.classOf.get(id)), part: labels.get(id + (model.keyBase || 0)) || 'structure', a: mesh.a3, b: mesh.b3 };
}
export function captureFloorFrames(ed, model, keys, storey) {
  const ids = keys.map((key) => key - (model.keyBase || 0));
  if (!ids.length || ids.some((id) => !isFrameClass(model.classOf.get(id)))) throw new Error('Select beams or columns from one floor.');
  const elements = ed.elements(), relations = elements.relations();
  if (ids.some((id) => relations.container.get(id) !== storey)) throw new Error('Select members belonging to the current floor. Clear vertical stack selection first.');
  const labels = labelParts(ed.api, ed.mid, model, ed.W);
  const snap = ed.snapshot(ids), members = ids.map((id) => readMember(ed, model, labels, id));
  if (snap.top.length !== ids.length) throw new Error('These frame members cannot be copied independently.');
  return { editor: ed, snap, members, storey };
}
export function missingFloorFrames(buffer, ed, model, storey) {
  if (buffer.editor !== ed) throw new Error('Copy members again from the active model.');
  if (storey === buffer.storey) throw new Error('Switch to a different destination floor before pasting.');
  const z = (id) => ed.api.GetWorldTransformMatrix(ed.mid, ed.api.GetLine(ed.mid, id, false).ObjectPlacement.value)[14] * ed.placer().unitMm;
  const dz = z(storey) - z(buffer.storey), labels = labelParts(ed.api, ed.mid, model, ed.W), relations = ed.elements().relations();
  const existing = [];
  for (const [id, cls] of model.classOf) {
    if (!isFrameClass(cls) || relations.container.get(id) !== storey) continue;
    // Unreadable target geometry must not silently bypass duplicate protection.
    existing.push(readMember(ed, model, labels, id));
  }
  const missing = [];
  for (const m of buffer.members) {
    const shifted = { ...m, a: [m.a[0], m.a[1], m.a[2] + dz], b: [m.b[0], m.b[1], m.b[2] + dz] };
    if (!existing.some((other) => sameFrameAxis(shifted, other))) { missing.push(m); existing.push(shifted); }
  }
  return { missing, skipped: buffer.members.length - missing.length };
}
export function pasteFloorFrames(buffer, missing, storey, mergeJournals) {
  const wanted = new Set(missing.map((m) => m.id));
  const top = buffer.snap.elements.filter((e) => e.top);
  // Include dependent openings/parts only when their selected parent is copied.
  const children = new Set(wanted);
  const include = (id) => { const e = buffer.snap.elements.find((x) => x.id === id); if (!e) return; for (const child of [...e.parts, ...e.voids, ...(e.fills ? [e.fills] : [])]) if (!children.has(child)) { children.add(child); include(child); } };
  for (const id of wanted) include(id);
  const snap = { ...buffer.snap, top: top.filter((e) => wanted.has(e.id)).map((e) => e.id), elements: buffer.snap.elements.filter((e) => children.has(e.id)).map((e) => ({ ...e })) };
  const fixed = new Map();
  return (ed) => {
    if (ed !== buffer.editor) throw new Error('The copied members belong to another model.');
    // Give structural copies their own partition set; never update a shared source set.
    const structural = new Set(missing.filter((m) => m.part === 'structure').map((m) => m.id));
    const clean = { ...snap, elements: snap.elements.map((e) => ({ ...e, psets: e.psets.filter((ps) => !structural.has(e.id) || ed.api.GetLine(ed.mid, ps, false).Name?.value !== 'StructAlignModelPart') })) };
    const result = ed.elements().paste(clean, { storey });
    try {
      const extra = new ModelWriter(ed.W, ed.api, ed.mid).run((w) => {
        const made = new Map();
        for (let i = 0; i < result.all.length; i++) {
          const id = result.all[i], source = snap.elements[i].id, line = w.touch(id);
          if (!fixed.has(source)) fixed.set(source, line.GlobalId.value);
          line.GlobalId = w.T('IFCGLOBALLYUNIQUEID', fixed.get(source));
          // Own geometry lets later resizing/deletion leave the source member intact.
          const cloned = new Map();
          const cloneTree = (oldId) => {
            if (cloned.has(oldId)) return cloned.get(oldId);
            const old = ed.api.GetLine(ed.mid, oldId, false);
            const cls = ed.api.GetNameFromTypeCode(old.type);
            if (/^IFC(GEOMETRICREPRESENTATION.*CONTEXT|OWNERHISTORY|.*UNIT|MATERIAL.*|SURFACESTYLE.*|COLOURRGB)$/i.test(cls)) return oldId;
            const fresh = retypeLine(ed.api, ed.mid, Object.assign(Object.create(Object.getPrototypeOf(old)), old));
            const walk = (value) => {
              if (Array.isArray(value)) return value.map(walk);
              if (value && value.type === 5 && typeof value.value === 'number') return w.H(cloneTree(value.value));
              return value;
            };
            for (const name of Object.keys(fresh)) if (name !== 'expressID' && name !== 'type') fresh[name] = walk(fresh[name]);
            fresh.expressID = -1; if (fresh.GlobalId) fresh.GlobalId = w.guid();
            w.write(fresh); w.journal.created.push(fresh.expressID); cloned.set(oldId, fresh.expressID);
            return fresh.expressID;
          };
          if (line.Representation) line.Representation = w.H(cloneTree(line.Representation.value));
          w.write(line); made.set(fixed.get(source), id);
          for (const styledId of ids(ed.api, ed.mid, 'IFCSTYLEDITEM')) {
            const styled = ed.api.GetLine(ed.mid, styledId, false);
            if (cloned.has(styled.Item?.value)) w.make('IFCSTYLEDITEM', w.H(cloned.get(styled.Item.value)), styled.Styles, styled.Name);
          }
          // Authoring property sets also need independent values for later tool edits.
          for (const rid of ids(ed.api, ed.mid, 'IFCRELDEFINESBYPROPERTIES')) {
            const rel = ed.api.GetLine(ed.mid, rid, false);
            if (!rel.RelatedObjects?.some((h) => h.value === id)) continue;
            const changed = w.touch(rid), own = cloneTree(rel.RelatingPropertyDefinition.value);
            if (rel.RelatedObjects.length === 1) { changed.RelatingPropertyDefinition = w.H(own); w.write(changed); }
            else { changed.RelatedObjects = changed.RelatedObjects.filter((h) => h.value !== id); w.write(changed); w.relate(id, own); }
          }
          if (structural.has(source)) markStructural(w, id);
        }
        return { made };
      });
      return { ...result, id: result.ids[0], made: extra.made, journal: mergeJournals(result.journal, extra.journal) };
    } catch (error) { undoJournal(ed.api, ed.mid, result.journal); throw error; }
  };
}
