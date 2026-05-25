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
  it('registers the statusbarColorizer.reassign command', () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/path' } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

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
    activate(context);

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
    activate(context);

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
    activate(context);

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
    activate(context);

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
    activate(context);

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
    activate(context);

    const registerCommandCalls = getRegisterCommand().mock.calls;
    const reassignCall = registerCommandCalls.find(([name]) => name === 'statusbarColorizer.reassign');
    const commandHandler = reassignCall![1] as () => Promise<void>;

    mockRun.mockResolvedValue({ status: 'skipped', reason: 'already-assigned' });

    await commandHandler();

    expect(getShowInformationMessage()).not.toHaveBeenCalled();
  });

  // ─── Test 4: subscriptions receive disposables ───
  it('pushes disposables to context.subscriptions', () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/some/project' } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    // Should have at least 3 subscriptions: folderChangeSubscription + configChangeSubscription + reassignCommand
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(3);
  });

  // ─── Test 5: .git/HEAD watcher registration (Requirement 5.1, 5.3, 5.4) ───
  it('registers a .git/HEAD file system watcher for each workspace folder', () => {
    const folderPath = '/home/user/my-project';
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: folderPath } }],
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    expect(vi.mocked(vscode.RelativePattern)).toHaveBeenCalledWith(folderPath, '.git/HEAD');
    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).toHaveBeenCalledTimes(1);
  });

  it('registers one watcher per workspace folder in a multi-root workspace', () => {
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
    activate(context);

    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(vscode.RelativePattern)).toHaveBeenCalledWith('/home/user/project-a', '.git/HEAD');
    expect(vi.mocked(vscode.RelativePattern)).toHaveBeenCalledWith('/home/user/project-b', '.git/HEAD');
    expect(vi.mocked(vscode.RelativePattern)).toHaveBeenCalledWith('/home/user/project-c', '.git/HEAD');
  });

  it('does not register any watchers when there are no workspace folders', () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: undefined,
      configurable: true,
    });

    const context = createMockContext();
    activate(context);

    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).not.toHaveBeenCalled();
  });

  it('pushes the watcher into context.subscriptions for disposal on deactivation', () => {
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
    activate(context);

    expect(context.subscriptions).toContain(mockWatcher);
  });

  it('calls orchestrator.run with force: true when the watched .git/HEAD file changes', () => {
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
    activate(context);

    // Clear the initial run call from activate()
    mockRun.mockClear();

    // Simulate a HEAD file change
    expect(capturedOnDidChange).toBeDefined();
    capturedOnDidChange!();

    expect(mockRun).toHaveBeenCalledWith(folderPath, { force: true });
  });

  it('calls orchestrator.run with force: true when the watched .git/HEAD file is created', () => {
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
    activate(context);

    // Clear the initial run call from activate()
    mockRun.mockClear();

    // Simulate a HEAD file creation (git init after activation)
    expect(capturedOnDidCreate).toBeDefined();
    capturedOnDidCreate!();

    expect(mockRun).toHaveBeenCalledWith(folderPath, { force: true });
  });

  // ─── Test 6: Dynamic workspace folder changes (Requirement 5.5) ───
  it('registers a watcher and calls orchestrator.run for a dynamically added workspace folder', () => {
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
    activate(context);

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

  it('disposes the watcher for a dynamically removed workspace folder', () => {
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
    activate(context);

    // Watcher was registered at activation
    expect(vi.mocked(vscode.workspace.createFileSystemWatcher)).toHaveBeenCalledTimes(1);

    // Simulate removing the workspace folder
    expect(capturedFolderChangeHandler).toBeDefined();
    capturedFolderChangeHandler!({ added: [], removed: [{ uri: { fsPath: folderPath } }] });

    // The watcher for the removed folder should be disposed
    expect(mockWatcher.dispose).toHaveBeenCalled();
  });

  it('does not dispose watchers for folders that were not tracked', () => {
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
    activate(context);

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
    activate(context);
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

          activate(context);

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
