# Statusbar Colorizer

Automatically gives each workspace a unique status bar color so you always know which project you're looking at — no configuration needed.

![VS Code status bar with a distinct color per workspace](https://via.placeholder.com/800x60/772222/FFFFFF?text=my-api+project)

---

## How it works

When you open a workspace, the extension:

1. Hashes the workspace folder path to pick a starting color from a built-in 64-color palette
2. Scans sibling folders (projects sitting next to yours on disk) to find colors already in use
3. Picks the first palette color that isn't taken by a neighbor
4. Writes `statusBar.background` and `statusBar.foreground` into your workspace's `.vscode/settings.json`
5. Picks white or black text automatically based on WCAG 2.1 contrast rules

The result is that projects living in the same parent folder get visually distinct colors, making it easy to tell them apart at a glance.

The color is assigned once and then left alone — reopening the same workspace always shows the same color. Nothing is written to your user settings; changes stay local to each workspace.

---

## Features

- **Zero configuration** — works immediately on any workspace
- **Neighbor-aware** — avoids colors already used by sibling projects
- **Deterministic** — same workspace always gets the same base color
- **WCAG-compliant text** — foreground color is chosen automatically for readable contrast
- **64-color palette** — colors are spread across the full hue wheel using a golden-angle distribution, so neighbors rarely look similar
- **Reassign command** — if you don't like the assigned color, cycle to the next available one

---

## Usage

Just open a folder in VS Code. The extension activates automatically and sets the status bar color. You won't see any prompts or notifications unless something goes wrong.

### Reassigning a color

If the assigned color clashes with something or you just want a different one:

1. Open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux)
2. Run **Statusbar Colorizer: Reassign Color**

Each time you run it, the extension cycles to the next available color in the palette. A notification confirms the new color hex value.

---

## Custom palette

You can replace the built-in palette with your own colors via VS Code settings.

Open your settings (`Cmd+,`) and search for **Statusbar Colorizer**, or add this to your `settings.json`:

```json
"statusbarColorizer.colorPalette": [
  "#1B4F72",
  "#145A32",
  "#6E2F1A",
  "#4A235A"
]
```

Colors must be in `#RRGGBB` hex format. If any value is invalid, the extension falls back to the built-in palette and shows an error message.

Leave the array empty (or don't set it) to use the built-in 64-color palette.

---

## What gets written to your workspace

The extension only modifies `.vscode/settings.json` inside your workspace folder. It sets two keys:

```json
{
  "workbench.colorCustomizations": {
    "statusBar.background": "#2C966E",
    "statusBar.foreground": "#FFFFFF"
  }
}
```

Existing settings in that file are preserved. If you want to remove the color, just delete those two keys from the file.

---

## Requirements

- VS Code 1.85 or later

---

## Installing from a `.vsix` file

If you received a `.vsix` file instead of installing from the Marketplace:

**Via terminal:**
```bash
code --install-extension statusbar-colorizer-0.0.1.vsix
```

**Via UI:**
1. Open the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Click the `...` menu at the top right of the panel
3. Select **Install from VSIX...**
4. Pick the `.vsix` file

Restart VS Code after installing.
