import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

export interface HookContext {
  worktreePath: string;
  worktreeName: string;
  baseBranch: string;
  bareRepoPath: string;
}

export class HookManager {
  private bareRepoPath: string;

  constructor(bareRepoPath: string) {
    this.bareRepoPath = bareRepoPath;
  }

  private getHookPath(hookName: string): string {
    return join(this.bareRepoPath, hookName);
  }

  private hookExists(hookName: string): boolean {
    return existsSync(this.getHookPath(hookName));
  }

  async executeHook(hookName: string, context: HookContext): Promise<void> {
    const hookPath = this.getHookPath(hookName);
    
    if (!this.hookExists(hookName)) {
      return; // Hook doesn't exist, silently continue
    }

    try {
      console.log(`🪝 Running ${hookName} hook...`);
      
      const env = {
        ...process.env,
        WORKTREE_DIR: context.worktreePath,
        WORKTREE_NAME: context.worktreeName,
        BASE_BRANCH: context.baseBranch,
        BARE_REPO_PATH: context.bareRepoPath
      };

      await $`bash ${hookPath}`.env(env).cwd(context.worktreePath);
      
      console.log(`✅ ${hookName} hook completed successfully`);
    } catch (error) {
      console.error(`❌ ${hookName} hook failed: ${error}`);
      throw new Error(`Hook ${hookName} failed: ${error}`);
    }
  }

  async executePostCreateHook(context: HookContext): Promise<void> {
    await this.executeHook('post_create', context);
  }
}