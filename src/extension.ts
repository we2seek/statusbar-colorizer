import * as vscode from 'vscode';
import { DefaultNeighborScanner } from './neighborScanner';
import { DefaultColorAssigner } from './colorAssigner';
import { ContrastCheckerImpl } from './contrastChecker';
import { DefaultSettingsFileManager } from './settingsFileManager';
import { VscodePluginConfiguration } from './pluginConfiguration';
import { ColorAssignmentOrchestrator } from './orchestrator';
import { DefaultBranchDetector } from './branchDetector';
import { DefaultBranchColorResolver } from './branchColorResolver';

/**
 * Registers a file system watcher on `.git/HEAD` for the given workspace folder.
 * Calls `orchestrator.run(folderPath, { force: true })` whenever the HEAD file
 * changes or is created (handles git-init-after-activation). The watcher is
 * pushed into `context.subscriptions` so VS Code disposes it on deactivation.
 *
 * Requirement 5.1, 5.3, 5.4
 */
function registerHeadWatcher(
  folderPath: string,
  orchestrator: ColorAssignmentOrchestrator,
  context: vscode.ExtensionContext
): vscode.FileSystemWatcher {
  const pattern = new vscode.RelativePattern(folderPath, '.git/HEAD');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  watcher.onDidChange(() => orchestrator.run(folderPath, { force: true }));
  watcher.onDidCreate(() => orchestrator.run(folderPath, { force: true }));
  context.subscriptions.push(watcher);
  return watcher;
}

export function activate(context: vscode.ExtensionContext): void {
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
  orchestrator.run(workspacePath);

  // Track one watcher per folder path for dynamic lifecycle management (Requirement 5.5)
  const headWatchers = new Map<string, vscode.FileSystemWatcher>();

  // Register .git/HEAD watchers for each workspace folder (Requirement 5.1)
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const watcher = registerHeadWatcher(folder.uri.fsPath, orchestrator, context);
    headWatchers.set(folder.uri.fsPath, watcher);
  }

  // Subscribe to workspace folder changes for multi-root scenarios (Requirement 5.5)
  const folderChangeSubscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
    // Register watchers and run orchestrator for newly added folders
    for (const folder of event.added) {
      const folderPath = folder.uri.fsPath;
      const watcher = registerHeadWatcher(folderPath, orchestrator, context);
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
