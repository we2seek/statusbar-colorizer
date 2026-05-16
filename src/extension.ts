import * as vscode from 'vscode';
import { DefaultNeighborScanner } from './neighborScanner';
import { DefaultColorAssigner } from './colorAssigner';
import { ContrastCheckerImpl } from './contrastChecker';
import { DefaultSettingsFileManager } from './settingsFileManager';
import { VscodePluginConfiguration } from './pluginConfiguration';
import { ColorAssignmentOrchestrator } from './orchestrator';

export function activate(context: vscode.ExtensionContext): void {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Create component instances
  const scanner = new DefaultNeighborScanner();
  const assigner = new DefaultColorAssigner();
  const contrastChecker = new ContrastCheckerImpl();
  const settingsManager = new DefaultSettingsFileManager();
  const config = new VscodePluginConfiguration();

  // Create orchestrator
  const orchestrator = new ColorAssignmentOrchestrator(
    scanner,
    assigner,
    contrastChecker,
    settingsManager,
    config
  );

  // Run on activation (without force — respects idempotency)
  orchestrator.run(workspacePath);

  // Subscribe to workspace folder changes for multi-root scenarios
  const folderChangeSubscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    const updatedWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    orchestrator.run(updatedWorkspacePath);
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

      // Increment offset so each reassign picks a different color
      const key = `reassignOffset:${currentWorkspacePath ?? ''}`;
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
