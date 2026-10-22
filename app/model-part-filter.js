/* SPDX-License-Identifier: Apache-2.0 */
/** Display-only architectural/structural filtering using explicit IFC partitions. */
import { propertyIndex } from './ifc-props.js';

export function modelParts(entries, indexFor) {
  const result = { structure: [], architecture: [], unclassified: [] };
  for (const entry of entries) {
    const ix = indexFor(entry);
    const grouped = new Map();
    const api = entry.ifc.api, mid = entry.model.modelID;
    try {
      const relations = api.GetLineIDsWithType(mid, api.GetTypeCodeFromName('IFCRELASSIGNSTOGROUP'));
      for (let i = 0; i < relations.size(); i++) {
        const rel = api.GetLine(mid, relations.get(i), false);
        const group = api.GetLine(mid, rel.RelatingGroup.value, false);
        const role = { 'StructAlign Structure': 'structure', 'StructAlign Architecture': 'architecture' }[group.Name?.value];
        if (role) for (const member of rel.RelatedObjects || []) grouped.set(member.value, role);
      }
    } catch { /* Files without explicit groups can still use ModelPart properties. */ }
    for (const id of ix.ids) {
      const declared = String(ix.value('p:StructAlignModelPart.ModelPart', id) ?? '').trim().toLowerCase();
      const cls = entry.model.classOf?.get(id) || '';
      // Older Draw-created frame parts had authoring sets but no partition.
      // Preserve explicit roles and avoid guessing the role of source members.
      const authored = (/^IfcBeam(StandardCase)?$/i.test(cls) && ix.value('p:CadCraft_Beam.Width', id) != null) ||
        (/^IfcColumn(StandardCase)?$/i.test(cls) && ix.value('p:CadCraft_Column.Width', id) != null);
      const role = ['structure', 'architecture'].includes(declared) ? declared : grouped.get(id) || (authored ? 'structure' : null);
      result[role || 'unclassified'].push((entry.model.keyBase || 0) + id);
    }
  }
  return result;
}

export function mountPartFilter({ W, models, viewer, after, changed, status }) {
  const panel = document.createElement('section'); panel.className = 'bc-sec';
  panel.dataset.modelPartFilter = '';
  const heading = document.createElement('h2'); heading.className = 'bc-h'; heading.textContent = 'Model parts';
  const buttons = document.createElement('div');
  Object.assign(buttons.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
  const note = document.createElement('p'); note.className = 'bc-note'; note.setAttribute('role', 'status');
  panel.append(heading, buttons, note); after.after(panel);
  let mode = 'all', lastParts = null;
  const controls = new Map();
  function apply(next) {
    const view = viewer();
    if (!view || !models().length) return;
    const parts = modelParts(models(), entry => propertyIndex(W, entry.ifc.api, entry.model.modelID, entry.model));
    if (next !== 'all' && !parts[next].length) {
      note.textContent = `No labelled ${next === 'structure' ? 'structural' : 'architectural'} parts found. Current view kept.`;
      status(note.textContent); return;
    }
    mode = next; lastParts = parts;
    if (mode === 'all') view.vis.showAll();
    else view.vis.isolate(parts[mode], { ghost: false });
    view.applyVisibility();
    changed(mode);
    panel.dataset.mode = mode;
    for (const [key, button] of controls) button.setAttribute('aria-pressed', String(key === mode));
    note.textContent = `${parts.structure.length} structural · ${parts.architecture.length} architectural` +
      (parts.unclassified.length ? ` · ${parts.unclassified.length} unlabelled (visible with Show all parts)` : '');
    status(mode === 'all' ? 'Showing all parts.' : mode === 'structure' ? 'Showing structural parts only.' : 'Showing architectural parts only; structural parts hidden.');
  }
  for (const [key, label] of [['structure', 'Structural only'], ['architecture', 'Architectural only'], ['all', 'Show all parts']]) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'btn-line btn-sm-cc'; button.textContent = label;
    button.dataset.modelPart = key; button.setAttribute('aria-pressed', String(key === mode));
    button.addEventListener('click', () => apply(key)); buttons.append(button); controls.set(key, button);
  }
  const filter = {
    apply,
    state: () => ({ mode, parts: lastParts, visibility: viewer()?.vis.toJSON() }),
    refresh() {
      panel.hidden = !models().length;
      if (!panel.hidden && mode !== 'all') apply(mode);
      else if (!panel.hidden) note.textContent = 'Filter using the IFC architecture/structure labels. This changes visibility only.';
    },
  };
  filter.refresh();
  return filter;
}
