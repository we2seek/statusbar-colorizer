# Statusbar Colorizer

Automatically gives each workspace a unique color so you always know which project you're looking at — no configuration needed.

![VS Code status bar with a distinct color per workspace](https://via.placeholder.com/800x60/F2590D/000000?text=my-api+project)
<img width="2215" height="1476" alt="image" src="https://github.com/user-attachments/assets/60281c49-5400-4fd6-9410-0d24ec4fccb9" />

---

## How it works

When you open a workspace, the extension:

1. Hashes the workspace folder path to pick a starting color from a built-in 64-color palette
2. Scans sibling folders (projects sitting next to yours on disk) to find colors already in use
3. Picks the first palette color that isn't taken by a neighbor
4. Writes the color into your workspace's `.vscode/settings.json` — status bar and/or title bar depending on your settings
5. Picks white or black text automatically based on WCAG 2.1 contrast rules

The result is that projects living in the same parent folder get visually distinct colors, making it easy to tell them apart at a glance.

The color is assigned once and then left alone — reopening the same workspace always shows the same color. Nothing is written to your user settings; changes stay local to each workspace.

---

## Features

- **Zero configuration** — works immediately on any workspace
- **Neighbor-aware** — avoids colors already used by sibling projects
- **Deterministic** — same workspace always gets the same base color
- **WCAG-compliant text** — foreground color is chosen automatically for readable contrast
- **64-color muted palette** — dimmed, dusty colors spread across the full hue wheel using a golden-angle distribution
- **Status bar coloring** — enabled by default, can be turned off
- **Title bar coloring** — opt-in, colors the title bar to match the status bar
- **Two color strategies** — hash by workspace path (default) or by git branch name
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

## Title bar coloring

Title bar coloring is off by default. To enable it, add this to your user or workspace settings:

```json
"statusbarColorizer.colorTitleBar": true
```

The color is applied immediately — no reload needed.

> **macOS / Linux note:** title bar coloring requires VS Code's custom title bar. Add this to your user `settings.json` if the title bar isn't changing color after enabling:
> ```json
> "window.titleBarStyle": "custom"
> ```
> On Windows the custom title bar is already the default, so no extra step is needed.

---

## Disabling status bar coloring

If you only want the title bar colored and not the status bar, you can turn off status bar coloring:

```json
"statusbarColorizer.colorStatusBar": false
```

Changes to this setting take effect immediately. When status bar coloring is disabled, the extension removes the `statusBar.background` and `statusBar.foreground` keys from your workspace's `.vscode/settings.json` automatically — VS Code reverts to its default status bar color.

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

The extension only modifies `.vscode/settings.json` inside your workspace folder. The keys written depend on your settings.

Default (status bar only):

```json
{
  "workbench.colorCustomizations": {
    "statusBar.background": "#F2590D",
    "statusBar.foreground": "#000000"
  }
}
```

With `colorTitleBar: true`:

```json
{
  "workbench.colorCustomizations": {
    "statusBar.background": "#F2590D",
    "statusBar.foreground": "#000000",
    "titleBar.activeBackground": "#F2590D",
    "titleBar.activeForeground": "#000000"
  }
}
```

Existing settings in that file are preserved. Keys for disabled color targets (e.g. status bar when `colorStatusBar` is `false`, or title bar when `colorTitleBar` is `false`) are automatically removed from the file on the next write — no manual cleanup needed.

---

## Color strategy

By default the extension hashes the **workspace folder path** to pick a color — the same workspace always gets the same color regardless of which branch you're on.

You can switch to **branch-based coloring** so the color changes with the current git branch:

```json
"statusbarColorizer.colorStrategy": "branch"
```

With the `branch` strategy you can also pin specific branch names to specific colors. Common branches come pre-configured out of the box:

```json
"statusbarColorizer.branchColors": {
  "main":    "#B7B771",
  "master":  "#B7B771",
  "develop": "#74A8BE"
}
```

You can override these or add your own entries:

```json
"statusbarColorizer.branchColors": {
  "main":    "#B7B771",
  "master":  "#B7B771",
  "develop": "#74A8BE",
  "staging": "#74BE8A"
}
```

Any branch not listed in `branchColors` causes the extension to remove its managed color keys from `.vscode/settings.json`, letting VS Code revert to its default status bar color. This makes it easy to distinguish "known" branches (colored) from feature or personal branches (default color) at a glance.

Branches without a git repo fall back to the `project` strategy automatically.

---

## Settings reference

| Setting | Type | Default | Description |
|---|---|---|---|
| `statusbarColorizer.colorStrategy` | `string` | `"project"` | Color selection strategy. `"project"` hashes the workspace folder path; `"branch"` uses the current git branch name. |
| `statusbarColorizer.branchColors` | `object` | `{"main":"#B7B771","master":"#B7B771","develop":"#74A8BE"}` | Map of branch names to `#RRGGBB` colors. Only used when `colorStrategy` is `"branch"`. |
| `statusbarColorizer.colorPalette` | `string[]` | `[]` | Custom color palette (`#RRGGBB`). Overrides the built-in palette when non-empty. |
| `statusbarColorizer.colorStatusBar` | `boolean` | `true` | Apply the project color to the status bar background. Changes take effect immediately. |
| `statusbarColorizer.colorTitleBar` | `boolean` | `false` | Apply the project color to the title bar background. Changes take effect immediately. Requires `window.titleBarStyle: custom` on macOS/Linux. |

---

## Requirements

- VS Code 1.85 or later

---

## Installing from a `.vsix` file

If you received a `.vsix` file instead of installing from the Marketplace:

**Via terminal:**
```bash
code --install-extension statusbar-colorizer-0.0.2.vsix
```

**Via UI:**
1. Open the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Click the `...` menu at the top right of the panel
3. Select **Install from VSIX...**
4. Pick the `.vsix` file

Restart VS Code after installing.
