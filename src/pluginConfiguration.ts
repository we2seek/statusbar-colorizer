import * as vscode from 'vscode';
import { BUILT_IN_PALETTE } from './palette';

export interface PluginConfiguration {
  getColorPalette(): string[];
  colorStatusBar(): boolean;
  colorTitleBar(): boolean;
}

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class VscodePluginConfiguration implements PluginConfiguration {
  private readonly showError: (msg: string) => void;
  private readonly getConfig: () => string[] | undefined;
  private readonly getColorStatusBarConfig: () => boolean | undefined;
  private readonly getColorTitleBarConfig: () => boolean | undefined;

  constructor(
    showError?: (msg: string) => void,
    getConfig?: () => string[] | undefined,
    getColorStatusBarConfig?: () => boolean | undefined,
    getColorTitleBarConfig?: () => boolean | undefined
  ) {
    this.showError =
      showError ?? ((msg: string) => vscode.window.showErrorMessage(msg));
    this.getConfig =
      getConfig ??
      (() =>
        vscode.workspace
          .getConfiguration('statusbarColorizer')
          .get<string[]>('colorPalette'));
    this.getColorStatusBarConfig =
      getColorStatusBarConfig ??
      (() =>
        vscode.workspace
          .getConfiguration('statusbarColorizer')
          .get<boolean>('colorStatusBar'));
    this.getColorTitleBarConfig =
      getColorTitleBarConfig ??
      (() =>
        vscode.workspace
          .getConfiguration('statusbarColorizer')
          .get<boolean>('colorTitleBar'));
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

  colorStatusBar(): boolean {
    const value = this.getColorStatusBarConfig();
    // Default true when not set
    return value !== false;
  }

  colorTitleBar(): boolean {
    const value = this.getColorTitleBarConfig();
    // Default false when not set
    return value === true;
  }
}
