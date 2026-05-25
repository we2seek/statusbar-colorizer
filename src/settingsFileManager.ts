import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export type SettingsObject = Record<string, unknown>;

export type ClearResult =
  | { removed: true }
  | { removed: false };

export interface SettingsFileManager {
  read(projectPath: string): Promise<SettingsObject | null>;
  write(projectPath: string, statusBarBg?: string, statusBarFg?: string, titleBarBg?: string, titleBarFg?: string): Promise<void>;
  hasStatusBarBackground(settings: SettingsObject | null): boolean;
  clear(projectPath: string): Promise<ClearResult>;
}

export class DefaultSettingsFileManager implements SettingsFileManager {
  private readonly showError: (message: string) => void;

  constructor(
    showError: (message: string) => void = (msg) =>
      vscode.window.showErrorMessage(msg)
  ) {
    this.showError = showError;
  }

  /**
   * Reads `.vscode/settings.json` inside `projectPath`.
   * - Returns `null` if the file doesn't exist (ENOENT) — wait, per spec: ENOENT → return `null`
   *   Actually per task spec: "If file doesn't exist (ENOENT) → return null"
   *   But per requirements 2.4: "IF Settings_File не існує, THE Plugin SHALL вважати поле відсутнім"
   *   and design says: "Якщо файл не існує → SettingsObject = {}"
   *   The task description says ENOENT → return null, but write() uses null to mean "invalid JSON".
   *   Re-reading task: "If file doesn't exist (ENOENT) → return null" — we follow the task spec.
   *   Note: write() handles null from read() by throwing (invalid JSON case).
   *   But write() also says "Read existing settings (or use {} if file doesn't exist)".
   *   So write() calls read() and if ENOENT it should use {}, not throw.
   *   Resolution: read() returns null for ENOENT, and write() distinguishes by catching ENOENT itself,
   *   OR read() returns {} for ENOENT and null only for invalid JSON.
   *
   * Re-reading the task more carefully:
   *   read(): ENOENT → return null; empty file → return {}; invalid JSON → showError + return null
   *   write(): "Read existing settings (or use {} if file doesn't exist)"
   *            "If read returns null (invalid JSON) → throw error, don't write"
   *
   * So write() must distinguish between "file not found" (use {}) and "invalid JSON" (throw).
   * But read() returns null for both ENOENT and invalid JSON per the task spec.
   *
   * The cleanest solution: read() returns null for ENOENT too (as specified), and write()
   * calls fs.readFile directly to handle ENOENT separately, OR we use a sentinel.
   *
   * Actually re-reading: "If file doesn't exist (ENOENT) → return null" — this is the task spec.
   * But write() says "or use {} if file doesn't exist". This means write() handles ENOENT itself
   * by catching it, rather than relying on read()'s return value.
   *
   * Implementation: write() calls read() but also catches ENOENT at the fs level.
   * Simplest: write() uses its own internal read that returns {} on ENOENT.
   */
  async read(projectPath: string): Promise<SettingsObject | null> {
    const settingsPath = path.join(projectPath, '.vscode', 'settings.json');
    let raw: string;
    try {
      raw = await fs.readFile(settingsPath, 'utf-8');
    } catch (err: unknown) {
      if (isEnoent(err)) {
        return null;
      }
      // Other read errors
      this.showError(`Failed to read settings file: ${settingsPath}`);
      return null;
    }

    // Empty file → treat as {}
    if (raw.trim() === '') {
      return {};
    }

    try {
      return JSON.parse(raw) as SettingsObject;
    } catch {
      this.showError(`Invalid JSON in settings file: ${settingsPath}`);
      return null;
    }
  }

