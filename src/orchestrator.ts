import * as path from 'path';
import * as vscode from 'vscode';
import { NeighborScanner } from './neighborScanner';
import { ColorAssigner } from './colorAssigner';
import { ContrastChecker } from './contrastChecker';
import { SettingsFileManager } from './settingsFileManager';
import { PluginConfiguration } from './pluginConfiguration';

export interface OrchestratorOptions {
  force?: boolean;
  offset?: number;
}

export type AssignmentResult =
  | { status: 'skipped'; reason: 'no-workspace' | 'already-assigned' }
  | { status: 'assigned'; backgroundColor: string; foregroundColor: string }
  | { status: 'error'; message: string };

export class ColorAssignmentOrchestrator {
  constructor(
    private scanner: NeighborScanner,
    private assigner: ColorAssigner,
    private contrastChecker: ContrastChecker,
    private settingsManager: SettingsFileManager,
    private config: PluginConfiguration,
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

      // 3. Idempotency check (skip if color already assigned and not forcing)
      if (options?.force !== true && this.settingsManager.hasStatusBarBackground(settings)) {
        return { status: 'skipped', reason: 'already-assigned' };
      }

      // 4. Get parent directory
      const parentDir = path.dirname(workspacePath);

      // 5. Scan neighbors for occupied colors
      const occupiedColors = await this.scanner.scan(parentDir, workspacePath);

      // 6. Get palette
      const palette = this.config.getColorPalette();

      // 7. Assign color
      const result = this.assigner.assign(workspacePath, occupiedColors, palette, options?.offset);

      // 8. Warn if palette exhausted
      if (result.warning === 'palette-exhausted') {
        this.showWarning(
          'Statusbar Colorizer: All palette colors are occupied by neighboring projects. ' +
            `Assigned fallback color: ${result.color}`
        );
      }

      // 9. Get foreground color
      const foregroundColor = this.contrastChecker.getForeground(result.color);

      // 10. Write settings — include title bar colors if enabled
      const titleBarEnabled = this.config.colorTitleBar();
      await this.settingsManager.write(
        workspacePath,
        result.color,
        foregroundColor,
        titleBarEnabled ? result.color : undefined,
        titleBarEnabled ? foregroundColor : undefined
      );

      // 11. Return success
      return {
        status: 'assigned',
        backgroundColor: result.color,
        foregroundColor,
      };
    } catch (error: unknown) {
      // 12. Catch all errors
      const message =
        error instanceof Error ? error.message : String(error);
      return { status: 'error', message };
    }
  }
}
