/* SPDX-License-Identifier: Apache-2.0 */
/**
 * model-part.js — which part of the building an element belongs to, for the Draw tab's Parts view (all / structural /
 * architectural). No DOM: model-ui.js uses it for the plan; bin/test-bimcraft.mjs can run it in Node.
 *
 * The explicit labels win when a file has them (StructAlign's IFCRELASSIGNSTOGROUP groups "StructAlign Structure" and
 * "StructAlign Architecture", or the ModelPart property), because a structural wall is still a wall by its IFC class.
 * Files without labels fall back to the class: beams, columns, members, footings, piles, plates and reinforcement are
 * structural; walls, doors, windows, rooms, roofs, stairs, railings, coverings and furniture are architectural. What is
 * neither (slabs, ducts, and everything else) is shown in every view: it belongs to both.
 *
 *   classPart(cls)                        → 'structure' | 'architecture' | null (the class rule)
 *   classParts(model)                     → Map(key → 'structure' | 'architecture')  (cheap: the class rule)
 *   labelParts(api, mid, model, W)        → Map(key → part)  (the explicit labels; W = the WebIFC module, for properties.
 *                                          Costs a property index: call it only when a part view is chosen, then cache it)
 */
import { propertyIndex } from './ifc-props.js';

const STRUCTURE = new Set([
  'IFCBEAM', 'IFCBEAMSTANDARDCASE', 'IFCCOLUMN', 'IFCCOLUMNSTANDARDCASE', 'IFCMEMBER', 'IFCMEMBERSTANDARDCASE',
  'IFCFOOTING', 'IFCPILE', 'IFCPLATE', 'IFCPLATESTANDARDCASE', 'IFCREINFORCINGBAR', 'IFCREINFORCINGMESH',
  'IFCTENDON', 'IFCTENDONANCHOR', 'IFCTENDONCONDUIT',
]);
const ARCHITECTURE = new Set([
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE', 'IFCDOOR', 'IFCDOORSTANDARDCASE', 'IFCWINDOW',
  'IFCWINDOWSTANDARDCASE', 'IFCSPACE', 'IFCROOF', 'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAMP', 'IFCRAMPFLIGHT',
  'IFCRAILING', 'IFCCOVERING', 'IFCCURTAINWALL', 'IFCFURNISHINGELEMENT', 'IFCFURNITURE', 'IFCSYSTEMFURNITUREELEMENT',
  'IFCSANITARYTERMINAL',
]);

/** The part a class belongs to by the class rule; null when it belongs to both (a slab, a duct) or is not known. */
export function classPart(cls) {
  const c = String(cls || '').replace(/^Ifc/i, 'IFC').toUpperCase();
  return STRUCTURE.has(c) ? 'structure' : ARCHITECTURE.has(c) ? 'architecture' : null;
}

/** Every element the class rule can place: Map(key → part). Cheap (the model's class table only). */
export function classParts(model) {
  const out = new Map(), kb = model?.keyBase || 0;
  for (const [id, cls] of model?.classOf || []) {
    const p = classPart(cls);
    if (p) out.set(kb + id, p);
  }
  return out;
}

/** Explicit ModelPart properties, then groups; legacy Draw frame markers fill unlabelled gaps. */
export function labelParts(api, mid, model, W = null) {
  const kb = model?.keyBase || 0, out = new Map(), grouped = new Map();
  try {
    const rels = api.GetLineIDsWithType(mid, api.GetTypeCodeFromName('IFCRELASSIGNSTOGROUP'));
    for (let i = 0; i < rels.size(); i++) {
      const rel = api.GetLine(mid, rels.get(i), false);
      const group = rel?.RelatingGroup ? api.GetLine(mid, rel.RelatingGroup.value, false) : null;
      const role = { 'StructAlign Structure': 'structure', 'StructAlign Architecture': 'architecture' }[group?.Name?.value];
      if (role) for (const member of rel.RelatedObjects || []) grouped.set(member.value, role);
    }
  } catch (e) { /* a file without groups still uses its classes */ }
  let ix = null;
  if (W) { try { ix = propertyIndex(W, api, mid, model); } catch (e) { ix = null; } }
  for (const [id, cls] of model?.classOf || []) {
    const declared = String(ix?.value('p:StructAlignModelPart.ModelPart', id) ?? '').trim().toLowerCase();
    let part = ['structure', 'architecture'].includes(declared) ? declared : grouped.get(id) || null;
    if (!part && ix && ((/^IfcBeam(StandardCase)?$/i.test(cls) && ix.value('p:CadCraft_Beam.Width', id) != null) ||
      (/^IfcColumn(StandardCase)?$/i.test(cls) && ix.value('p:CadCraft_Column.Width', id) != null))) part = 'structure';
    if (part) out.set(kb + id, part);
  }
  return out;
}
