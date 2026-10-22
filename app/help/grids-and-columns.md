---
title: Grids, columns and beams
summary: Lay out grid lines with numbered and lettered bubbles, by spacing or one by one, draw walls, columns and beams along them, and see them on plans, elevations and sections, and as reference lines in the 3D view.
section: tasks
order: 31
keywords: grid, grids, grid line, column grid, axis, axes, bubble, gridline, structural grid, 1 2 3, A B C, column, columns, pillar, post, snap, IfcGrid, IfcColumn, beam, beams, structural, architecture, parts, IfcBeam, 3D view, grid lines in 3D, no grid, auto grid, grid from beams, grid from walls, grid from columns, properties, library
---

## What you'll do

Set out a building on a grid, then draw walls, place columns and run beams along its lines.

## Place a whole grid

1. Turn on {{ui:Draw}}, then choose {{ui:Build}} › {{ui:Grid}}.
2. Click {{ui:Place a grid…}} — or {{ui:Auto grid}}, which lays one out for you through the model's beams (see [A model with no grid](#a-model-with-no-grid)). Say how many **numbered lines** (1, 2, 3…) and **lettered lines** (A, B, C…) you want and how far apart. Type one spacing, or several separated by commas for uneven bays (for example `20', 24', 20'`). {{ui:Past the last lines}} is how far each line runs beyond the outer lines of the other kind, and {{ui:Turned (degrees)}} turns the whole grid.
3. Click {{ui:Place it}}, then click where the first crossing (1 / A) goes. The preview follows the pointer.

Numbered lines run up the plan and are spaced across it; lettered lines run across the plan and are spaced up it. Letters skip I and O, as on drawings, so they are never read as 1 and 0.

## Draw grid lines one by one

With {{ui:Grid}} on, click where a line starts and where it ends. It gets the next label of the lines it runs along (after 3 comes 4; after B comes C). Press {{key:Esc}} to stop.

## Change a grid line

With {{ui:Grid}} on, click a line to pick it. Type a new {{ui:Label}} and press {{key:Enter}}, or click {{ui:Delete this line}} (or press {{key:Delete}}). {{ui:Bubbles}} puts the bubbles at both ends, at the start or end of each line, or nowhere. Each change is one step: {{key:Mod+Z}} takes it back.

## Draw along the grid

The {{ui:Wall}} tool, the {{ui:Column}} tool and the other drawing tools snap to grid lines and to where they cross (the snap mark is a small circle with a cross).

**Columns:** choose {{ui:Build}} › {{ui:Column}}, pick the shape (rectangular or round), the size, and whether the column runs **to the level above** or to a fixed height, then click. {{ui:At every grid crossing}} places a column at each crossing that has none yet. Click a column to change its shape, size or height in {{ui:Properties}}; {{key:Delete}} removes it. Columns that run to the level above follow it when its height changes.

**Beams:** choose {{ui:Build}} › {{ui:Beam}} ({{key:B}}), set the width and depth of its section and how far **above the level top** it sits, then click where it starts and where it ends. It snaps to grid lines, crossings and walls like the Wall tool, and the pointer shows its length and size while you draw. A beam's top sits at the level top unless you raise it, and {{ui:Modify}} › {{ui:Extend beam}} can run it to another beam. See [Trim, extend and join walls](topic:trim-extend-walls).

## In the 3D view

The model's grid lines show in the 3D view as reference lines: each line at the building's base and at its top, the ends joined, with a bubble and its label at the top. Like the plan's grid they come from the model's own grids, so they follow a grid you place, change or delete, and they are drawn over the building so walls and columns standing on them stay visible.

{{ui:Grid lines}} in the model bar (beside {{ui:Dimensions}}) shows and hides the grid lines, in the plan and the 3D view together. The drawing tools, and {{ui:Snap}} while you place an item, keep snapping to them either way.

**Placing a library item in the 3D view:** while {{ui:Snap}} is on ({{key:Tab}}), the item goes to the nearest grid crossing first, then to the nearest grid line, and otherwise its back goes against the nearest wall. The placing bar names the grid it is on, for example `on grid 2 / B`. See [Place an item from the library](topic:place-from-library).

## The grid in Properties and the Library

The side panel's {{ui:Properties}} tab has a **Grid** block above the picked element's properties: {{ui:Grid lines}} shows and hides the lines, in the 3D view and the plan together (the same as the model bar's button), and the chips below list the labels of the model's lines — click one to pick that line on the plan. {{ui:Auto grid}} makes a grid from the model's structure and {{ui:Place a grid…}} lays one out by spacing.

The {{ui:Library}} tab has the same **Grid** card above the library's sources, so a grid can be made or placed from there as well.

## A model with no grid: Auto grid

A file that has structural elements but no grid of its own (an IfcGrid) shows a grid drawn from them: each distinct position of its **beams** across and up the plan becomes a numbered or a lettered line, run on past the outermost. A beam runs along a grid line, so its ends are where the lines go; columns come next, and walls when the model has neither. These lines are drawn fainter than a grid that is in the file, in the plan and in the 3D view, and the drawing tools and {{ui:Snap}} use them like any other grid — but they are not written to the file.

Press {{ui:Auto grid}} (in {{ui:Properties}}, the {{ui:Library}}, or beside {{ui:Place a grid…}} on the Draw bar) to write that grid into the model. It is a real grid from then on: its labels can be renamed, its lines moved and deleted, and it is saved with the file. Its lines are square to the level you are drawing on, and its undo step is one — {{key:Mod+Z}} takes the whole grid away.

A building has one grid, so pressing {{ui:Auto grid}} again on a building that has one says so rather than making a second: change the lines you have (see [Change a grid line](#change-a-grid-line)), or delete them and press it again to lay them out afresh.

## What the plan shows

The plan's {{ui:Parts}} menu (beside the level and the floor or ceiling plan) draws the whole level, **only its structure** or **only its architecture**. Structure is beams, columns, members, footings and piles; architecture is walls, doors, windows, rooms, stairs and furniture. Beams and other structure that lie overhead, up to the level top, are drawn dashed, as a floor plan shows what it cuts below. A floor slab is drawn in every view, and a file's own labels (for example a structural model that labels its walls as structure) win over the element's kind.

## What you should see

- The grid on the plan of every level, with a bubble and its label at the ends of each line.
- The same grid lines in the 3D view, base to top, with a bubble at the top of each, and an item placed in 3D landing on a crossing or a line while {{ui:Snap}} is on.
- In a model that has no grid, fainter lines through its beams (or its columns, or its walls' ends), with the labels listed in {{ui:Properties}}; {{ui:Auto grid}} turns them into a grid that is saved with the file.
- Grid lines on the drawing set: on the plans, and on elevations and sections where a line is seen end on, with its bubble above the building. See [Elevations, sections and sheets](topic:sheets).
- In the IFC file: one grid for the building (IfcGrid, its numbered lines in one list and its lettered lines in the other), and columns as IfcColumn with their size, height and quantities. Other BIM programs show both.

:::note
A grid that came in a file from another program is shown, and the tools snap to it, but its lines cannot be changed here.
:::
