---
title: Trim, extend and join walls, and extend beams
summary: Trim or extend walls to another wall, join two walls at the point where they meet, and run a beam to another beam, each as one step you can undo.
section: tasks
order: 33
keywords: trim, extend, corner, join, meet, clean up, wall end, wall corner, cut back, lengthen, shorten, modify, beam, beams, steel, concrete, TR
---

## What you'll do

Tidy what you drew: cut back a wall that runs past another, lengthen one that stops short, close an open corner, or run a beam to another beam.

## Steps

1. Turn on {{ui:Draw}} and choose the level in the plan's level list.
2. **Trim or extend to a wall:** choose {{ui:Modify}} › {{ui:Trim / extend}}. Click the wall to trim or extend to (the edge), then click each wall you want to change. A wall that runs past the edge is cut back to it, and the part you click is the part that stays; a wall that stops short is lengthened until it meets the edge. The edge stays chosen, so you can click several walls one after the other. Press {{key:Esc}} to choose another edge.
3. **Join two walls at a corner:** choose {{ui:Modify}} › {{ui:Corner}}, click the first wall, then the second. Both run to the point where they meet, and BimCraft cleans the corner. When a wall crosses the other one, the part you clicked stays.
4. **Run a beam to another beam:** choose {{ui:Modify}} › {{ui:Extend beam}} (a model with beams, such as a structural model opened as IFC). Click the beam you want to extend, then the beam to extend it to: the end nearer that beam runs to its face, and the beam stays chosen for the next one. Beams are picked by their center lines on the plan, and a beam picked in the 3D view counts too.
5. Press {{key:Esc}} to start again, or {{key:V}} to go back to {{ui:Select}}.

## What you should see

- While you point at a wall, the plan shows where it would go, already joined to the walls it meets, with its new length.
- While you point at the beam to extend to, the plan shows where the beam would end and the length it would become.
- Each change is one step: {{key:Mod+Z}} takes it back.
- Rooms, floors, ceilings, roofs and what follows the walls are made again, as after any change to the walls. A room closed by a corner appears with its number and area.
- A door or window on a part that is cut off is deleted with it.

## Good to know

- Walls are drawn on their center line, so they are trimmed and extended along it: a wall meets the other wall's center line, and the joint is cleaned into a T or an L.
- BimCraft says why when it cannot do it: the two walls are parallel, the wall's line passes beside the other wall, a door or window is in the way (move or delete it first), or what is left would be shorter than 50 mm.
- Only walls drawn in BimCraft can be trimmed or extended.
- A beam is extended only when its body is one straight piece: a beam clipped with a Boolean, made of several solids, or drawn as a mapped shape is left alone, and BimCraft says so. The beam's own Length and Gross length are kept up to date.
- While the beam tool is on, the plan draws the level's beams as their center lines: the beams drawn in BimCraft, including those read from an opened IFC.

See also [Draw walls](topic:draw-walls) and [Change a wall, door or window](topic:change-a-wall-or-door).
