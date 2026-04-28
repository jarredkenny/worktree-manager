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
  async executeHook(hookName: string, context: HookContext): Promise<void> {
    const hookPath = join(context.worktreePath, ".wtm", hookName);

    if (!existsSync(hookPath)) {
      return;
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
