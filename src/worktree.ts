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

  async fetchBranch(branch: string): Promise<void> {
    try {
      // Fetch the remote branch
      await $`git fetch origin ${branch}`.cwd(this.cwd);
      
      // Get the latest commit hash from the remote
      const remoteCommit = await $`git ls-remote origin ${branch}`.cwd(this.cwd);
      const commitHash = remoteCommit.stdout.toString().split('\t')[0];
      console.log(`Remote ${branch} is at: ${commitHash}`);
      
      // Check if local branch exists and update it
      try {
        await $`git show-ref --verify refs/heads/${branch}`.cwd(this.cwd);
        console.log(`Local branch ${branch} exists, updating to match remote`);
        // Local branch exists, force reset it to match the remote commit
        await $`git update-ref refs/heads/${branch} ${commitHash}`.cwd(this.cwd);
        
        // Verify the update worked
        const updatedRef = await $`git show-ref refs/heads/${branch}`.cwd(this.cwd);
        console.log(`Updated local branch: ${updatedRef.stdout}`);
      } catch {
        console.log(`Local branch ${branch} doesn't exist, creating from remote`);
        // Local branch doesn't exist, create it pointing to the remote commit
        await $`git update-ref refs/heads/${branch} ${commitHash}`.cwd(this.cwd);
        console.log(`Created local branch ${branch} at: ${commitHash}`);
      }
    } catch (error) {
      console.warn(
        `Warning: Could not fetch branch ${branch}. Error: ${error}. Proceeding with existing refs.`,
      );
    }
  }

  async createWorktree(name: string, baseBranch: string): Promise<void> {
    await this.ensureBareRepo();

    await this.fetchBranch(baseBranch);

    const worktreePath = `${this.cwd}/${name}`;

    try {
      await $`git worktree add -b ${name} ${worktreePath} origin/${baseBranch}`.cwd(
        this.cwd,
      );
      console.log(
        `✅ Created worktree '${name}' based on '${baseBranch}' at ${worktreePath}`,
      );
      
      // Set up remote tracking branch in the worktree
      try {
        await $`git config branch.${name}.remote origin`.cwd(worktreePath);
        await $`git config branch.${name}.merge refs/heads/${name}`.cwd(worktreePath);
        await $`git fetch origin ${name}:refs/remotes/origin/${name}`.cwd(worktreePath);
      } catch {
        console.warn(`Warning: Could not set up remote tracking for branch ${name}`);
      }
    } catch (error) {
      try {
        await $`git worktree add -b ${name} ${worktreePath} ${baseBranch}`.cwd(
          this.cwd,
        );
        console.log(
          `✅ Created worktree '${name}' based on '${baseBranch}' at ${worktreePath}`,
        );
      } catch {
        throw new Error(`Failed to create worktree: ${error}`);
      }
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

      // Check if local branch already exists
      try {
        await $`git show-ref --verify refs/heads/${name}`.cwd(this.cwd);
        // Local branch exists, fetch latest changes and create worktree from it
        await this.fetchBranch(name);
        const worktreePath = `${this.cwd}/${name}`;
        await $`git worktree add ${worktreePath} ${name}`.cwd(this.cwd);
        
        // Set up remote tracking branch in the worktree
        await $`git config branch.${name}.remote origin`.cwd(worktreePath);
        await $`git config branch.${name}.merge refs/heads/${name}`.cwd(worktreePath);
        await $`git fetch origin ${name}:refs/remotes/origin/${name}`.cwd(worktreePath);
        
        console.log(
          `✅ Created worktree '${name}' from existing local branch at ${worktreePath}`,
        );

        // Execute post_create hook
        await this.hookManager.executePostCreateHook({
          worktreePath,
          worktreeName: name,
          baseBranch: name, // using the branch name as base branch in this case
          bareRepoPath: this.cwd
        });
      } catch {
        // Local branch doesn't exist, create worktree with new branch from remote
        await this.createWorktree(name, name);
      }

      // Switch to the newly created worktree
      const worktreePath = `${this.cwd}/${name}`;
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

