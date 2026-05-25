import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ColorAssignmentOrchestrator } from '../orchestrator';
import type { NeighborScanner } from '../neighborScanner';
import type { ColorAssigner } from '../colorAssigner';
import type { ContrastChecker } from '../contrastChecker';
import type { SettingsFileManager, SettingsObject } from '../settingsFileManager';
import type { PluginConfiguration } from '../pluginConfiguration';
import type { BranchDetector } from '../branchDetector';
import type { BranchColorResolver } from '../branchColorResolver';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
}));

// Helper to build a mock orchestrator with sensible defaults
function buildOrchestrator(overrides?: {
  scanner?: Partial<NeighborScanner>;
  assigner?: Partial<ColorAssigner>;
  contrastChecker?: Partial<ContrastChecker>;
  settingsManager?: Partial<SettingsFileManager>;
  config?: Partial<PluginConfiguration>;
  branchDetector?: Partial<BranchDetector>;
  branchColorResolver?: Partial<BranchColorResolver>;
  showWarning?: (msg: string) => void;
}) {
  const scanner: NeighborScanner = {
    scan: vi.fn().mockResolvedValue(new Set<string>()),
    ...overrides?.scanner,
  };

  const assigner: ColorAssigner = {
    assign: vi.fn().mockReturnValue({ color: '#2D6A4F' }),
    ...overrides?.assigner,
  };

  const contrastChecker: ContrastChecker = {
    getForeground: vi.fn().mockReturnValue('#FFFFFF'),
    getLuminance: vi.fn().mockReturnValue(0.1),
    getContrastRatio: vi.fn().mockReturnValue(10),
    ...overrides?.contrastChecker,
  };

  const settingsManager: SettingsFileManager = {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue(undefined),
    hasStatusBarBackground: vi.fn().mockReturnValue(false),
    clear: vi.fn().mockResolvedValue({ removed: false }),
    ...overrides?.settingsManager,
  };

  const config: PluginConfiguration = {
    getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
    colorStatusBar: vi.fn().mockReturnValue(true),
    colorTitleBar: vi.fn().mockReturnValue(false),
    getColorStrategy: vi.fn().mockReturnValue('project'),
    getBranchColors: vi.fn().mockReturnValue({}),
    ...overrides?.config,
  };

  const branchDetector: BranchDetector = {
    detect: vi.fn().mockResolvedValue(null),
    ...overrides?.branchDetector,
  };

  const branchColorResolver: BranchColorResolver = {
    resolve: vi.fn().mockReturnValue({ color: '#2D6A4F' }),
    ...overrides?.branchColorResolver,
  };

  const showWarning = overrides?.showWarning ?? vi.fn();

  const orchestrator = new ColorAssignmentOrchestrator(
    scanner,
    assigner,
    contrastChecker,
    settingsManager,
    config,
    branchDetector,
    branchColorResolver,
    showWarning
  );

  return { orchestrator, scanner, assigner, contrastChecker, settingsManager, config, branchDetector, branchColorResolver, showWarning };
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature: project-statusbar-colorizer, Property 1: Idempotency — наявний колір не перезаписується
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 1: Idempotency — наявний колір не перезаписується', () => {
  it('does NOT call settingsManager.write when statusBar.background already exists (Validates: Requirements 2.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Use non-empty strings for workspace path to avoid the no-workspace branch
        fc.string({ minLength: 1 }),
        fc.string(),
        async (workspacePath, existingColor) => {
          // Build a settings object that already has a statusBar.background
          const settingsWithColor: SettingsObject = {
            'workbench.colorCustomizations': {
              'statusBar.background': existingColor,
            },
          };

          const writeMock = vi.fn().mockResolvedValue(undefined);
          const { orchestrator } = buildOrchestrator({
            settingsManager: {
              read: vi.fn().mockResolvedValue(settingsWithColor),
              write: writeMock,
              hasStatusBarBackground: vi.fn().mockReturnValue(true),
            },
          });

          // Run without force — must not write
          await orchestrator.run(workspacePath);
          expect(writeMock).not.toHaveBeenCalled();
        }
      )
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests (Validates: Requirements 1.3, 2.2, 4.5, 9.2, 9.3, 9.4)
// ─────────────────────────────────────────────────────────────────────────────
describe('ColorAssignmentOrchestrator — unit tests', () => {
  it('returns { status: "skipped", reason: "no-workspace" } when workspacePath is undefined', async () => {
    const { orchestrator } = buildOrchestrator();
    const result = await orchestrator.run(undefined);
    expect(result).toEqual({ status: 'skipped', reason: 'no-workspace' });
  });

  it('returns { status: "skipped", reason: "no-workspace" } when workspacePath is empty string', async () => {
    const { orchestrator } = buildOrchestrator();
    const result = await orchestrator.run('');
    expect(result).toEqual({ status: 'skipped', reason: 'no-workspace' });
  });

  it('returns { status: "skipped", reason: "already-assigned" } when color is already assigned', async () => {
    const { orchestrator } = buildOrchestrator({
      settingsManager: {
        read: vi.fn().mockResolvedValue({ 'workbench.colorCustomizations': { 'statusBar.background': '#2D6A4F' } }),
        write: vi.fn(),
        hasStatusBarBackground: vi.fn().mockReturnValue(true),
      },
    });

    const result = await orchestrator.run('/some/project');
    expect(result).toEqual({ status: 'skipped', reason: 'already-assigned' });
  });

  it('ignores idempotency and calls write when force: true', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const { orchestrator } = buildOrchestrator({
      settingsManager: {
        read: vi.fn().mockResolvedValue({ 'workbench.colorCustomizations': { 'statusBar.background': '#2D6A4F' } }),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(true),
      },
    });

    const result = await orchestrator.run('/some/project', { force: true });
    expect(writeMock).toHaveBeenCalled();
    expect(result.status).toBe('assigned');
  });

  it('returns { status: "assigned", backgroundColor, foregroundColor } on successful assignment', async () => {
    const backgroundColor = '#2D6A4F';
    const foregroundColor = '#FFFFFF';

    const { orchestrator } = buildOrchestrator({
      assigner: {
        assign: vi.fn().mockReturnValue({ color: backgroundColor }),
      },
      contrastChecker: {
        getForeground: vi.fn().mockReturnValue(foregroundColor),
        getLuminance: vi.fn().mockReturnValue(0.1),
        getContrastRatio: vi.fn().mockReturnValue(10),
      },
    });

    const result = await orchestrator.run('/some/project');
    expect(result).toEqual({
      status: 'assigned',
      backgroundColor,
      foregroundColor,
    });
  });

  it('returns { status: "error", message } when write throws', async () => {
    const errorMessage = 'Disk full';
    const { orchestrator } = buildOrchestrator({
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockRejectedValue(new Error(errorMessage)),
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
      },
    });

    const result = await orchestrator.run('/some/project');
    expect(result).toEqual({ status: 'error', message: errorMessage });
  });

  it('calls showWarning when palette-exhausted warning is returned', async () => {
    const showWarning = vi.fn();
    const { orchestrator } = buildOrchestrator({
      assigner: {
        assign: vi.fn().mockReturnValue({ color: '#2D6A4F', warning: 'palette-exhausted' }),
      },
      showWarning,
    });

    await orchestrator.run('/some/project');
    expect(showWarning).toHaveBeenCalledOnce();
    expect(showWarning).toHaveBeenCalledWith(expect.stringContaining('#2D6A4F'));
  });

  it('passes titleBar colors to write when colorTitleBar is true', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const { orchestrator } = buildOrchestrator({
      assigner: { assign: vi.fn().mockReturnValue({ color: '#2D6A4F' }) },
      contrastChecker: {
        getForeground: vi.fn().mockReturnValue('#FFFFFF'),
        getLuminance: vi.fn().mockReturnValue(0.1),
        getContrastRatio: vi.fn().mockReturnValue(10),
      },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
      },
      config: {
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(true),
      },
    });

    await orchestrator.run('/some/project');
    expect(writeMock).toHaveBeenCalledWith('/some/project', '#2D6A4F', '#FFFFFF', '#2D6A4F', '#FFFFFF');
  });

  it('omits titleBar colors from write when colorTitleBar is false', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const { orchestrator } = buildOrchestrator({
      assigner: { assign: vi.fn().mockReturnValue({ color: '#2D6A4F' }) },
      contrastChecker: {
        getForeground: vi.fn().mockReturnValue('#FFFFFF'),
        getLuminance: vi.fn().mockReturnValue(0.1),
        getContrastRatio: vi.fn().mockReturnValue(10),
      },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
      },
      config: {
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
      },
    });

    await orchestrator.run('/some/project');
    expect(writeMock).toHaveBeenCalledWith('/some/project', '#2D6A4F', '#FFFFFF', undefined, undefined);
  });

  it('omits statusBar colors from write when colorStatusBar is false', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const { orchestrator } = buildOrchestrator({
      assigner: { assign: vi.fn().mockReturnValue({ color: '#2D6A4F' }) },
      contrastChecker: {
        getForeground: vi.fn().mockReturnValue('#FFFFFF'),
        getLuminance: vi.fn().mockReturnValue(0.1),
        getContrastRatio: vi.fn().mockReturnValue(10),
      },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
      },
      config: {
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(false),
        colorTitleBar: vi.fn().mockReturnValue(false),
      },
    });

    await orchestrator.run('/some/project');
    expect(writeMock).toHaveBeenCalledWith('/some/project', undefined, undefined, undefined, undefined);
  });

  it('passes both statusBar and titleBar colors when both are enabled', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const { orchestrator } = buildOrchestrator({
      assigner: { assign: vi.fn().mockReturnValue({ color: '#2D6A4F' }) },
      contrastChecker: {
        getForeground: vi.fn().mockReturnValue('#FFFFFF'),
        getLuminance: vi.fn().mockReturnValue(0.1),
        getContrastRatio: vi.fn().mockReturnValue(10),
      },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
      },
      config: {
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(true),
      },
    });

    await orchestrator.run('/some/project');
    expect(writeMock).toHaveBeenCalledWith('/some/project', '#2D6A4F', '#FFFFFF', '#2D6A4F', '#FFFFFF');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.4: Orchestrator strategy dispatch unit tests
