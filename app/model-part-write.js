/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit partition for newly authored frame members, in the creation journal. */
import { ids, val } from './ifc-util.js';

export function markStructural(w, id) {
  w.upsertPset(id, 'StructAlignModelPart', [
    ['ModelPart', 'IFCLABEL', 'structure'], ['Origin', 'IFCLABEL', 'manual_edit'],
  ]);
  const name = 'StructAlign Structure';
  let group = ids(w.api, w.mid, 'IFCGROUP').find((gid) => val(w.api.GetLine(w.mid, gid, false)?.Name) === name);
  if (!group) group = w.make('IFCGROUP', w.guid(), w.ownerHistory(), w.L(name), null, null);
  for (const rid of ids(w.api, w.mid, 'IFCRELASSIGNSTOGROUP')) {
    const relation = w.api.GetLine(w.mid, rid, false);
    if (relation.RelatingGroup?.value !== group) continue;
    if (!(relation.RelatedObjects || []).some((h) => h.value === id)) {
      const changed = w.touch(rid);
      changed.RelatedObjects = [...changed.RelatedObjects || [], w.H(id)];
      w.write(changed);
    }
    return;
  }
  w.make('IFCRELASSIGNSTOGROUP', w.guid(), w.ownerHistory(), null, null, [w.H(id)], null, w.H(group));
}
