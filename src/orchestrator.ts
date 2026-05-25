import * as path from 'path';
import * as vscode from 'vscode';
import { NeighborScanner } from './neighborScanner';
import { ColorAssigner } from './colorAssigner';
import { ContrastChecker } from './contrastChecker';
import { SettingsFileManager } from './settingsFileManager';
import { PluginConfiguration } from './pluginConfiguration';
import { BranchDetector } from './branchDetector';
import { BranchColorResolver } from './branchColorResolver';

export interface OrchestratorOptions {
  force?: boolean;
  offset?: number;
}

export type AssignmentResult =
  | { status: 'skipped'; reason: 'no-workspace' | 'already-assigned' | 'no-branch' | 'already-cleared' | 'no-branch-mapping' }
  | { status: 'assigned'; backgroundColor: string; foregroundColor: string }
  | { status: 'cleared' }
  | { status: 'error'; message: string };

export class ColorAssignmentOrchestrator {
  constructor(
    private scanner: NeighborScanner,
    private assigner: ColorAssigner,
    private contrastChecker: ContrastChecker,
    private settingsManager: SettingsFileManager,
    private config: PluginConfiguration,
    private branchDetector: BranchDetector,
    private branchColorResolver: BranchColorResolver,
    private showWarning: (msg: string) => void = (msg) =>
      vscode.window.showWarningMessage(msg)
  ) {}

  async run(
    workspacePath: string | undefined,
    options?: OrchestratorOptions
  ): Promise<AssignmentResult> {
    try {
      // 1. No workspace → skip
      if (!workspacePath) {
        return { status: 'skipped', reason: 'no-workspace' };
      }

      // 2. Read existing settings
      const settings = await this.settingsManager.read(workspacePath);

      // 3. Determine strategy
      const strategy = this.config.getColorStrategy();

      // 4. Get parent directory (used by both paths for neighbor scanning)
      const parentDir = path.dirname(workspacePath);

      let result: { color: string; warning?: 'palette-exhausted' };

      if (strategy === 'project') {
        // ── "project" path (unchanged behavior) ──────────────────────────────

        // Idempotency check: skip if any statusBar.background already set
        if (options?.force !== true && this.settingsManager.hasStatusBarBackground(settings)) {
          return { status: 'skipped', reason: 'already-assigned' };
        }

        // Scan neighbors for occupied colors
        const occupiedColors = await this.scanner.scan(parentDir, workspacePath);

        // Get palette
        const palette = this.config.getColorPalette();

        // Assign color using workspace path as hash input
        result = this.assigner.assign(workspacePath, occupiedColors, palette, options?.offset);

      } else {
        // ── "branch" path ─────────────────────────────────────────────────────

        // Detect current branch
        const branchName = await this.branchDetector.detect(workspacePath);
        if (branchName === null) {
          return { status: 'skipped', reason: 'no-branch' };
        }

        // Scan neighbors for occupied colors
        const occupiedColors = await this.scanner.scan(parentDir, workspacePath);

        // Get palette and branch color map
        const palette = this.config.getColorPalette();
        const branchColorMap = this.config.getBranchColors();

        // Resolve color via BranchColorResolver
        const branchResult = this.branchColorResolver.resolve(
          branchName,
          branchColorMap,
          occupiedColors,
          palette,
          options?.offset
        );

        // Null color means unnamed branch — handle based on whether this is a reassign
        if (branchResult.color === null) {
          // When offset > 0 (user-initiated reassign), the branch has no mapping — skip with info
          if (options?.offset !== undefined && options.offset > 0) {
            return { status: 'skipped', reason: 'no-branch-mapping' };
          }
          // offset = 0 or not provided (automatic assignment) — clear extension-managed keys
          const clearResult = await this.settingsManager.clear(workspacePath);
          if (!clearResult.removed) {
            return { status: 'skipped', reason: 'already-cleared' };
          }
          return { status: 'cleared' };
        }

        result = branchResult;

        // Idempotency check: compare resolved color against existing statusBar.background
        if (options?.force !== true) {
          const colorCustomizations = settings?.['workbench.colorCustomizations'] as Record<string, string> | undefined;
          const existingBg = colorCustomizations?.['statusBar.background'];
          if (existingBg === result.color) {
            return { status: 'skipped', reason: 'already-assigned' };
          }
        }
      }

      // ── Shared tail ───────────────────────────────────────────────────────

      // Warn if palette exhausted
      if (result.warning === 'palette-exhausted') {
        this.showWarning(
          'Statusbar Colorizer: All palette colors are occupied by neighboring projects. ' +
            `Assigned fallback color: ${result.color}`
        );
      }

      // Get foreground color
      const foregroundColor = this.contrastChecker.getForeground(result.color);

      // Write settings — include status bar and/or title bar colors based on config
      const statusBarEnabled = this.config.colorStatusBar();
      const titleBarEnabled = this.config.colorTitleBar();
      await this.settingsManager.write(
        workspacePath,
        statusBarEnabled ? result.color : undefined,
        statusBarEnabled ? foregroundColor : undefined,
        titleBarEnabled ? result.color : undefined,
        titleBarEnabled ? foregroundColor : undefined
      );

      // Return success
      return {
        status: 'assigned',
        backgroundColor: result.color,
        foregroundColor,
      };
    } catch (error: unknown) {
      // Catch all errors
      const message =
        error instanceof Error ? error.message : String(error);
      return { status: 'error', message };
    }
  }
}
