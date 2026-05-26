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
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    createFileSystemWatcher: vi.fn().mockReturnValue({
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    }),
  },
  commands: {
    registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
  RelativePattern: vi.fn().mockImplementation((base: string, pattern: string) => ({ base, pattern })),
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
  DefaultSettingsFileManager: vi.fn().mockImplementation(() => ({
    read: vi.fn().mockResolvedValue({ 'workbench.colorCustomizations': { 'statusBar.background': '#2D6A4F' } }),
    write: vi.fn().mockResolvedValue(undefined),
    hasStatusBarBackground: vi.fn().mockReturnValue(true),
    clear: vi.fn().mockResolvedValue({ removed: false }),
  })),
}));

vi.mock('../pluginConfiguration', () => ({
  VscodePluginConfiguration: vi.fn().mockImplementation(() => ({
    getColorStrategy: vi.fn().mockReturnValue(undefined),
    getColorPalette: vi.fn().mockReturnValue([]),
    colorStatusBar: vi.fn().mockReturnValue(true),
    colorTitleBar: vi.fn().mockReturnValue(false),
    getBranchColors: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock('../orchestrator', () => ({
  ColorAssignmentOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' }),
  })),
}));

vi.mock('../branchDetector', () => ({
  DefaultBranchDetector: vi.fn().mockImplementation(() => ({
    detect: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../branchColorResolver', () => ({
  DefaultBranchColorResolver: vi.fn().mockImplementation(() => ({})),
}));

// Import AFTER all mocks are set up
import { activate } from '../extension';
import * as vscode from 'vscode';
import * as fc from 'fast-check';
import { ColorAssignmentOrchestrator } from '../orchestrator';
import { DefaultBranchDetector } from '../branchDetector';
import { VscodePluginConfiguration } from '../pluginConfiguration';

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
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() } as unknown as vscode.Disposable);
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue({
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    } as unknown as vscode.FileSystemWatcher);

    // Create a fresh mockRun for each test and wire it into the constructor mock
    mockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' });
    vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
      () => ({ run: mockRun }) as unknown as ColorAssignmentOrchestrator
    );

    // Reset VscodePluginConfiguration to return undefined strategy (falls through to project/default path)
    vi.mocked(VscodePluginConfiguration).mockImplementation(() => ({
      getColorStrategy: vi.fn().mockReturnValue(undefined),
      getColorPalette: vi.fn().mockReturnValue([]),
      colorStatusBar: vi.fn().mockReturnValue(true),
      colorTitleBar: vi.fn().mockReturnValue(false),
      getBranchColors: vi.fn().mockReturnValue({}),
    }) as unknown as VscodePluginConfiguration);
  });

  // ─── Test 1: activate calls orchestrator.run with the correct workspacePath ───
  it('calls orchestrator.run with the workspacePath from workspaceFolders[0]', async () => {
    const expectedPath = '/home/user/my-project';

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: expectedPath } }],
      configurable: true,
    });

    const context = createMockContext();
    await activate(context);

    expect(mockRun).toHaveBeenCalledWith(expectedPath);
  });

  it('calls orchestrator.run with undefined when no workspace folders are open', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: undefined,
      configurable: true,
    });

    const context = createMockContext();
    await activate(context);

    expect(mockRun).toHaveBeenCalledWith(undefined);
  });

  // ─── Test 2: reassign command is registered and calls run with force: true ───
  it('registers the statusbarColorizer.reassign command', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/path' } }],
      configurable: true,
    });

    const context = createMockContext();
    await activate(context);

    expect(getRegisterCommand()).toHaveBeenCalledWith(
      'statusbarColorizer.reassign',
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
    await activate(context);

    // Extract the registered command handler
    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'statusbarColorizer.reassign');
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
    await activate(context);

    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'statusbarColorizer.reassign');
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
    await activate(context);

    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'statusbarColorizer.reassign');
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
    await activate(context);

    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'statusbarColorizer.reassign');
    const commandHandler = reassignCall![1] as () => Promise<void>;

    mockRun.mockResolvedValue({ status: 'error', message: 'Something went wrong' });

    await commandHandler();

    expect(getShowErrorMessage()).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong')
    );
  });

  // ─── Test: showInformationMessage for no-branch-mapping (Requirement 2.3) ───
  it('calls showInformationMessage when reassign returns status === "skipped" and reason === "no-branch-mapping"', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/project' } }],
      configurable: true,
    });

    const context = createMockContext();
    await activate(context);

    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'statusbarColorizer.reassign');
    const commandHandler = reassignCall![1] as () => Promise<void>;

    mockRun.mockResolvedValue({ status: 'skipped', reason: 'no-branch-mapping' });

    await commandHandler();

    expect(getShowInformationMessage()).toHaveBeenCalledWith(
      'Statusbar Colorizer: Reassign is not available for this branch — no color is mapped for it.'
    );
  });

  it('does NOT call showInformationMessage for other skipped reasons (e.g. already-assigned)', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/project' } }],
      configurable: true,
    });

    const context = createMockContext();
    await activate(context);

    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'statusbarColorizer.reassign');
    const commandHandler = reassignCall![1] as () => Promise<void>;

    mockRun.mockResolvedValue({ status: 'skipped', reason: 'already-assigned' });

    await commandHandler();

    expect(getShowInformationMessage()).not.toHaveBeenCalled();
  });

  // ─── Test 4: subscriptions receive disposables ───
  it('pushes disposables to context.subscriptions', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/project' } }],
      configurable: true,
    });

    const context = createMockContext();
    await activate(context);

    // Should have at least 3 subscriptions: folderChangeSubscription + configChangeSubscription + reassignCommand
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(3);
  });

  // ─── Test 5: .git/HEAD watcher registration (Requirement 5.1, 5.3, 5.4) ───
  it('registers a .git/HEAD file system watcher for each workspace folder', async () => {
    const folderPath = '/home/user/my-project';
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: folderPath } }],
      configurable: true,
    });

    const context = createMockContext();
    await activate(context);

    expect(vi.mocked(vscode.RelativePattern)).toHaveBeenCalledWith(folderPath, '.git/HEAD');
    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).toHaveBeenCalledTimes(1);
  });

  it('registers one watcher per workspace folder in a multi-root workspace', async () => {
    const folders = [
      { uri: { fsPath: '/home/user/project-a' } },
      { uri: { fsPath: '/home/user/project-b' } },
      { uri: { fsPath: '/home/user/project-c' } },
    ];
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: folders,
      configurable: true,
    });

    const context = createMockContext();
    await activate(context);

    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(vscode.RelativePattern)).toHaveBeenCalledWith('/home/user/project-a', '.git/HEAD');
    expect(vi.mocked(vscode.RelativePattern)).toHaveBeenCalledWith('/home/user/project-b', '.git/HEAD');
    expect(vi.mocked(vscode.RelativePattern)).toHaveBeenCalledWith('/home/user/project-c', '.git/HEAD');
  });

  it('does not register any watchers when there are no workspace folders', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: undefined,
      configurable: true,
    });

    const context = createMockContext();
    await activate(context);

    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).not.toHaveBeenCalled();
  });

  it('pushes the watcher into context.subscriptions for disposal on deactivation', async () => {
    const folderPath = '/home/user/my-project';
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: folderPath } }],
      configurable: true,
    });

    const mockWatcher = {
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
      mockWatcher as unknown as vscode.FileSystemWatcher
    );

    const context = createMockContext();
    await activate(context);

    expect(context.subscriptions).toContain(mockWatcher);
  });

  it('calls orchestrator.run with force: true when the watched .git/HEAD file changes', async () => {
    const folderPath = '/home/user/my-project';
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: folderPath } }],
      configurable: true,
    });

    let capturedOnDidChange: (() => void) | undefined;
    const mockWatcher = {
      onDidChange: vi.fn().mockImplementation((cb: () => void) => {
        capturedOnDidChange = cb;
        return { dispose: vi.fn() };
      }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
      mockWatcher as unknown as vscode.FileSystemWatcher
    );

    const context = createMockContext();
    await activate(context);

    // Clear the initial run call from activate()
    mockRun.mockClear();

    // Simulate a HEAD file change
    expect(capturedOnDidChange).toBeDefined();
    capturedOnDidChange!();

    // Wait for async handler to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockRun).toHaveBeenCalledWith(folderPath, { force: true });
  });

  it('calls orchestrator.run with force: true when the watched .git/HEAD file is created', async () => {
    const folderPath = '/home/user/my-project';
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: folderPath } }],
      configurable: true,
    });

    let capturedOnDidCreate: (() => void) | undefined;
    const mockWatcher = {
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockImplementation((cb: () => void) => {
        capturedOnDidCreate = cb;
        return { dispose: vi.fn() };
      }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
      mockWatcher as unknown as vscode.FileSystemWatcher
    );

    const context = createMockContext();
    await activate(context);

    // Clear the initial run call from activate()
    mockRun.mockClear();

    // Simulate a HEAD file creation (git init after activation)
    expect(capturedOnDidCreate).toBeDefined();
    capturedOnDidCreate!();

    // Wait for async handler to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockRun).toHaveBeenCalledWith(folderPath, { force: true });
  });

  // ─── Test 6: Dynamic workspace folder changes (Requirement 5.5) ───
  it('registers a watcher and calls orchestrator.run for a dynamically added workspace folder', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [],
      configurable: true,
    });

    // Capture the onDidChangeWorkspaceFolders callback
    let capturedFolderChangeHandler: ((event: { added: { uri: { fsPath: string } }[]; removed: { uri: { fsPath: string } }[] }) => void) | undefined;
    getOnDidChangeWorkspaceFolders().mockImplementation((cb) => {
      capturedFolderChangeHandler = cb as unknown as typeof capturedFolderChangeHandler;
      return { dispose: vi.fn() };
    });

    const context = createMockContext();
    await activate(context);

    // No watchers registered at activation (no folders)
    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).not.toHaveBeenCalled();
    mockRun.mockClear();

    // Simulate adding a new workspace folder
    const newFolderPath = '/home/user/new-project';
    expect(capturedFolderChangeHandler).toBeDefined();
    capturedFolderChangeHandler!({ added: [{ uri: { fsPath: newFolderPath } }], removed: [] });

    // Should register a watcher for the new folder
    expect(vi.mocked(vscode.RelativePattern)).toHaveBeenCalledWith(newFolderPath, '.git/HEAD');
    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).toHaveBeenCalledTimes(1);

    // Should call orchestrator.run for the new folder
    expect(mockRun).toHaveBeenCalledWith(newFolderPath);
  });

  it('disposes the watcher for a dynamically removed workspace folder', async () => {
    const folderPath = '/home/user/my-project';
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: folderPath } }],
      configurable: true,
    });

    // Capture the onDidChangeWorkspaceFolders callback
    let capturedFolderChangeHandler: ((event: { added: { uri: { fsPath: string } }[]; removed: { uri: { fsPath: string } }[] }) => void) | undefined;
    getOnDidChangeWorkspaceFolders().mockImplementation((cb) => {
      capturedFolderChangeHandler = cb as unknown as typeof capturedFolderChangeHandler;
      return { dispose: vi.fn() };
    });

    const mockWatcher = {
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
      mockWatcher as unknown as vscode.FileSystemWatcher
    );

    const context = createMockContext();
    await activate(context);

    // Watcher was registered at activation
    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).toHaveBeenCalledTimes(1);

    // Simulate removing the workspace folder
    expect(capturedFolderChangeHandler).toBeDefined();
    capturedFolderChangeHandler!({ added: [], removed: [{ uri: { fsPath: folderPath } }] });

    // The watcher for the removed folder should be disposed
    expect(mockWatcher.dispose).toHaveBeenCalled();
  });

  it('does not dispose watchers for folders that were not tracked', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [],
      configurable: true,
    });

    let capturedFolderChangeHandler: ((event: { added: { uri: { fsPath: string } }[]; removed: { uri: { fsPath: string } }[] }) => void) | undefined;
    getOnDidChangeWorkspaceFolders().mockImplementation((cb) => {
      capturedFolderChangeHandler = cb as unknown as typeof capturedFolderChangeHandler;
      return { dispose: vi.fn() };
    });

    const mockWatcher = {
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
      mockWatcher as unknown as vscode.FileSystemWatcher
    );

    const context = createMockContext();
    await activate(context);

    // Simulate removing a folder that was never tracked
    expect(capturedFolderChangeHandler).toBeDefined();
    capturedFolderChangeHandler!({ added: [], removed: [{ uri: { fsPath: '/home/user/unknown-project' } }] });

    // No watcher should be disposed since none was tracked for this path
    expect(mockWatcher.dispose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for reassign command key format (Requirements 6.1, 6.2, 6.3, 6.4)
// ─────────────────────────────────────────────────────────────────────────────
describe('extension — reassign command key format', () => {
  let mockRun: ReturnType<typeof vi.fn>;
  let mockDetect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    getRegisterCommand().mockReturnValue({ dispose: vi.fn() });
    getOnDidChangeWorkspaceFolders().mockReturnValue({ dispose: vi.fn() });
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() } as unknown as vscode.Disposable);
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue({
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    } as unknown as vscode.FileSystemWatcher);

    mockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'already-assigned' });
    vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
      () => ({ run: mockRun }) as unknown as ColorAssignmentOrchestrator
    );

    mockDetect = vi.fn().mockResolvedValue(null);
    vi.mocked(DefaultBranchDetector).mockImplementation(
      () => ({ detect: mockDetect }) as unknown as DefaultBranchDetector
    );
  });

  async function getReassignHandler(context: vscode.ExtensionContext): Promise<() => Promise<void>> {
    await activate(context);
    const reassignCall = getRegisterCommand().mock.calls.find(([name]) => name === 'statusbarColorizer.reassign');
    expect(reassignCall).toBeDefined();
    return reassignCall![1] as () => Promise<void>;
  }

  it('uses reassignOffset:<path>:<branch> key format when branch is detected', async () => {
    const workspacePath = '/home/user/my-project';
    const branchName = 'feature/my-feature';

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: workspacePath } }],
      configurable: true,
    });
    mockDetect.mockResolvedValue(branchName);

    const store = new Map<string, unknown>();
    const context = {
      subscriptions: [],
      globalState: {
        get: <T>(key: string) => store.get(key) as T | undefined,
        update: vi.fn().mockImplementation(async (key: string, value: unknown) => { store.set(key, value); }),
      },
    } as unknown as vscode.ExtensionContext;

    const handler = await getReassignHandler(context);
    await handler();

    const expectedKey = `reassignOffset:${workspacePath}:${branchName}`;
    expect(context.globalState.update).toHaveBeenCalledWith(expectedKey, 1);
  });

  it('uses "" as branch component in the key when BranchDetector returns null', async () => {
    const workspacePath = '/home/user/my-project';

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: workspacePath } }],
      configurable: true,
    });
    mockDetect.mockResolvedValue(null);

    const store = new Map<string, unknown>();
    const context = {
      subscriptions: [],
      globalState: {
        get: <T>(key: string) => store.get(key) as T | undefined,
        update: vi.fn().mockImplementation(async (key: string, value: unknown) => { store.set(key, value); }),
      },
    } as unknown as vscode.ExtensionContext;

    const handler = await getReassignHandler(context);
    await handler();

    const expectedKey = `reassignOffset:${workspacePath}:`;
    expect(context.globalState.update).toHaveBeenCalledWith(expectedKey, 1);
  });

  it('increments offset independently per branch — main and develop have separate counters', async () => {
    const workspacePath = '/home/user/my-project';

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: workspacePath } }],
      configurable: true,
    });

    const store = new Map<string, unknown>();
    const context = {
      subscriptions: [],
      globalState: {
        get: <T>(key: string) => store.get(key) as T | undefined,
        update: vi.fn().mockImplementation(async (key: string, value: unknown) => { store.set(key, value); }),
      },
    } as unknown as vscode.ExtensionContext;

    // First invocation on 'main'
    mockDetect.mockResolvedValue('main');
    const handler = await getReassignHandler(context);
    await handler();

    expect(context.globalState.update).toHaveBeenCalledWith(`reassignOffset:${workspacePath}:main`, 1);

    // Second invocation on 'main' — offset should be 2
    await handler();
    expect(context.globalState.update).toHaveBeenCalledWith(`reassignOffset:${workspacePath}:main`, 2);

    // Invocation on 'develop' — offset starts at 1 (independent counter)
    mockDetect.mockResolvedValue('develop');
    await handler();
    expect(context.globalState.update).toHaveBeenCalledWith(`reassignOffset:${workspacePath}:develop`, 1);
  });

  it('passes the incremented offset to orchestrator.run', async () => {
    const workspacePath = '/home/user/my-project';
    const branchName = 'main';

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: workspacePath } }],
      configurable: true,
    });
    mockDetect.mockResolvedValue(branchName);

    const context = createMockContext();
    const handler = await getReassignHandler(context);

    mockRun.mockClear();
    await handler();

    expect(mockRun).toHaveBeenCalledWith(workspacePath, { force: true, offset: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property-based tests for extension.ts
// ─────────────────────────────────────────────────────────────────────────────
describe('extension — property-based tests', () => {
  let mockRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    getRegisterCommand().mockReturnValue({ dispose: vi.fn() });
    getOnDidChangeWorkspaceFolders().mockReturnValue({ dispose: vi.fn() });
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() } as unknown as vscode.Disposable);
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue({
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    } as unknown as vscode.FileSystemWatcher);

    mockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' });
    vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
      () => ({ run: mockRun }) as unknown as ColorAssignmentOrchestrator
    );
  });

  // Feature: branch-based-colorization
  // Property 13: Reassign offset key is per-branch
  // Validates: Requirements 6.2, 6.3
  it('Property 13: globalState key equals reassignOffset:<workspacePath>:<branchName> and value equals 1 on first invocation', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary workspace paths (non-empty, no null bytes)
        fc.string({ minLength: 1 }).filter(s => !s.includes('\0')),
        // Generate arbitrary branch names (non-empty, no null bytes)
        fc.string({ minLength: 1 }).filter(s => !s.includes('\0')),
        async (workspacePath, branchName) => {
          vi.clearAllMocks();

          // Reset mocks after clearAllMocks
          getRegisterCommand().mockReturnValue({ dispose: vi.fn() });
          getOnDidChangeWorkspaceFolders().mockReturnValue({ dispose: vi.fn() });
          vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() } as unknown as vscode.Disposable);
          vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue({
            onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
            onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
            onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
            dispose: vi.fn(),
          } as unknown as vscode.FileSystemWatcher);

          // Fresh orchestrator mock for this run
          const localMockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'already-assigned' });
          vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
            () => ({ run: localMockRun }) as unknown as ColorAssignmentOrchestrator
          );

          // Mock BranchDetector.detect() to return the generated branch name
          vi.mocked(DefaultBranchDetector).mockImplementation(() => ({
            detect: vi.fn().mockResolvedValue(branchName),
          }) as unknown as DefaultBranchDetector);

          // Set workspaceFolders to the generated workspace path
          Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [{ uri: { fsPath: workspacePath } }],
            configurable: true,
          });

          // Create a fresh context with a real store to capture globalState writes
          const store = new Map<string, unknown>();
          const context = {
            subscriptions: [],
            globalState: {
              get: <T>(key: string) => store.get(key) as T | undefined,
              update: vi.fn().mockImplementation(async (key: string, value: unknown) => {
                store.set(key, value);
              }),
            },
          } as unknown as vscode.ExtensionContext;

          await activate(context);

          // Extract the reassign command handler
          const registerCommandCalls = getRegisterCommand().mock.calls;
          const reassignCall = registerCommandCalls.find(([name]) => name === 'statusbarColorizer.reassign');
          expect(reassignCall).toBeDefined();
          const commandHandler = reassignCall![1] as () => Promise<void>;

          // Invoke the reassign command handler
          await commandHandler();

          // Assert the globalState key and value
          const expectedKey = `reassignOffset:${workspacePath}:${branchName}`;
          expect(context.globalState.update).toHaveBeenCalledWith(expectedKey, 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug condition exploration tests — Task 1
// Property 1: Bug Condition — Stored Offset Is Ignored on Activation
//
// These tests MUST FAIL on unfixed code. Failure confirms the bug exists.
// DO NOT fix the code when these tests fail.
//
// The bug: activate() calls orchestrator.run(workspacePath) with no options,
// ignoring any stored reassignOffset in globalState. The HEAD-change handler
// similarly calls orchestrator.run(folderPath, { force: true }) without offset.
//
// Validates: Requirements 1.1, 1.2, 1.3
// ─────────────────────────────────────────────────────────────────────────────
describe('extension — bug condition exploration (Property 1: Stored Offset Is Ignored on Activation)', () => {
  let mockRun: ReturnType<typeof vi.fn>;
  let mockDetect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    getRegisterCommand().mockReturnValue({ dispose: vi.fn() });
    getOnDidChangeWorkspaceFolders().mockReturnValue({ dispose: vi.fn() });
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() } as unknown as vscode.Disposable);
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue({
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    } as unknown as vscode.FileSystemWatcher);

    mockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' });
    vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
      () => ({ run: mockRun }) as unknown as ColorAssignmentOrchestrator
    );

    mockDetect = vi.fn().mockResolvedValue(null);
    vi.mocked(DefaultBranchDetector).mockImplementation(
      () => ({ detect: mockDetect }) as unknown as DefaultBranchDetector
    );

    // Mock VscodePluginConfiguration to return 'branch' strategy
    vi.mocked(VscodePluginConfiguration).mockImplementation(() => ({
      getColorStrategy: vi.fn().mockReturnValue('branch'),
      getColorPalette: vi.fn().mockReturnValue([]),
      colorStatusBar: vi.fn().mockReturnValue(true),
      colorTitleBar: vi.fn().mockReturnValue(false),
      getBranchColors: vi.fn().mockReturnValue({}),
    }) as unknown as VscodePluginConfiguration);
  });

  // ─── Unit test: activate() path — stored offset is ignored ───────────────
  // EXPECTED TO FAIL on unfixed code:
  //   activate() calls orchestrator.run(workspacePath) with no options,
  //   but we assert it should be called with { offset: 2 }.
  // Counterexample: orchestrator.run('/home/user/proj') instead of
  //   orchestrator.run('/home/user/proj', { offset: 2 })
  //   when reassignOffset:/home/user/proj:main = 2 is stored.
  it('Bug Condition — activate() with stored offset N calls orchestrator.run with { offset: N } (FAILS on unfixed code)', async () => {
    const workspacePath = '/home/user/proj';
    const branchName = 'main';
    const storedOffset = 2;

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: workspacePath } }],
      configurable: true,
    });

    mockDetect.mockResolvedValue(branchName);

    // Pre-populate globalState with a non-zero offset
    const store = new Map<string, unknown>();
    const key = `reassignOffset:${workspacePath}:${branchName}`;
    store.set(key, storedOffset);

    const context = {
      subscriptions: [],
      globalState: {
        get: <T>(k: string) => store.get(k) as T | undefined,
        update: async (k: string, value: unknown) => { store.set(k, value); },
      },
    } as unknown as vscode.ExtensionContext;

    await activate(context);

    // On unfixed code, orchestrator.run is called with (workspacePath) — no offset.
    // The fix should make it call orchestrator.run(workspacePath, { offset: 2 }).
    expect(mockRun).toHaveBeenCalledWith(workspacePath, { offset: storedOffset });
  });

  // ─── Unit test: HEAD-change handler path — stored offset is ignored ───────
  // EXPECTED TO FAIL on unfixed code:
  //   The handler calls orchestrator.run(folderPath, { force: true }) without offset,
  //   but we assert it should be called with { force: true, offset: 1 }.
  // Counterexample: orchestrator.run('/home/user/proj', { force: true }) instead of
  //   orchestrator.run('/home/user/proj', { force: true, offset: 1 })
  //   when reassignOffset:/home/user/proj:feature/x = 1 is stored.
  it('Bug Condition — HEAD-change handler with stored offset N calls orchestrator.run with { force: true, offset: N } (FAILS on unfixed code)', async () => {
    const folderPath = '/home/user/proj';
    const branchName = 'feature/x';
    const storedOffset = 1;

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: folderPath } }],
      configurable: true,
    });

    mockDetect.mockResolvedValue(branchName);

    // Pre-populate globalState with a non-zero offset for this branch
    const store = new Map<string, unknown>();
    const key = `reassignOffset:${folderPath}:${branchName}`;
    store.set(key, storedOffset);

    // Capture the onDidChange callback from the watcher
    let capturedOnDidChange: (() => void) | undefined;
    const mockWatcher = {
      onDidChange: vi.fn().mockImplementation((cb: () => void) => {
        capturedOnDidChange = cb;
        return { dispose: vi.fn() };
      }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
      mockWatcher as unknown as vscode.FileSystemWatcher
    );

    const context = {
      subscriptions: [],
      globalState: {
        get: <T>(k: string) => store.get(k) as T | undefined,
        update: async (k: string, value: unknown) => { store.set(k, value); },
      },
    } as unknown as vscode.ExtensionContext;

    await activate(context);

    // Clear the initial run call from activate()
    mockRun.mockClear();

    // Simulate a .git/HEAD change (branch switch)
    expect(capturedOnDidChange).toBeDefined();
    capturedOnDidChange!();

    // Wait for async handler to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    // On unfixed code, the handler calls orchestrator.run(folderPath, { force: true }) — no offset.
    // The fix should make it call orchestrator.run(folderPath, { force: true, offset: 1 }).
    expect(mockRun).toHaveBeenCalledWith(folderPath, { force: true, offset: storedOffset });
  });

  // ─── Property-based test: activate() path — any non-zero offset is ignored ─
  // Validates: Requirements 1.1, 1.2, 1.3
  // EXPECTED TO FAIL on unfixed code for any (workspacePath, branchName, offset > 0).
  // Counterexamples will show orchestrator.run called without offset option.
  it('Property 1 (activate path): for any branch strategy workspace with stored offset N > 0, activate() calls orchestrator.run with { offset: N } (FAILS on unfixed code)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter(s => !s.includes('\0')),
        fc.string({ minLength: 1 }).filter(s => !s.includes('\0')),
        fc.integer({ min: 1, max: 100 }),
        async (workspacePath, branchName, storedOffset) => {
          vi.clearAllMocks();

          // Reset all mocks
          getRegisterCommand().mockReturnValue({ dispose: vi.fn() });
          getOnDidChangeWorkspaceFolders().mockReturnValue({ dispose: vi.fn() });
          vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() } as unknown as vscode.Disposable);
          vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue({
            onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
            onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
            onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
            dispose: vi.fn(),
          } as unknown as vscode.FileSystemWatcher);

          const localMockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' });
          vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
            () => ({ run: localMockRun }) as unknown as ColorAssignmentOrchestrator
          );

          vi.mocked(DefaultBranchDetector).mockImplementation(() => ({
            detect: vi.fn().mockResolvedValue(branchName),
          }) as unknown as DefaultBranchDetector);

          // Mock config to return 'branch' strategy
          vi.mocked(VscodePluginConfiguration).mockImplementation(() => ({
            getColorStrategy: vi.fn().mockReturnValue('branch'),
            getColorPalette: vi.fn().mockReturnValue([]),
            colorStatusBar: vi.fn().mockReturnValue(true),
            colorTitleBar: vi.fn().mockReturnValue(false),
            getBranchColors: vi.fn().mockReturnValue({}),
          }) as unknown as VscodePluginConfiguration);

          Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [{ uri: { fsPath: workspacePath } }],
            configurable: true,
          });

          // Pre-populate globalState with a non-zero offset
          const store = new Map<string, unknown>();
          const key = `reassignOffset:${workspacePath}:${branchName}`;
          store.set(key, storedOffset);

          const context = {
            subscriptions: [],
            globalState: {
              get: <T>(k: string) => store.get(k) as T | undefined,
              update: async (k: string, value: unknown) => { store.set(k, value); },
            },
          } as unknown as vscode.ExtensionContext;

          await activate(context);

          // On unfixed code: localMockRun is called with (workspacePath) — no offset.
          // Expected (fixed): localMockRun called with (workspacePath, { offset: storedOffset }).
          expect(localMockRun).toHaveBeenCalledWith(workspacePath, { offset: storedOffset });
        }
      ),
      { numRuns: 50 }
    );
  });

  // ─── Property-based test: HEAD-change handler path — any non-zero offset is ignored ─
  // Validates: Requirements 1.1, 1.2, 1.3
  // EXPECTED TO FAIL on unfixed code for any (folderPath, branchName, offset > 0).
  it('Property 1 (HEAD-change path): for any branch strategy workspace with stored offset N > 0, HEAD-change handler calls orchestrator.run with { force: true, offset: N } (FAILS on unfixed code)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter(s => !s.includes('\0')),
        fc.string({ minLength: 1 }).filter(s => !s.includes('\0')),
        fc.integer({ min: 1, max: 100 }),
        async (folderPath, branchName, storedOffset) => {
          vi.clearAllMocks();

          // Reset all mocks
          getRegisterCommand().mockReturnValue({ dispose: vi.fn() });
          getOnDidChangeWorkspaceFolders().mockReturnValue({ dispose: vi.fn() });
          vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() } as unknown as vscode.Disposable);

          const localMockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' });
          vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
            () => ({ run: localMockRun }) as unknown as ColorAssignmentOrchestrator
          );

          vi.mocked(DefaultBranchDetector).mockImplementation(() => ({
            detect: vi.fn().mockResolvedValue(branchName),
          }) as unknown as DefaultBranchDetector);

          vi.mocked(VscodePluginConfiguration).mockImplementation(() => ({
            getColorStrategy: vi.fn().mockReturnValue('branch'),
            getColorPalette: vi.fn().mockReturnValue([]),
            colorStatusBar: vi.fn().mockReturnValue(true),
            colorTitleBar: vi.fn().mockReturnValue(false),
            getBranchColors: vi.fn().mockReturnValue({}),
          }) as unknown as VscodePluginConfiguration);

          Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [{ uri: { fsPath: folderPath } }],
            configurable: true,
          });

          // Capture the onDidChange callback
          let capturedOnDidChange: (() => void) | undefined;
          const mockWatcher = {
            onDidChange: vi.fn().mockImplementation((cb: () => void) => {
              capturedOnDidChange = cb;
              return { dispose: vi.fn() };
            }),
            onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
            onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
            dispose: vi.fn(),
          };
          vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
            mockWatcher as unknown as vscode.FileSystemWatcher
          );

          // Pre-populate globalState with a non-zero offset
          const store = new Map<string, unknown>();
          const key = `reassignOffset:${folderPath}:${branchName}`;
          store.set(key, storedOffset);

          const context = {
            subscriptions: [],
            globalState: {
              get: <T>(k: string) => store.get(k) as T | undefined,
              update: async (k: string, value: unknown) => { store.set(k, value); },
            },
          } as unknown as vscode.ExtensionContext;

          await activate(context);

          // Clear the initial run call from activate()
          localMockRun.mockClear();

          // Simulate HEAD change
          expect(capturedOnDidChange).toBeDefined();
          capturedOnDidChange!();

          // Wait for async handler
          await new Promise(resolve => setTimeout(resolve, 0));

          // On unfixed code: localMockRun called with (folderPath, { force: true }) — no offset.
          // Expected (fixed): localMockRun called with (folderPath, { force: true, offset: storedOffset }).
          expect(localMockRun).toHaveBeenCalledWith(folderPath, { force: true, offset: storedOffset });
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Preservation property tests (Task 2 — reassign-color-persistence-fix spec)
// These tests MUST PASS on unfixed code — they document baseline behavior.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper: set up VscodePluginConfiguration mock to return a given strategy.
 * Must be called inside a test after vi.clearAllMocks() has been called.
 */
