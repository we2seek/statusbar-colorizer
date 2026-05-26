import * as vscode from 'vscode';
import { DefaultNeighborScanner } from './neighborScanner';
import { DefaultColorAssigner } from './colorAssigner';
import { ContrastCheckerImpl } from './contrastChecker';
import { DefaultSettingsFileManager } from './settingsFileManager';
import { VscodePluginConfiguration } from './pluginConfiguration';
import { ColorAssignmentOrchestrator } from './orchestrator';
import { BranchDetector, DefaultBranchDetector } from './branchDetector';
import { DefaultBranchColorResolver } from './branchColorResolver';

/**
 * Registers a file system watcher on `.git/HEAD` for the given workspace folder.
 * On HEAD change or creation, detects the new branch, reads the stored
 * `reassignOffset:<folderPath>:<branchName>` from `globalState`, and calls
 * `orchestrator.run(folderPath, { force: true, offset: storedOffset })` when a
 * non-zero offset is stored, or `orchestrator.run(folderPath, { force: true })`
 * when no prior reassign has occurred (offset = 0). The watcher is pushed into
 * `context.subscriptions` so VS Code disposes it on deactivation.
 *
 * Requirement 5.1, 5.3, 5.4, 2.1, 3.4
 */
function registerHeadWatcher(
  folderPath: string,
  orchestrator: ColorAssignmentOrchestrator,
  context: vscode.ExtensionContext,
  branchDetector: BranchDetector
): vscode.FileSystemWatcher {
  const pattern = new vscode.RelativePattern(folderPath, '.git/HEAD');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const handleHeadChange = async (): Promise<void> => {
    const branchName = await branchDetector.detect(folderPath);
    const key = `reassignOffset:${folderPath}:${branchName ?? ''}`;
    const storedOffset = context.globalState.get<number>(key) ?? 0;
    orchestrator.run(folderPath, { force: true, ...(storedOffset > 0 ? { offset: storedOffset } : {}) });
  };

  watcher.onDidChange(() => handleHeadChange());
  watcher.onDidCreate(() => handleHeadChange());
  context.subscriptions.push(watcher);
  return watcher;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Create component instances
  const scanner = new DefaultNeighborScanner();
  const assigner = new DefaultColorAssigner();
  const contrastChecker = new ContrastCheckerImpl();
  const settingsManager = new DefaultSettingsFileManager();
  const config = new VscodePluginConfiguration();
  const branchDetector = new DefaultBranchDetector();
  const branchColorResolver = new DefaultBranchColorResolver();

  // Create orchestrator
  const orchestrator = new ColorAssignmentOrchestrator(
    scanner,
    assigner,
    contrastChecker,
    settingsManager,
    config,
    branchDetector,
    branchColorResolver
  );

  // Run on activation (without force — respects idempotency)
  // When strategy is 'branch', read the stored reassign offset so the orchestrator
  // resolves the same color that was last reassigned (Requirements 2.1, 2.2, 2.3).
  const strategy = config.getColorStrategy();
  if (strategy === 'branch') {
    const branchName = (await branchDetector.detect(workspacePath ?? '')) ?? '';
    const key = `reassignOffset:${workspacePath ?? ''}:${branchName}`;
    const storedOffset = context.globalState.get<number>(key) ?? 0;
    if (storedOffset > 0) {
      // If the user manually cleared settings.json, treat it as a reset — restore the
      // branch-mapped default and clear the stored offset so reassign starts fresh.
      const currentSettings = await settingsManager.read(workspacePath ?? '');
      const colorCleared = !settingsManager.hasStatusBarBackground(currentSettings);
      if (colorCleared) {
        await context.globalState.update(key, 0);
        await orchestrator.run(workspacePath);
      } else {
        await orchestrator.run(workspacePath, { offset: storedOffset });
      }
    } else {
      await orchestrator.run(workspacePath);
    }
  } else {
    // 'project' strategy — unchanged behavior (Requirement 3.3)
    await orchestrator.run(workspacePath);
  }

  // Track one watcher per folder path for dynamic lifecycle management (Requirement 5.5)
  const headWatchers = new Map<string, vscode.FileSystemWatcher>();

  // Register .git/HEAD watchers for each workspace folder (Requirement 5.1)
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const watcher = registerHeadWatcher(folder.uri.fsPath, orchestrator, context, branchDetector);
    headWatchers.set(folder.uri.fsPath, watcher);
  }

  // Subscribe to workspace folder changes for multi-root scenarios (Requirement 5.5)
  const folderChangeSubscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
    // Register watchers and run orchestrator for newly added folders
    for (const folder of event.added) {
      const folderPath = folder.uri.fsPath;
      const watcher = registerHeadWatcher(folderPath, orchestrator, context, branchDetector);
      headWatchers.set(folderPath, watcher);
      orchestrator.run(folderPath);
    }
    // Dispose watchers for removed folders
    for (const folder of event.removed) {
      const folderPath = folder.uri.fsPath;
      const watcher = headWatchers.get(folderPath);
      if (watcher) {
        watcher.dispose();
        headWatchers.delete(folderPath);
      }
    }
  });

  // Re-apply colors immediately when colorStatusBar or colorTitleBar settings change
  const configChangeSubscription = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration('statusbarColorizer.colorStatusBar') ||
      e.affectsConfiguration('statusbarColorizer.colorTitleBar')
    ) {
      const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      orchestrator.run(currentWorkspacePath, { force: true });
    }
  });

  // Register the reassign command
  const reassignCommand = vscode.commands.registerCommand(
    'statusbarColorizer.reassign',
    async () => {
      const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      // Detect current branch so the offset counter is per-branch (Requirement 6.1, 6.2)
      const branchName = await branchDetector.detect(currentWorkspacePath ?? '') ?? '';

      // Increment offset so each reassign picks a different color (Requirement 6.3, 6.4)
      const key = `reassignOffset:${currentWorkspacePath ?? ''}:${branchName}`;
      const offset = (context.globalState.get<number>(key) ?? 0) + 1;
      await context.globalState.update(key, offset);

      const result = await orchestrator.run(currentWorkspacePath, { force: true, offset });

      if (result.status === 'assigned') {
        vscode.window.showInformationMessage(
          `Statusbar Colorizer: Assigned color ${result.backgroundColor}`
        );
      } else if (result.status === 'skipped' && result.reason === 'no-branch-mapping') {
        vscode.window.showInformationMessage(
          'Statusbar Colorizer: Reassign is not available for this branch — no color is mapped for it.'
        );
      } else if (result.status === 'error') {
        vscode.window.showErrorMessage(
          `Statusbar Colorizer: ${result.message}`
        );
      }
    }
  );

  // Add subscriptions for cleanup on deactivation
  context.subscriptions.push(folderChangeSubscription, configChangeSubscription, reassignCommand);
}

export function deactivate(): void {}
