import * as vscode from 'vscode';
import { BUILT_IN_PALETTE } from './palette';

export interface PluginConfiguration {
  getColorPalette(): string[];
}

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class VscodePluginConfiguration implements PluginConfiguration {
  private readonly showError: (msg: string) => void;
  private readonly getConfig: () => string[] | undefined;

  constructor(
    showError?: (msg: string) => void,
    getConfig?: () => string[] | undefined
  ) {
    this.showError =
      showError ?? ((msg: string) => vscode.window.showErrorMessage(msg));
    this.getConfig =
      getConfig ??
      (() =>
        vscode.workspace
          .getConfiguration('projectStatusbarColorizer')
          .get<string[]>('colorPalette'));
  }

  getColorPalette(): string[] {
    const palette = this.getConfig();

    // Not set or empty array → return built-in palette
    if (!palette || palette.length === 0) {
      return [...BUILT_IN_PALETTE];
    }

    // Validate each element
    for (const color of palette) {
      if (!HEX_COLOR_REGEX.test(color)) {
        this.showError(color);
        return [...BUILT_IN_PALETTE];
      }
    }

    return palette;
  }
}