function mockConfigStrategy(strategy: 'branch' | 'project'): void {
  vi.mocked(VscodePluginConfiguration).mockImplementation(() => ({
    getColorStrategy: vi.fn().mockReturnValue(strategy),
    getColorPalette: vi.fn().mockReturnValue([]),
    colorStatusBar: vi.fn().mockReturnValue(true),
    colorTitleBar: vi.fn().mockReturnValue(false),
    getBranchColors: vi.fn().mockReturnValue({}),
  }) as unknown as VscodePluginConfiguration);
}

/**
 * Helper: standard mock reset used inside property loops.
 */
function resetStandardMocks(localMockRun: ReturnType<typeof vi.fn>): void {
  getRegisterCommand().mockReturnValue({ dispose: vi.fn() });
  getOnDidChangeWorkspaceFolders().mockReturnValue({ dispose: vi.fn() });
  vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() } as unknown as vscode.Disposable);
  vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue({
    onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
  } as unknown as vscode.FileSystemWatcher);
  vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
    () => ({ run: localMockRun }) as unknown as ColorAssignmentOrchestrator
  );
}

describe('extension — preservation property tests (reassign-color-persistence-fix)', () => {
  let mockRun: ReturnType<typeof vi.fn>;
  let mockDetect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    getRegisterCommand().mockReturnValue({ dispose: vi.fn() });
    getOnDidChangeWorkspaceFolders().mockReturnValue({ dispose: vi.fn() });
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() } as unknown as vscode.Disposable);
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue({
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    } as unknown as vscode.FileSystemWatcher);

    mockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' });
    vi.mocked(ColorAssignmentOrchestrator).mockImplementation(
      () => ({ run: mockRun }) as unknown as ColorAssignmentOrchestrator
    );

    mockDetect = vi.fn().mockResolvedValue(null);
    vi.mocked(DefaultBranchDetector).mockImplementation(
      () => ({ detect: mockDetect }) as unknown as DefaultBranchDetector
    );
  });

  // ─── Case A: Zero/absent offset, branch strategy — activate() calls run with no offset ───
  // Validates: Requirements 3.1, 3.4
  // **Validates: Requirements 3.1**
  it('Property 2A: branch strategy with zero/absent offset — orchestrator.run called with (workspacePath) and no offset', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter(s => !s.includes('\0')),
        fc.string({ minLength: 1 }).filter(s => !s.includes('\0')),
        // offset is either 0 or absent (represented as undefined)
        fc.oneof(fc.constant(0), fc.constant(undefined)),
        async (workspacePath, branchName, storedOffset) => {
          vi.clearAllMocks();

          const localMockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' });
          resetStandardMocks(localMockRun);

          // Strategy = 'branch', no non-zero offset stored
          mockConfigStrategy('branch');

          vi.mocked(DefaultBranchDetector).mockImplementation(() => ({
            detect: vi.fn().mockResolvedValue(branchName),
          }) as unknown as DefaultBranchDetector);

          Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [{ uri: { fsPath: workspacePath } }],
            configurable: true,
          });

          const store = new Map<string, unknown>();
          // Store 0 or nothing — both represent "no prior reassign"
          if (storedOffset !== undefined) {
            store.set(`reassignOffset:${workspacePath}:${branchName}`, storedOffset);
          }
          const context = {
            subscriptions: [],
            globalState: {
              get: <T>(key: string) => store.get(key) as T | undefined,
              update: async (key: string, value: unknown) => { store.set(key, value); },
            },
          } as unknown as vscode.ExtensionContext;

          await activate(context);

          // The first call to orchestrator.run must be (workspacePath) with no offset option
          expect(localMockRun).toHaveBeenCalledWith(workspacePath);
          // Must NOT have been called with an offset option
          const calls = localMockRun.mock.calls;
          const activationCall = calls[0];
          expect(activationCall).toBeDefined();
          // Either called with just workspacePath (1 arg), or second arg has no offset
          if (activationCall.length > 1 && activationCall[1] !== undefined) {
            expect((activationCall[1] as Record<string, unknown>).offset).toBeUndefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // ─── Case B: Project strategy — branchDetector.detect NOT called, run called with no offset ───
  // Validates: Requirements 3.3
  // **Validates: Requirements 3.3**
  it('Property 2B: project strategy — branchDetector.detect is NOT called and orchestrator.run called with (workspacePath) and no offset', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter(s => !s.includes('\0')),
        async (workspacePath) => {
          vi.clearAllMocks();

          const localMockRun = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no-workspace' });
          resetStandardMocks(localMockRun);

          // Strategy = 'project'
          mockConfigStrategy('project');

          const localMockDetect = vi.fn().mockResolvedValue('some-branch');
          vi.mocked(DefaultBranchDetector).mockImplementation(() => ({
            detect: localMockDetect,
          }) as unknown as DefaultBranchDetector);

          Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [{ uri: { fsPath: workspacePath } }],
            configurable: true,
          });

          const context = createMockContext();
          await activate(context);

          // branchDetector.detect must NOT be called during activation for project strategy
          expect(localMockDetect).not.toHaveBeenCalled();

          // orchestrator.run must be called with (workspacePath) and no offset
          expect(localMockRun).toHaveBeenCalledWith(workspacePath);
          const activationCall = localMockRun.mock.calls[0];
          if (activationCall.length > 1 && activationCall[1] !== undefined) {
            expect((activationCall[1] as Record<string, unknown>).offset).toBeUndefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // ─── Case C: Reassign command unchanged — globalState incremented, run called with force+offset ───
  // Validates: Requirements 3.2
  // **Validates: Requirements 3.2**
  it('Preservation Case C: reassign command increments globalState and calls orchestrator.run with { force: true, offset: N }', async () => {
    const workspacePath = '/home/user/my-project';
    const branchName = 'main';

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: workspacePath } }],
      configurable: true,
    });

    mockDetect.mockResolvedValue(branchName);

    const store = new Map<string, unknown>();
    const context = {
      subscriptions: [],
      globalState: {
        get: <T>(key: string) => store.get(key) as T | undefined,
        update: vi.fn().mockImplementation(async (key: string, value: unknown) => { store.set(key, value); }),
      },
    } as unknown as vscode.ExtensionContext;

    await activate(context);

    const reassignCall = getRegisterCommand().mock.calls.find(([name]) => name === 'statusbarColorizer.reassign');
    expect(reassignCall).toBeDefined();
    const commandHandler = reassignCall![1] as () => Promise<void>;

    mockRun.mockClear();
    mockRun.mockResolvedValue({ status: 'assigned', backgroundColor: '#2D6A4F', foregroundColor: '#FFFFFF' });

    await commandHandler();

    // globalState must be incremented
    const expectedKey = `reassignOffset:${workspacePath}:${branchName}`;
    expect(context.globalState.update).toHaveBeenCalledWith(expectedKey, 1);

    // orchestrator.run must be called with force: true and offset: 1
    expect(mockRun).toHaveBeenCalledWith(workspacePath, { force: true, offset: 1 });
  });

  // ─── Case D: HEAD change, zero offset for new branch — run called with { force: true } only ───
  // Validates: Requirements 3.4
  // **Validates: Requirements 3.4**
  it('Preservation Case D: HEAD change on branch with no stored offset — orchestrator.run called with (folderPath, { force: true }) and no offset', async () => {
    const folderPath = '/home/user/my-project';

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: folderPath } }],
      configurable: true,
    });

    let capturedOnDidChange: (() => void) | undefined;
    const mockWatcher = {
      onDidChange: vi.fn().mockImplementation((cb: () => void) => {
        capturedOnDidChange = cb;
        return { dispose: vi.fn() };
      }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(
      mockWatcher as unknown as vscode.FileSystemWatcher
    );

    // No offset stored for this branch
    const context = createMockContext();
    await activate(context);

    // Clear the initial activation call
    mockRun.mockClear();

    // Simulate HEAD change (branch switch to a branch with no stored offset)
    expect(capturedOnDidChange).toBeDefined();
    capturedOnDidChange!();

    // Wait for async handler to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    // Must be called with { force: true } and NO offset
    expect(mockRun).toHaveBeenCalledWith(folderPath, { force: true });
    const headChangeCall = mockRun.mock.calls[0];
    expect(headChangeCall[1]).toEqual({ force: true });
    expect((headChangeCall[1] as Record<string, unknown>).offset).toBeUndefined();
  });
});