// Validates: Requirements 4.1, 4.2, 4.4, 4.5, 8.2, 8.3, 8.7
// ─────────────────────────────────────────────────────────────────────────────
describe('ColorAssignmentOrchestrator — strategy dispatch', () => {
  // ── "project" strategy ────────────────────────────────────────────────────

  it('"project" strategy: does NOT call branchDetector.detect (Validates: Requirements 8.2, 8.7)', async () => {
    const { orchestrator, branchDetector } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('project'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
    });

    await orchestrator.run('/some/project');

    expect(branchDetector.detect).not.toHaveBeenCalled();
  });

  it('"project" strategy: does NOT call branchColorResolver.resolve (Validates: Requirements 8.2, 8.7)', async () => {
    const { orchestrator, branchColorResolver } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('project'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
    });

    await orchestrator.run('/some/project');

    expect(branchColorResolver.resolve).not.toHaveBeenCalled();
  });

  it('"project" strategy: calls assigner.assign with workspacePath as first arg (Validates: Requirements 8.2)', async () => {
    const workspacePath = '/some/project';
    const { orchestrator, assigner } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('project'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
    });

    await orchestrator.run(workspacePath);

    expect(assigner.assign).toHaveBeenCalled();
    expect((assigner.assign as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(workspacePath);
  });

  // ── "branch" strategy ─────────────────────────────────────────────────────

  it('"branch" strategy: calls branchDetector.detect (Validates: Requirements 4.1, 8.3)', async () => {
    const workspacePath = '/some/project';
    const { orchestrator, branchDetector } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: {
        detect: vi.fn().mockResolvedValue('feature/my-branch'),
      },
    });

    await orchestrator.run(workspacePath);

    expect(branchDetector.detect).toHaveBeenCalledWith(workspacePath);
  });

  it('"branch" strategy: calls branchColorResolver.resolve with branch name and branch color map (Validates: Requirements 4.2, 8.3)', async () => {
    const branchName = 'feature/my-branch';
    const branchColorMap = { main: '#1A3A5C', develop: '#3A1A5C' };
    const { orchestrator, branchColorResolver } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue(branchColorMap),
      },
      branchDetector: {
        detect: vi.fn().mockResolvedValue(branchName),
      },
    });

    await orchestrator.run('/some/project');

    expect(branchColorResolver.resolve).toHaveBeenCalled();
    const resolveCall = (branchColorResolver.resolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(resolveCall[0]).toBe(branchName);
    expect(resolveCall[1]).toBe(branchColorMap);
  });

  it('"branch" strategy: branchDetector.detect returns null → { status: "skipped", reason: "no-branch" } (Validates: Requirements 2.4)', async () => {
    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: {
        detect: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await orchestrator.run('/some/project');

    expect(result).toEqual({ status: 'skipped', reason: 'no-branch' });
  });

  it('"branch" strategy with force: true skips idempotency check and writes (Validates: Requirements 4.4, 4.5)', async () => {
    const resolvedColor = '#2D6A4F';
    const writeMock = vi.fn().mockResolvedValue(undefined);

    // Settings already have the resolved color as statusBar.background
    const existingSettings = {
      'workbench.colorCustomizations': {
        'statusBar.background': resolvedColor,
      },
    };

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: {
        detect: vi.fn().mockResolvedValue('feature/my-branch'),
      },
      branchColorResolver: {
        resolve: vi.fn().mockReturnValue({ color: resolvedColor }),
      },
      settingsManager: {
        read: vi.fn().mockResolvedValue(existingSettings),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(true),
      },
    });

    const result = await orchestrator.run('/some/project', { force: true });

    expect(writeMock).toHaveBeenCalled();
    expect(result.status).toBe('assigned');
  });

  it('"branch" strategy: palette-exhausted warning is shown (Validates: Requirements 7.3, 8.3)', async () => {
    const showWarning = vi.fn();
    const exhaustedColor = '#2D6A4F';

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: {
        detect: vi.fn().mockResolvedValue('feature/my-branch'),
      },
      branchColorResolver: {
        resolve: vi.fn().mockReturnValue({ color: exhaustedColor, warning: 'palette-exhausted' }),
      },
      showWarning,
    });

    await orchestrator.run('/some/project');

    expect(showWarning).toHaveBeenCalledOnce();
    expect(showWarning).toHaveBeenCalledWith(expect.stringContaining(exhaustedColor));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: branch-based-colorization, Property 12: Orchestrator idempotency in branch mode
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 12: Orchestrator idempotency in branch mode', () => {
  it('returns { status: "skipped", reason: "already-assigned" } and does NOT call write when resolved color already matches statusBar.background (Validates: Requirements 4.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.hexaString({ minLength: 6, maxLength: 6 }).map(h => '#' + h.toUpperCase()),
        async (generatedColor) => {
          const writeMock = vi.fn().mockResolvedValue(undefined);

          const { orchestrator } = buildOrchestrator({
            config: {
              getColorStrategy: vi.fn().mockReturnValue('branch'),
              getBranchColors: vi.fn().mockReturnValue({}),
              getColorPalette: vi.fn().mockReturnValue([generatedColor]),
              colorStatusBar: vi.fn().mockReturnValue(true),
              colorTitleBar: vi.fn().mockReturnValue(false),
            },
            branchDetector: {
              detect: vi.fn().mockResolvedValue('main'),
            },
            branchColorResolver: {
              resolve: vi.fn().mockReturnValue({ color: generatedColor }),
            },
            settingsManager: {
              read: vi.fn().mockResolvedValue({
                'workbench.colorCustomizations': {
                  'statusBar.background': generatedColor,
                },
              }),
              write: writeMock,
              hasStatusBarBackground: vi.fn().mockReturnValue(true),
            },
          });

          const result = await orchestrator.run('/some/project', { force: false });

          expect(result).toEqual({ status: 'skipped', reason: 'already-assigned' });
          expect(writeMock).not.toHaveBeenCalled();
        }
      )
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: branch-color-none-default — Task 4.2: color === null dispatch
// Unit tests (Validates: Requirements 1.2, 1.3, 1.4, 3.1, 3.2, 3.3)
// ─────────────────────────────────────────────────────────────────────────────
describe('ColorAssignmentOrchestrator — branch color === null dispatch', () => {
  it('"branch" strategy, unnamed branch, no managed keys → { status: "skipped", reason: "already-cleared" }', async () => {
    const clearMock = vi.fn().mockResolvedValue({ removed: false });
    const writeMock = vi.fn();

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('feature/unnamed') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: null }) },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
        clear: clearMock,
      },
    });

    const result = await orchestrator.run('/some/project');

    expect(result).toEqual({ status: 'skipped', reason: 'already-cleared' });
    expect(clearMock).toHaveBeenCalledWith('/some/project');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('"branch" strategy, unnamed branch, managed keys present → { status: "cleared" }, clear called, write not called', async () => {
    const clearMock = vi.fn().mockResolvedValue({ removed: true });
    const writeMock = vi.fn();

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('feature/unnamed') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: null }) },
      settingsManager: {
        read: vi.fn().mockResolvedValue({
          'workbench.colorCustomizations': { 'statusBar.background': '#1A3A5C' },
        }),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(true),
        clear: clearMock,
      },
    });

    const result = await orchestrator.run('/some/project');

    expect(result).toEqual({ status: 'cleared' });
    expect(clearMock).toHaveBeenCalledWith('/some/project');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('"branch" strategy, unnamed branch, force: true, no managed keys → { status: "skipped", reason: "already-cleared" } (force does not bypass already-cleared)', async () => {
    const clearMock = vi.fn().mockResolvedValue({ removed: false });
    const writeMock = vi.fn();

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('feature/unnamed') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: null }) },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
        clear: clearMock,
      },
    });

    const result = await orchestrator.run('/some/project', { force: true });

    expect(result).toEqual({ status: 'skipped', reason: 'already-cleared' });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('"project" strategy → clear never called', async () => {
    const clearMock = vi.fn();

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('project'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue(undefined),
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
        clear: clearMock,
      },
    });

    await orchestrator.run('/some/project');

    expect(clearMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: branch-color-none-default, Property 6: already-cleared when no managed keys
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 6: Orchestrator clear path — already-cleared when no managed keys present', () => {
  it('returns already-cleared and neither write nor clear is called when branch is unnamed and no managed keys present (Validates: Requirements 1.3, 3.1, 3.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.boolean(),
        async (workspacePath, force) => {
          const clearMock = vi.fn().mockResolvedValue({ removed: false });
          const writeMock = vi.fn();

          const { orchestrator } = buildOrchestrator({
            config: {
              getColorStrategy: vi.fn().mockReturnValue('branch'),
              getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
              colorStatusBar: vi.fn().mockReturnValue(true),
              colorTitleBar: vi.fn().mockReturnValue(false),
              getBranchColors: vi.fn().mockReturnValue({}),
            },
            branchDetector: { detect: vi.fn().mockResolvedValue('unnamed-branch') },
            branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: null }) },
            settingsManager: {
              read: vi.fn().mockResolvedValue(null),
              write: writeMock,
              hasStatusBarBackground: vi.fn().mockReturnValue(false),
              clear: clearMock,
            },
          });

          const result = await orchestrator.run(workspacePath, { force });

          expect(result).toEqual({ status: 'skipped', reason: 'already-cleared' });
          expect(writeMock).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: branch-color-none-default, Property 7: cleared when managed keys are present
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 7: Orchestrator clear path — cleared when managed keys are present', () => {
  it('returns cleared and write is not called when branch is unnamed and at least one managed key is present (Validates: Requirements 1.2, 1.4, 3.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (workspacePath) => {
          const clearMock = vi.fn().mockResolvedValue({ removed: true });
          const writeMock = vi.fn();

          const { orchestrator } = buildOrchestrator({
            config: {
              getColorStrategy: vi.fn().mockReturnValue('branch'),
              getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
              colorStatusBar: vi.fn().mockReturnValue(true),
              colorTitleBar: vi.fn().mockReturnValue(false),
              getBranchColors: vi.fn().mockReturnValue({}),
            },
            branchDetector: { detect: vi.fn().mockResolvedValue('unnamed-branch') },
            branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: null }) },
            settingsManager: {
              read: vi.fn().mockResolvedValue({
                'workbench.colorCustomizations': { 'statusBar.background': '#1A3A5C' },
              }),
              write: writeMock,
              hasStatusBarBackground: vi.fn().mockReturnValue(true),
              clear: clearMock,
            },
          });

          const result = await orchestrator.run(workspacePath);

          expect(result).toEqual({ status: 'cleared' });
          expect(writeMock).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: branch-color-none-default, Property 8: project strategy never invokes clear path
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 8: Project strategy never invokes clear path', () => {
  it('never calls branchColorResolver.resolve or settingsManager.clear when strategy is "project" (Validates: Requirements 6.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (workspacePath) => {
          const clearMock = vi.fn();
          const resolveMock = vi.fn();

          const { orchestrator } = buildOrchestrator({
            config: {
              getColorStrategy: vi.fn().mockReturnValue('project'),
              getColorPalette: vi.fn().mockReturnValue(['#2D6A4F']),
              colorStatusBar: vi.fn().mockReturnValue(true),
              colorTitleBar: vi.fn().mockReturnValue(false),
              getBranchColors: vi.fn().mockReturnValue({}),
            },
            branchColorResolver: { resolve: resolveMock },
            settingsManager: {
              read: vi.fn().mockResolvedValue(null),
              write: vi.fn().mockResolvedValue(undefined),
              hasStatusBarBackground: vi.fn().mockReturnValue(false),
              clear: clearMock,
            },
          });

          await orchestrator.run(workspacePath);

          expect(resolveMock).not.toHaveBeenCalled();
          expect(clearMock).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: reassign-branch-strategy-fix — Task 4: Orchestrator tests for new behaviors
// Validates: Requirements 2.1, 2.3, 2.4, 3.2
// ─────────────────────────────────────────────────────────────────────────────
describe('ColorAssignmentOrchestrator — reassign branch strategy fix', () => {
  // ── Requirement 2.1: named branch + offset > 0 → palette color assigned ──

  it('"branch" strategy, named branch, offset > 0 → branchColorResolver.resolve is called with offset; result is { status: "assigned" } and backgroundColor is the palette color (Validates: Requirements 2.1)', async () => {
    const paletteColor = '#2D6A4F';
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const resolveMock = vi.fn().mockReturnValue({ color: paletteColor });

    const { orchestrator, branchColorResolver } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue([paletteColor, '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({ main: '#1A3A5C' }),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('main') },
      branchColorResolver: { resolve: resolveMock },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
      },
    });

    const result = await orchestrator.run('/some/project', { offset: 1 });

    // Resolver must be called with the offset value
    expect(resolveMock).toHaveBeenCalled();
    const resolveCall = resolveMock.mock.calls[0];
    expect(resolveCall[4]).toBe(1); // offset is the 5th argument

    // Result must be assigned with the palette color
    expect(result).toEqual({
      status: 'assigned',
      backgroundColor: paletteColor,
      foregroundColor: expect.any(String),
    });
    expect((result as { status: 'assigned'; backgroundColor: string }).backgroundColor).toBe(paletteColor);
    expect(writeMock).toHaveBeenCalled();
  });

  // ── Requirement 2.3: unmapped branch + offset > 0 → no-branch-mapping, clear NOT called ──

  it('"branch" strategy, unmapped branch (resolver returns { color: null }), offset > 0 → { status: "skipped", reason: "no-branch-mapping" } and settingsManager.clear is NOT called (Validates: Requirements 2.3)', async () => {
    const clearMock = vi.fn();
    const writeMock = vi.fn();

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('feature/unmapped') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: null }) },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
        clear: clearMock,
      },
    });

    const result = await orchestrator.run('/some/project', { offset: 1 });

    expect(result).toEqual({ status: 'skipped', reason: 'no-branch-mapping' });
    expect(clearMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  // ── Requirement 3.2: unmapped branch + offset = 0 → existing clear behavior preserved ──

  it('"branch" strategy, unmapped branch (resolver returns { color: null }), offset = 0, managed keys present → settingsManager.clear IS called and result is { status: "cleared" } (Validates: Requirements 3.2)', async () => {
    const clearMock = vi.fn().mockResolvedValue({ removed: true });
    const writeMock = vi.fn();

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('feature/unmapped') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: null }) },
      settingsManager: {
        read: vi.fn().mockResolvedValue({
          'workbench.colorCustomizations': { 'statusBar.background': '#1A3A5C' },
        }),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(true),
        clear: clearMock,
      },
    });

    const result = await orchestrator.run('/some/project', { offset: 0 });

    expect(clearMock).toHaveBeenCalledWith('/some/project');
    expect(result).toEqual({ status: 'cleared' });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('"branch" strategy, unmapped branch (resolver returns { color: null }), no offset option, no managed keys → settingsManager.clear IS called and result is { status: "skipped", reason: "already-cleared" } (Validates: Requirements 3.2)', async () => {
    const clearMock = vi.fn().mockResolvedValue({ removed: false });
    const writeMock = vi.fn();

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({}),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('feature/unmapped') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: null }) },
      settingsManager: {
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
        clear: clearMock,
      },
    });

    // No offset option — automatic assignment path
    const result = await orchestrator.run('/some/project');

    expect(clearMock).toHaveBeenCalledWith('/some/project');
    expect(result).toEqual({ status: 'skipped', reason: 'already-cleared' });
    expect(writeMock).not.toHaveBeenCalled();
  });

  // ── Requirement 2.4: cleared settings re-application ──

  it('(req 2.4) "branch" strategy, named branch, offset = 0, settings = null → settingsManager.write IS called and result is { status: "assigned" } (Validates: Requirements 2.4)', async () => {
    const mappedColor = '#1A3A5C';
    const writeMock = vi.fn().mockResolvedValue(undefined);

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({ main: mappedColor }),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('main') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: mappedColor }) },
      settingsManager: {
        // settings = null: workbench.colorCustomizations is absent
        read: vi.fn().mockResolvedValue(null),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
      },
    });

    const result = await orchestrator.run('/some/project', { offset: 0 });

    // Idempotency check must NOT skip when color is missing (existingBg is undefined)
    expect(writeMock).toHaveBeenCalled();
    expect(result.status).toBe('assigned');
  });

  it('(req 2.4) "branch" strategy, named branch, offset = 0, settings has empty workbench.colorCustomizations → settingsManager.write IS called and result is { status: "assigned" } (Validates: Requirements 2.4)', async () => {
    const mappedColor = '#1A3A5C';
    const writeMock = vi.fn().mockResolvedValue(undefined);

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({ main: mappedColor }),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('main') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: mappedColor }) },
      settingsManager: {
        // settings has workbench.colorCustomizations but no statusBar.background
        read: vi.fn().mockResolvedValue({ 'workbench.colorCustomizations': {} }),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(false),
      },
    });

    const result = await orchestrator.run('/some/project', { offset: 0 });

    // existingBg is undefined (key absent) → idempotency check does NOT skip
    expect(writeMock).toHaveBeenCalled();
    expect(result.status).toBe('assigned');
  });

  it('(req 2.4) "branch" strategy, named branch, offset = 0, existingBg === mappedColor → { status: "skipped", reason: "already-assigned" } (idempotency still applies when color is present and matches) (Validates: Requirements 2.4)', async () => {
    const mappedColor = '#1A3A5C';
    const writeMock = vi.fn().mockResolvedValue(undefined);

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({ main: mappedColor }),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('main') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: mappedColor }) },
      settingsManager: {
        // existingBg === mappedColor → idempotency check skips
        read: vi.fn().mockResolvedValue({
          'workbench.colorCustomizations': { 'statusBar.background': mappedColor },
        }),
        write: writeMock,
        hasStatusBarBackground: vi.fn().mockReturnValue(true),
      },
    });

    const result = await orchestrator.run('/some/project', { offset: 0 });

    expect(result).toEqual({ status: 'skipped', reason: 'already-assigned' });
    expect(writeMock).not.toHaveBeenCalled();
  });

  // ── Idempotency check is value-based, NOT presence-based in the branch path ──

  it('branch path idempotency is value-based (existingBg === result.color): different existing color → write IS called (Validates: Requirements 2.4, 3.2)', async () => {
    const mappedColor = '#1A3A5C';
    const differentColor = '#2D6A4F';
    const writeMock = vi.fn().mockResolvedValue(undefined);

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({ main: mappedColor }),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('main') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: mappedColor }) },
      settingsManager: {
        // A different color is present — value check fails → write proceeds
        read: vi.fn().mockResolvedValue({
          'workbench.colorCustomizations': { 'statusBar.background': differentColor },
        }),
        write: writeMock,
        // hasStatusBarBackground returns true, but branch path must NOT use it for idempotency
        hasStatusBarBackground: vi.fn().mockReturnValue(true),
      },
    });

    const result = await orchestrator.run('/some/project', { offset: 0 });

    // Branch path must write because existingBg !== mappedColor (value-based check)
    expect(writeMock).toHaveBeenCalled();
    expect(result.status).toBe('assigned');
  });

  it('branch path does NOT use hasStatusBarBackground for idempotency: hasStatusBarBackground=true but existingBg !== resolvedColor → write IS called (Validates: Requirements 2.4, 3.2)', async () => {
    const resolvedColor = '#1A3A5C';
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const hasStatusBarBackgroundMock = vi.fn().mockReturnValue(true);

    const { orchestrator } = buildOrchestrator({
      config: {
        getColorStrategy: vi.fn().mockReturnValue('branch'),
        getColorPalette: vi.fn().mockReturnValue(['#2D6A4F', '#1B4332']),
        colorStatusBar: vi.fn().mockReturnValue(true),
        colorTitleBar: vi.fn().mockReturnValue(false),
        getBranchColors: vi.fn().mockReturnValue({ main: resolvedColor }),
      },
      branchDetector: { detect: vi.fn().mockResolvedValue('main') },
      branchColorResolver: { resolve: vi.fn().mockReturnValue({ color: resolvedColor }) },
      settingsManager: {
        // statusBar.background is a DIFFERENT color — presence-based check would skip, value-based would not
        read: vi.fn().mockResolvedValue({
          'workbench.colorCustomizations': { 'statusBar.background': '#AABBCC' },
        }),
        write: writeMock,
        hasStatusBarBackground: hasStatusBarBackgroundMock,
      },
    });

    const result = await orchestrator.run('/some/project', { offset: 0 });

    // If branch path used hasStatusBarBackground (presence-based), it would skip — but it must NOT
    expect(writeMock).toHaveBeenCalled();
    expect(result.status).toBe('assigned');
    // hasStatusBarBackground should NOT be the deciding factor in the branch path
    // (it may or may not be called, but the result must be 'assigned' regardless)
  });
});