  /**
   * Returns true if `settings` is not null and contains
   * `workbench.colorCustomizations.statusBar.background`.
   */
  hasStatusBarBackground(settings: SettingsObject | null): boolean {
    if (settings === null) {
      return false;
    }
    const colorCustomizations = settings['workbench.colorCustomizations'];
    if (
      colorCustomizations === null ||
      typeof colorCustomizations !== 'object' ||
      Array.isArray(colorCustomizations)
    ) {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(
      colorCustomizations,
      'statusBar.background'
    );
  }

  /**
   * Writes color keys into `.vscode/settings.json` inside `projectPath`,
   * preserving all existing fields. Status bar and title bar colors are
   * each optional — pass undefined to skip writing those keys.
   */
  async write(projectPath: string, statusBarBg?: string, statusBarFg?: string, titleBarBg?: string, titleBarFg?: string): Promise<void> {
    const settingsPath = path.join(projectPath, '.vscode', 'settings.json');
    const vscodePath = path.join(projectPath, '.vscode');

    // Read existing settings, treating ENOENT as {}
    let settings: SettingsObject;
    const existing = await this.readForWrite(settingsPath);
    if (existing === null) {
      // Invalid JSON — don't write
      throw new Error(`Cannot write settings: invalid JSON in ${settingsPath}`);
    }
    settings = existing;

    // Merge colorCustomizations, preserving existing nested keys
    const existingCustomizations = settings['workbench.colorCustomizations'];
    const colorCustomizations: Record<string, unknown> =
      existingCustomizations !== null &&
      typeof existingCustomizations === 'object' &&
      !Array.isArray(existingCustomizations)
        ? { ...(existingCustomizations as Record<string, unknown>) }
        : {};

    if (statusBarBg !== undefined) {
      colorCustomizations['statusBar.background'] = statusBarBg;
    } else {
      delete colorCustomizations['statusBar.background'];
    }
    if (statusBarFg !== undefined) {
      colorCustomizations['statusBar.foreground'] = statusBarFg;
    } else {
      delete colorCustomizations['statusBar.foreground'];
    }
    if (titleBarBg !== undefined) {
      colorCustomizations['titleBar.activeBackground'] = titleBarBg;
    } else {
      delete colorCustomizations['titleBar.activeBackground'];
    }
    if (titleBarFg !== undefined) {
      colorCustomizations['titleBar.activeForeground'] = titleBarFg;
    } else {
      delete colorCustomizations['titleBar.activeForeground'];
    }

    settings = { ...settings, 'workbench.colorCustomizations': colorCustomizations };

    // Ensure .vscode/ directory exists
    await fs.mkdir(vscodePath, { recursive: true });

    // Write with 2-space indentation
    const content = JSON.stringify(settings, null, 2);
    try {
      await fs.writeFile(settingsPath, content, 'utf-8');
    } catch (err: unknown) {
      this.showError(`Failed to write settings file: ${settingsPath}`);
      throw err;
    }
  }

  /**
   * Removes the four extension-managed color keys from `workbench.colorCustomizations`
   * in `.vscode/settings.json`. If `workbench.colorCustomizations` becomes empty,
   * removes the key entirely. Returns `{ removed: true }` if any key was removed,
   * `{ removed: false }` if none were present.
   *
   * Implemented in task 2.x.
   */
  async clear(projectPath: string): Promise<ClearResult> {
    const settingsPath = path.join(projectPath, '.vscode', 'settings.json');

    const existing = await this.readForWrite(settingsPath);
    if (existing === null) {
      this.showError(`Cannot clear settings: invalid JSON in ${settingsPath}`);
      throw new Error(`Cannot clear settings: invalid JSON in ${settingsPath}`);
    }

    const managedKeys = [
      'statusBar.background',
      'statusBar.foreground',
      'titleBar.activeBackground',
      'titleBar.activeForeground',
    ] as const;

    const existingCustomizations = existing['workbench.colorCustomizations'];
    if (
      existingCustomizations === null ||
      typeof existingCustomizations !== 'object' ||
      Array.isArray(existingCustomizations)
    ) {
      return { removed: false };
    }

    const colorCustomizations = existingCustomizations as Record<string, unknown>;
    const hadAny = managedKeys.some(k => Object.prototype.hasOwnProperty.call(colorCustomizations, k));
    if (!hadAny) {
      return { removed: false };
    }

    // Remove managed keys
    const updated = { ...colorCustomizations };
    for (const k of managedKeys) {
      delete updated[k];
    }

    let settings: SettingsObject;
    if (Object.keys(updated).length === 0) {
      // Remove workbench.colorCustomizations entirely
      const { 'workbench.colorCustomizations': _removed, ...rest } = existing;
      settings = rest;
    } else {
      settings = { ...existing, 'workbench.colorCustomizations': updated };
    }

    const vscodePath = path.join(projectPath, '.vscode');
    await fs.mkdir(vscodePath, { recursive: true });
    const content = JSON.stringify(settings, null, 2);
    try {
      await fs.writeFile(settingsPath, content, 'utf-8');
    } catch (err: unknown) {
      this.showError(`Failed to write settings file: ${settingsPath}`);
      throw err;
    }

    return { removed: true };
  }

  /**
   * Internal helper: reads the settings file for write purposes.
   * Returns {} on ENOENT, null on invalid JSON, SettingsObject otherwise.
   */
  private async readForWrite(settingsPath: string): Promise<SettingsObject | null> {
    let raw: string;
    try {
      raw = await fs.readFile(settingsPath, 'utf-8');
    } catch (err: unknown) {
      if (isEnoent(err)) {
        return {};
      }
      this.showError(`Failed to read settings file: ${settingsPath}`);
      return null;
    }

    if (raw.trim() === '') {
      return {};
    }

    try {
      return JSON.parse(raw) as SettingsObject;
    } catch {
      this.showError(`Invalid JSON in settings file: ${settingsPath}`);
      return null;
    }
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
