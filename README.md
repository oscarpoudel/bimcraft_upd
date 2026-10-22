<img src="screenshots/icon.svg" alt="" width="64" height="64">

# BimCraft

One model. Every plan, section and schedule.

**[Website](https://getcadcraft.com/apps/bimcraft) | [Use it in your browser](https://getcadcraft.com/use/bimcraft) | [Download CadCraft Studio](https://getcadcraft.com/download#studio) | [Help and tutorials](https://getcadcraft.com/tutorials/bimcraft) | [News](https://getcadcraft.com/news) | [Suggest a feature](https://getcadcraft.com/suggest)**

[![BimCraft](screenshots/paper.png)](https://getcadcraft.com/use/bimcraft)

<sub>Paper space above; [the same in model space](screenshots/model.png). Both are from the browser edition.</sub>

BimCraft is the BIM authoring app in the [CadCraft](https://getcadcraft.com) family: Parametric walls, doors and windows on levels and grids, with views, schedules, sheets and clash checks from one model.

## Use it

Use it now at https://getcadcraft.com/use/bimcraft, or install CadCraft Studio, which carries all eight apps. Your files stay on your computer either way.

| Platform | Status |
|---|---|
| [Browser](web/) | 0.6: `bimcraft-browser-edition-v0.6.0.zip` in [Releases](https://github.com/getcadcraft/bimcraft/releases), or build it from a clone ([BUILDING.md](BUILDING.md#the-browser-edition)) |
| Desktop: [Windows](windows/), [Linux](linux/) | In [CadCraft Studio 0.6](https://github.com/getcadcraft/studio/releases/tag/studio-v0.6.0) (installer, `.deb`, AppImage); not code-signed yet |
| [macOS](macos/) | In [CadCraft Studio 0.6](https://github.com/getcadcraft/studio/releases/tag/studio-v0.6.0) (universal disk image; not code-signed or notarized yet) |
| [Android](android/) | The Studio APK, on the [download page](https://getcadcraft.com/download#studio) |
| [iPad](ios/) | Planned, in 0.7 at the earliest |

## Work on it

```sh
node devshell/serve.mjs     # Node 20.19 or newer, no packages; then open http://127.0.0.1:8000/
npm test                    # the app's tests; libraries are fetched by exact version
```

`app/` is the code in development (the same code on every platform; each release is a tag), `web/` `windows/` `linux/` `macos/` `ios/` `android/` hold what ships or builds it on each, `devshell/` runs it without the website (`devshell/README.md`), `tests/` and `fixtures/` are its tests and public sample files. How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md); building from source: [BUILDING.md](BUILDING.md).

## License

Apache License 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). Libraries and their licenses: [THIRD_PARTY.md](THIRD_PARTY.md). Where the code comes from: [PROVENANCE.md](PROVENANCE.md). The names are trademarks; a fork must rename: [TRADEMARKS.md](TRADEMARKS.md).

## Structural drawing

The Draw tab works on structural models (opened as IFC) as well as architectural ones:

- **Beams.** `Build › Beam` (B) draws a beam from one point to another, snapped to grids and walls like the Wall tool, with its width, depth and how far above the level top it sits. Beams already in an opened IFC are picked and edited the same way, and `Modify › Extend beam` runs one beam to another.
- **Auto grid.** A model with no grid of its own shows one drawn through its beams (then its columns, then its walls' ends) — fainter, and snapped to like a real grid. **Auto grid** writes it into the model as a grid you can change afterwards, picking the floor that has structure automatically. Grid lines show in the plan and the 3D view with their bubbles; the **Grid lines** button on the model bar, the **Properties** tab and the **Library** turn them on and off or lay one out by spacing.
- **Parts.** The plan's **Parts** menu shows the whole level, only its structure (beams, columns, members, footings and piles) or only its architecture (walls, doors, windows, rooms, stairs and furniture); structure lying overhead is drawn dashed.
- **Copy a floor's frame.** Select a floor's beams and columns and click **Copy to floor**, switch floors, then **Paste on this floor**: the missing members are placed at the same world X/Y, existing matches are skipped, and member sizes and heights are preserved.
- **Move a frame, or its whole vertical stack.** Drag a beam or column in plan to move it. **Select vertical stack** gathers the aligned members above and below it (or the columns at the same plan position) so the whole stack moves as one.

When placing or pasting, items snap to a grid crossing, then a grid line, then the nearest wall.

## Local structural-viewer integration

When opened using **Edit combined IFC in BimCraft** in the structural viewer,
the `structalign` edit link loads that model and routes Save as IFC / Ctrl+S
back to a versioned viewer revision. The viewer reloads automatically. Normal
standalone saving is unchanged. See [BIMCRAFT_EDITING.md](../BIMCRAFT_EDITING.md).
