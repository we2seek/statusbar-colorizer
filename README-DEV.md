# Developer Guide — project-statusbar-colorizer

This guide covers everything you need to develop, debug, install locally, and publish this VS Code extension.

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [VS Code](https://code.visualstudio.com/) or Kiro
- Dependencies installed:

```bash
npm install
```

---

## Running the Extension During Development

VS Code has a built-in mechanism called the **Extension Development Host** — a sandboxed VS Code window that loads your extension from source. No installation required.

### Step 1 — Compile TypeScript

The extension entry point is `./out/extension.js`, so you need to compile before running:

```bash
npm run compile
```

### Step 2 — Launch the dev host

Press **`F5`** in VS Code / Kiro. This reads `.vscode/launch.json` (already configured in this repo) and opens a new VS Code window with your extension loaded.

Open any folder in that new window — the extension activates automatically and assigns a status bar color.

### Recompiling on save (watch mode)

Add this script to `package.json` so TypeScript recompiles automatically on every file save:

```json
"watch": "tsc -watch -p ./"
```

Then run in a terminal:

```bash
npm run watch
```

After each recompile, reload the Extension Development Host window with **`Ctrl+R`** (or **`Cmd+R`** on Mac) to pick up the changes.

### Debugging with breakpoints

With the existing `launch.json`, breakpoints work out of the box:

1. Set a breakpoint in any `.ts` source file
2. Press **`F5`** to launch
3. Trigger the code path in the dev host window
4. VS Code pauses at your breakpoint with full variable inspection

The `outFiles` field in `launch.json` maps compiled JS back to TypeScript source automatically.

### Testing the reassign command

In the Extension Development Host window:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type **"Project Statusbar Colorizer: Reassign Color"**
3. Run it — the status bar color will be reassigned and a notification will appear

---

## Running Tests

```bash
# Run all tests once
npm test

# Run in watch mode (re-runs on file changes)
npx vitest
```

Tests live in `src/__tests__/` and cover all components with both unit tests and property-based tests (fast-check).

---

## Installing Locally (without publishing)

You can package the extension into a `.vsix` file and install it in any VS Code instance.

### Step 1 — Install vsce

```bash
npm install -g @vscode/vsce
```

### Step 2 — Add a publisher field to package.json

`vsce` requires a `publisher` field. Edit `package.json`:

```json
"publisher": "your-publisher-name"
```

Also make sure a `README.md` file exists (vsce requires it). You can create a minimal one:

```bash
echo "# Project Statusbar Colorizer" > README.md
```

### Step 3 — Package

```bash
vsce package
```

This produces a file like `project-statusbar-colorizer-0.0.1.vsix`.

### Step 4 — Install

**Via terminal:**

```bash
code --install-extension project-statusbar-colorizer-0.0.1.vsix
```

**Via UI:**

1. Open the Extensions panel (`Ctrl+Shift+X`)
2. Click the `...` menu (top-right of the panel)
3. Select **Install from VSIX...**
4. Pick the `.vsix` file

Restart VS Code after installing. The extension will activate automatically when you open a workspace.

---

## Publishing to the VS Code Marketplace

### Step 1 — Create a publisher account

Go to [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and sign in with a Microsoft account. Create a publisher — the ID you choose becomes the `publisher` field in `package.json`.

### Step 2 — Create a Personal Access Token (PAT)

1. Go to [dev.azure.com](https://dev.azure.com)
2. Sign in → your organization → **User Settings** → **Personal Access Tokens**
3. Create a new token with scope: **Marketplace → Manage**
4. Copy the token — you won't see it again

### Step 3 — Login with vsce

```bash
vsce login your-publisher-name
# paste your PAT when prompted
```

### Step 4 — Publish

```bash
vsce publish
```

The extension appears on the Marketplace within a few minutes.

### Subsequent releases

Bump the version in `package.json` and publish again:

```bash
# Manual version bump + publish
vsce publish

# Or let vsce bump the version automatically
vsce publish patch   # 0.0.1 → 0.0.2
vsce publish minor   # 0.0.1 → 0.1.0
vsce publish major   # 0.0.1 → 1.0.0
```

---

## Releasing a New Version on GitHub

Releases live at: **https://github.com/we2seek/statusbar-colorizer/releases**

### Step 1 — Bump the version in `package.json`

Edit the `version` field manually:

```json
"version": "0.0.2"
```

Or use npm to bump it automatically:

```bash
npm version patch   # 0.0.1 → 0.0.2
npm version minor   # 0.0.1 → 0.1.0
npm version major   # 0.0.1 → 1.0.0
```

`npm version` also creates a git commit and tag automatically.

### Step 2 — Compile and package

```bash
npm run compile
npm run package
```

This produces a file like `statusbar-colorizer-0.0.2.vsix`.

### Step 3 — Commit and push (if you bumped manually)

Skip this if you used `npm version` — it already made the commit.

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 0.0.2"
git push
```

### Step 4 — Create the GitHub Release

**Option A — using `gh` CLI:**

```bash
gh release create v0.0.2 statusbar-colorizer-0.0.2.vsix \
  --title "v0.0.2" \
  --notes "Describe what changed in this release"
```

**Option B — GitHub web UI (no extra tools needed):**

1. Go to `https://github.com/we2seek/statusbar-colorizer/releases/new`
2. Enter the tag name: `v0.0.2`
3. Fill in the title and release notes
4. Drag and drop the `.vsix` file into the attachments area
5. Click **Publish release**

The `.vsix` file is attached automatically and available for download on the releases page.

---

## Quick Reference

| Goal | Command |
|---|---|
| Install dependencies | `npm install` |
| Compile once | `npm run compile` |
| Compile on save | `npm run watch` |
| Run in dev host | `F5` |
| Run tests | `npm test` |
| Package as `.vsix` | `npm run package` |
| Install locally | `code --install-extension *.vsix` |
| Create GitHub release | `gh release create v0.0.2 *.vsix --title "v0.0.2" --notes "..."` |
| Login to Marketplace | `vsce login <publisher>` |
| Publish | `vsce publish` |

---

## Extending the Color Palette

The palette is defined as a static array in `src/palette.ts`. To regenerate it with a different size, use this script (golden angle HSL distribution — hues are maximally spread, lightness alternates 58/60% with saturation 33/36/39% for a dimmed, dusty feel; foreground text is chosen adaptively so all colors pass WCAG 4.5:1):

```bash
node -e "
const goldenAngle = 137.508;

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return ('#' + f(0) + f(8) + f(4)).toUpperCase();
}

const COUNT = 64; // change this to 32, 128, etc.
const colors = [];
for (let i = 0; i < COUNT; i++) {
  const hue = (i * goldenAngle) % 360;
  const lightness = i % 2 === 0 ? 58 : 60;
  const saturation = 33 + (i % 3) * 3;
  colors.push({ hex: hslToHex(hue, saturation, lightness), hue: Math.round(hue) });
}
colors.forEach(c => console.log(c.hex + ' // hue ' + c.hue));
"
```

Copy the output into `src/palette.ts` as the `BUILT_IN_PALETTE` array entries.

---

## Project Structure

```
project-statusbar-colorizer/
├── src/
│   ├── extension.ts          # Entry point — activate() and deactivate()
│   ├── orchestrator.ts       # Main coordinator
│   ├── colorAssigner.ts      # Deterministic color selection
│   ├── contrastChecker.ts    # WCAG 2.1 contrast calculation
│   ├── neighborScanner.ts    # Scans sibling projects for occupied colors
│   ├── settingsFileManager.ts # Reads/writes .vscode/settings.json
│   ├── pluginConfiguration.ts # Reads VS Code settings
│   ├── palette.ts            # Built-in color palette
│   └── fnv1a.ts              # FNV-1a 32-bit hash function
│   └── __tests__/            # All test files
├── out/                      # Compiled JS (generated, not committed)
├── .vscode/launch.json       # F5 debug configuration
├── package.json
├── tsconfig.json
└── vitest.config.ts
```
