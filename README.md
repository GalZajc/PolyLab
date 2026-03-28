# PolyLab Beta

PolyLab is a 2D/3D polygon net editor for designing, folding, coloring, printing, and exporting polyhedral nets. The current build is the first beta-quality version: the core workflow is in place, the advanced tools are usable, and the app is stable enough to document and test more seriously.

## Main Features

- Build nets from regular polygons, custom irregular polygons, supported triangle inputs, and Catalan solid face presets.
- Edit in both 2D and 3D, with linked selection and tool parity across views.
- Use rotate, link, reflect, lasso, bucket, and three magnet modes for folding and gluing constraints.
- Preview advanced magnet constructions with circle/intersection guides in 3D.
- Customize shortcuts, dark/light themes, and several UI behaviors in Settings.
- Print selected faces or whole nets with paper layout tools, glue tabs, fit/optimize actions, and SVG export.
- Export folded or selected geometry as JSON or as mesh CSV files for vertices and indices.

## Views And Editing

- 2D view is the main net editor.
- 3D view shows the currently focused connected net and supports inspection, selection, pivot picking, and magnet previews.
- Middle click on a face sets the 3D pivot.
- Shift+Enter toggles the 3D pane by default.
- Most tools work in both views, including face and edge selection.

## Tools

- `Esc`: return to normal selection / cancel current tool.
- `R`: rotate selected face component.
- `L`: link two edges.
- `Ctrl+R`: reflect selection.
- `B`: bucket fill selected target face.
- `Ctrl+L`: lasso selection.
- `M`: regular magnet.
- `Shift+M`: magnet by two hinges and two vertices.
- `Ctrl+M`: magnet by two hinges and two target edges.
- Double left click by default: reverse the last magnet fold.

All shortcuts are remappable in the Settings menu.

## File Actions

- `Ctrl+O`: open a saved PolyLab JSON file.
- `Ctrl+S`: save to the current JSON file.
- `Ctrl+Shift+S`: save as a new JSON file.
- `Ctrl+E`: export mesh CSV data.
- `Ctrl+P`: open the print/export dialog.

## Print / Export

The print dialog supports:

- A4, A3, and Letter paper sizes.
- Centimeter or inch output scaling.
- Margin and line-thickness control.
- Fit and Optimize actions for packing onto the page.
- Optional glue tabs, including a shared-3D tab strategy.
- Print and SVG export.

The mesh export dialog supports:

- Optional duplicate-vertex merging with tolerance.
- Optional triangulation.
- Separate export of `vertices.csv` and `indices.csv`.

## Settings

Current settings include:

- Remappable keyboard and mouse shortcuts.
- Light/dark/custom appearance for menus, 2D canvas, 3D background, and print paper preview.
- Magnet preview guides toggle.
- Optional background-click tool exit behavior.
- Option to hide the regular `3/4/5/6` polygon quick buttons.

## Run Locally

Requirements:

- Node.js

Commands:

1. `npm install`
2. `npm run dev`

For a production build:

1. `npm run build`
2. Open the generated app through the included Windows launcher scripts, or serve the `dist` folder.

## Windows App Launch

This repo includes Windows helper scripts such as:

- `setup_and_run.bat`
- `Open PolyLab.bat`
- `Launch PolyLab.vbs`

They are intended to make the built app feel more like a standalone desktop tool instead of a raw browser tab.
