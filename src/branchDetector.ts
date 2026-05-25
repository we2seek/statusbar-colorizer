import * as fs from 'fs/promises';
import * as path from 'path';

export interface BranchDetector {
  detect(workspacePath: string): Promise<string | null>;
}

export class DefaultBranchDetector implements BranchDetector {
  constructor(
    private readonly readFile: (filePath: string) => Promise<string> = (p) =>
      fs.readFile(p, 'utf-8')
  ) {}

  async detect(workspacePath: string): Promise<string | null> {
    const headPath = path.join(workspacePath, '.git', 'HEAD');

    let content: string;
    try {
      content = await this.readFile(headPath);
    } catch {
      // No .git directory, HEAD file missing, or unreadable — return null silently
      return null;
    }

    const trimmed = content.trim();

    if (!trimmed.startsWith('ref:')) {
      // Detached HEAD state or any non-ref content
      return 'HEAD';
    }

    // Must match exactly: "ref: refs/heads/<branch>"
    const match = trimmed.match(/^ref:\s+refs\/heads\/(.+)$/);
    if (!match) {
      // Starts with "ref:" but wrong pattern (e.g. refs/tags/v1.0, ref:nospace, ref: )
      return null;
    }

    return match[1].trim();
  }
}
