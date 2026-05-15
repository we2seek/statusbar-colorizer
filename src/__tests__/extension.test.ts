import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock vscode module (not available in test environment).
// vi.mock() is hoisted, so factories must NOT reference top-level variables.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  workspace: {
    workspaceFolders: undefined,
    onDidChangeWorkspaceFolders: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
  commands: {
    registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock all component constructors — we only care about orchestrator behavior
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../neighborScanner', () => ({
  DefaultNeighborScanner: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../colorAssigner', () => ({
  DefaultColorAssigner: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../contrastChecker', () => ({
  ContrastCheckerImpl: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../settingsFileManager', () => ({
  DefaultSettingsFileManager: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../pluginConfiguration', () => ({
  VscodePluginConfiguration: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../orchestrator', () => ({
  ColorAssignmentOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' }),
  })),
}));

// Import AFTER all mocks are set up
import { activate } from '../extension';
import * as vscode from 'vscode';
import { ColorAssignmentOrchestrator } from '../orchestrator';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a mock ExtensionContext
// ─────────────────────────────────────────────────────────────────────────────
function createMockContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: <T>(key: string) => store.get(key) as T | undefined,
      update: async (key: string, value: unknown) => { store.set(key, value); },
    },
  } as unknown as vscode.ExtensionContext;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to access the mocked vscode functions
// ─────────────────────────────────────────────────────────────────────────────
function getShowInformationMessage() {
  return vi.mocked(vscode.window.showInformationMessage);
}

function getShowErrorMessage() {
  return vi.mocked(vscode.window.showErrorMessage);
}

function getRegisterCommand() {
  return vi.mocked(vscode.commands.registerCommand);
}

function getOnDidChangeWorkspaceFolders() {
  return vi.mocked(vscode.workspace.onDidChangeWorkspaceFolders);
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for extension.ts (Validates: Requirements 9.1, 9.2, 9.3)
// ─────────────────────────────────────────────────────────────────────────────
describe('extension — activate()', () => {
  let mockRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset default return values after clearAllMocks
    getRegisterCommand().mockReturnValue({ dispose: vi.fn() });
    getOnDidChangeWorkspaceFolders().mockReturnValue({ dispose: vi.fn() });

    // Create a fresh mockRun for each test and wire it into the constructor mock
    mockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' });
    vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
      () => ({ run: mockRun }) as unknown as ColorAssignmentOrchestrator
    );
  });

  // ─── Test 1: activate calls orchestrator.run with the correct workspacePath ───
  it('calls orchestrator.run with the workspacePath from workspaceFolders[0]', () => {
    const expectedPath = '/home/user/my-project';

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: expectedPath } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    expect(mockRun).toHaveBeenCalledWith(expectedPath);
  });

  it('calls orchestrator.run with undefined when no workspace folders are open', () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: undefined,
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    expect(mockRun).toHaveBeenCalledWith(undefined);
  });

  // ─── Test 2: reassign command is registered and calls run with force: true ───
  it('registers the projectStatusbarColorizer.reassign command', () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/path' } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    expect(getRegisterCommand()).toHaveBeenCalledWith(
      'projectStatusbarColorizer.reassign',
      expect.any(Function)
    );
  });

  it('reassign command calls orchestrator.run with force: true', async () => {
    const workspacePath = '/some/project';
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: workspacePath } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    // Extract the registered command handler
    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'projectStatusbarColorizer.reassign');
    expect(reassignCall).toBeDefined();
    const commandHandler = reassignCall![1] as () => Promise<void>;

    // Clear previous calls from activate() itself, then set up for command invocation
    mockRun.mockClear();
    mockRun.mockResolvedValue({ status: 'skipped', reason: 'already-assigned' });

    await commandHandler();

    expect(mockRun).toHaveBeenCalledWith(workspacePath, { force: true, offset: 1 });
  });

  // ─── Test 3: showInformationMessage is called when reassign succeeds ───
  it('calls showInformationMessage when reassign returns status === "assigned"', async () => {
    const backgroundColor = '#2D6A4F';
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/project' } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'projectStatusbarColorizer.reassign');
    const commandHandler = reassignCall![1] as () => Promise<void>;

    mockRun.mockResolvedValue({
      status: 'assigned',
      backgroundColor,
      foregroundColor: '#FFFFFF',
    });

    await commandHandler();

    expect(getShowInformationMessage()).toHaveBeenCalledWith(
      expect.stringContaining(backgroundColor)
    );
  });

  it('does NOT call showInformationMessage when reassign returns status !== "assigned"', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/project' } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'projectStatusbarColorizer.reassign');
    const commandHandler = reassignCall![1] as () => Promise<void>;

    mockRun.mockResolvedValue({ status: 'skipped', reason: 'already-assigned' });

    await commandHandler();

    expect(getShowInformationMessage()).not.toHaveBeenCalled();
  });

  it('calls showErrorMessage when reassign returns status === "error"', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/project' } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'projectStatusbarColorizer.reassign');
    const commandHandler = reassignCall![1] as () => Promise<void>;

    mockRun.mockResolvedValue({ status: 'error', message: 'Something went wrong' });

    await commandHandler();

    expect(getShowErrorMessage()).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong')
    );
  });

  // ─── Test 4: subscriptions receive disposables ───
  it('pushes disposables to context.subscriptions', () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/project' } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    // Should have at least 2 subscriptions: folderChangeSubscription + reassignCommand
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(2);
  });
});
