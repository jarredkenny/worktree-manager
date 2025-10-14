import { $ } from "bun";
import { HookManager } from './hooks';

export interface WorktreeInfo {
  path: string;
  commit: string;
  branch: string;
  isBare?: boolean;
}

export class WorktreeManager {
  private cwd: string;
  private hookManager: HookManager;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.hookManager = new HookManager(cwd);
  }

  async ensureBareRepo(): Promise<void> {
    try {
      const result = await $`git config --get core.bare`.cwd(this.cwd).quiet();
      if (result.stdout.toString().trim() !== "true") {
        throw new Error("This command must be run in a bare git repository");
      }
    } catch {
      throw new Error("Not a git repository or not configured as bare");
    }
  }

  async fetchBranch(branch: string): Promise<string> {
    // Get the latest commit hash from remote
    const remoteCommit = await $`git ls-remote origin ${branch}`.cwd(this.cwd);
    const commitHash = remoteCommit.stdout.toString().split('\t')[0];

    if (!commitHash) {
      throw new Error(`Remote branch '${branch}' not found on origin`);
    }

    // Delete the remote tracking ref if it exists (handles corrupted/locked refs)
    await $`git update-ref -d refs/remotes/origin/${branch}`.cwd(this.cwd).nothrow();

    // Fetch to create fresh remote tracking ref
    // The + prefix forces the update
    await $`git fetch origin +${branch}:refs/remotes/origin/${branch}`.cwd(this.cwd);

    // Verify our local tracking ref now matches remote
    const localTracking = await $`git rev-parse origin/${branch}`.cwd(this.cwd);
    const localHash = localTracking.stdout.toString().trim();

    if (localHash !== commitHash) {
      throw new Error(
        `Failed to fetch latest ${branch}. ` +
          `Remote is at ${commitHash} but local tracking is at ${localHash}`,
      );
    }

    console.log(`✅ Fetched ${branch} at ${commitHash.substring(0, 9)}`);
    return commitHash;
  }

  async createWorktree(name: string, baseBranch: string): Promise<void> {
    await this.ensureBareRepo();

    // Fetch and verify we have the latest from remote
    await this.fetchBranch(baseBranch);

    const worktreePath = `${this.cwd}/${name}`;

    try {
      // ALWAYS use origin/baseBranch - this is the source of truth
      await $`git worktree add -b ${name} ${worktreePath} origin/${baseBranch}`.cwd(
        this.cwd,
      );
      console.log(
        `✅ Created worktree '${name}' from latest '${baseBranch}' at ${worktreePath}`,
      );
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error}`);
    }

    // Set up remote tracking branch in the worktree
    try {
      await $`git config branch.${name}.remote origin`.cwd(worktreePath);
      await $`git config branch.${name}.merge refs/heads/${name}`.cwd(worktreePath);
      await $`git fetch origin ${name}:refs/remotes/origin/${name}`.cwd(worktreePath);
    } catch {
      console.warn(`Warning: Could not set up remote tracking for branch ${name}`);
    }

    // Execute post_create hook
    await this.hookManager.executePostCreateHook({
      worktreePath,
      worktreeName: name,
      baseBranch,
      bareRepoPath: this.cwd
    });

    // Fork a new shell in the worktree directory
    try {
      console.log(`📁 Starting new shell in ${worktreePath}`);
      const shell = process.env.SHELL || '/bin/bash';
      const proc = Bun.spawn([shell], {
        cwd: worktreePath,
        env: process.env,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      await proc.exited;
    } catch (error) {
      console.warn(`Warning: Could not start shell in ${worktreePath}: ${error}`);
    }
  }

  async checkoutWorktree(name: string): Promise<void> {
    await this.ensureBareRepo();

    const worktrees = await this.listWorktrees();
    const existingWorktree = worktrees.find(
      (w) => w.path.endsWith(`/${name}`) || w.branch === name,
    );

    if (existingWorktree) {
      // Worktree already exists, just switch to it
      try {
        process.chdir(existingWorktree.path);
        console.log(
          `✅ Switched to worktree '${name}' at ${existingWorktree.path}`,
        );
        return;
      } catch (error) {
        throw new Error(`Failed to switch to worktree: ${error}`);
      }
    }

    // Worktree doesn't exist, try to create it from remote or local branch
    console.log(`Worktree '${name}' not found. Checking for remote branch...`);

    try {
      // Check if remote branch exists
      await $`git ls-remote --heads origin ${name}`.cwd(this.cwd);
      console.log(`Found remote branch 'origin/${name}'. Creating worktree...`);

      // Fetch latest changes and create worktree from remote tracking ref
      await this.fetchBranch(name);
      const worktreePath = `${this.cwd}/${name}`;

      // Check if local branch already exists
      const localBranchExists = await $`git show-ref --verify refs/heads/${name}`.cwd(this.cwd).nothrow();

      if (localBranchExists.exitCode === 0) {
        // Local branch exists, check it out directly (it will track origin/name)
        await $`git worktree add ${worktreePath} ${name}`.cwd(this.cwd);
        console.log(
          `✅ Created worktree '${name}' from existing branch at ${worktreePath}`,
        );
      } else {
        // Local branch doesn't exist, create it from remote tracking ref
        await $`git worktree add -b ${name} ${worktreePath} origin/${name}`.cwd(this.cwd);
        console.log(
          `✅ Created worktree '${name}' from remote branch at ${worktreePath}`,
        );
      }

      // Set up remote tracking branch in the worktree
      await $`git config branch.${name}.remote origin`.cwd(worktreePath);
      await $`git config branch.${name}.merge refs/heads/${name}`.cwd(worktreePath);

      // Execute post_create hook
      await this.hookManager.executePostCreateHook({
        worktreePath,
        worktreeName: name,
        baseBranch: name, // using the branch name as base branch in this case
        bareRepoPath: this.cwd
      });

      // Switch to the newly created worktree
      process.chdir(worktreePath);
      console.log(`✅ Switched to worktree '${name}' at ${worktreePath}`);
    } catch (remoteError) {
      // Remote branch doesn't exist, show helpful error
      const availableWorktrees = worktrees
        .filter((w) => !w.isBare)
        .map((w) => w.branch);
      throw new Error(
        `Worktree '${name}' not found and no remote branch 'origin/${name}' exists.\n` +
          `Available worktrees: ${availableWorktrees.join(", ")}\n` +
          `To create a new worktree: wtm create ${name} --from <base_branch>`,
      );
    }
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    await this.ensureBareRepo();

    try {
      const result = await $`git worktree list --porcelain`.cwd(this.cwd).quiet();
      const output = result.stdout.toString();

      const worktrees: WorktreeInfo[] = [];
      const blocks = output.split("\n\n").filter((block) => block.trim());

      for (const block of blocks) {
        const lines = block.split("\n");
        const info: Partial<WorktreeInfo> = {};

        for (const line of lines) {
          if (line.startsWith("worktree ")) {
            info.path = line.substring("worktree ".length);
          } else if (line.startsWith("HEAD ")) {
            info.commit = line.substring("HEAD ".length);
          } else if (line.startsWith("branch ")) {
            info.branch = line
              .substring("branch ".length)
              .replace("refs/heads/", "");
          } else if (line === "bare") {
            info.isBare = true;
          }
        }

        if (info.path) {
          worktrees.push({
            path: info.path,
            commit: info.commit || "unknown",
            branch: info.branch || (info.isBare ? "(bare)" : "detached"),
            isBare: info.isBare,
          });
        }
      }

      return worktrees;
    } catch (error) {
      throw new Error(`Failed to list worktrees: ${error}`);
    }
  }

  async deleteWorktree(name: string, force: boolean = false): Promise<void> {
    await this.ensureBareRepo();

    const worktrees = await this.listWorktrees();
    const worktree = worktrees.find(
      (w) => w.path.endsWith(`/${name}`) || w.branch === name,
    );

    if (!worktree) {
      throw new Error(`Worktree '${name}' not found`);
    }

    if (worktree.isBare) {
      throw new Error(`Cannot delete bare repository`);
    }

    try {
      const forceFlag = force ? "--force" : "";
      await $`git worktree remove ${worktree.path} ${forceFlag}`.cwd(this.cwd);
      console.log(`✅ Deleted worktree '${name}' at ${worktree.path}`);
    } catch (error) {
      throw new Error(
        `Failed to delete worktree: ${error}. Try using --force flag.`,
      );
    }
  }

  printWorktrees(worktrees: WorktreeInfo[]): void {
    if (worktrees.length === 0) {
      console.log("No worktrees found");
      return;
    }

    console.log("\nWorktrees:");
    console.log("─".repeat(80));

    for (const worktree of worktrees) {
      const pathParts = worktree.path.split("/");
      const name = pathParts[pathParts.length - 1];
      const status = worktree.isBare ? "(bare)" : `[${worktree.branch}]`;
      const commit = worktree.commit.substring(0, 9);

      console.log(`${name.padEnd(30)} ${status.padEnd(20)} ${commit}`);
    }
  }
}

