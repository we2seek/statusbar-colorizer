import * as vscode from 'vscode';
import { BUILT_IN_PALETTE } from './palette';

export const BUILT_IN_BRANCH_COLORS: Record<string, string> = {
  main:    '#1A3A5C',
  master:  '#1A3A5C',
  develop: '#3A1A5C',
};

export interface PluginConfiguration {
  getColorPalette(): string[];
  colorStatusBar(): boolean;
  colorTitleBar(): boolean;
  getColorStrategy(): 'project' | 'branch';
  getBranchColors(): Record<string, string>;
}

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class VscodePluginConfiguration implements PluginConfiguration {
  private readonly showError: (msg: string) => void;
  private readonly getConfig: () => string[] | undefined;
  private readonly getColorStatusBarConfig: () => boolean | undefined;
  private readonly getColorTitleBarConfig: () => boolean | undefined;
  private readonly getColorStrategyConfig: () => string | undefined;
  private readonly getBranchColorsConfig: () => Record<string, string> | undefined;

  constructor(
    showError?: (msg: string) => void,
    getConfig?: () => string[] | undefined,
    getColorStatusBarConfig?: () => boolean | undefined,
    getColorTitleBarConfig?: () => boolean | undefined,
    getColorStrategyConfig?: () => string | undefined,
    getBranchColorsConfig?: () => Record<string, string> | undefined
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
    this.getColorStrategyConfig =
      getColorStrategyConfig ??
      (() =>
        vscode.workspace
          .getConfiguration('statusbarColorizer')
          .get<string>('colorStrategy'));
    this.getBranchColorsConfig =
      getBranchColorsConfig ??
      (() =>
        vscode.workspace
          .getConfiguration('statusbarColorizer')
          .get<Record<string, string>>('branchColors'));
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

  getColorStrategy(): 'project' | 'branch' {
    const value = this.getColorStrategyConfig();

    // Unset / null / undefined → default to "branch"
    if (value === undefined || value === null) {
      return 'branch';
    }

    if (value === 'project' || value === 'branch') {
      return value;
    }

    // Invalid value → show error and fall back to "branch"
    this.showError(value);
    return 'branch';
  }

  getBranchColors(): Record<string, string> {
    const userMap = this.getBranchColorsConfig();

    // Unset or empty → return built-in defaults, no validation
    if (!userMap || Object.keys(userMap).length === 0) {
      return { ...BUILT_IN_BRANCH_COLORS };
    }

    let hasViolation = false;

    // Validate keys: no empty string keys
    for (const key of Object.keys(userMap)) {
      if (key === '') {
        this.showError(key);
        hasViolation = true;
      }
    }

    // Validate values: each must be a valid #RRGGBB hex color
    for (const [, value] of Object.entries(userMap)) {
      if (!HEX_COLOR_REGEX.test(value)) {
        this.showError(value);
        hasViolation = true;
      }
    }

    // Any violation → return built-in defaults
    if (hasViolation) {
      return { ...BUILT_IN_BRANCH_COLORS };
    }

    // Valid non-empty map → merge user entries over built-in defaults
    return { ...BUILT_IN_BRANCH_COLORS, ...userMap };
  }
}
