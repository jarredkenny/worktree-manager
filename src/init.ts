import { $ } from "bun";
import { readdir, rename, cp, rm, stat, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

export class InitManager {
  /**
   * Extract repository name from various Git URL formats.
   * Handles: git@host:org/repo.git, https://host/org/repo.git, ssh://git@host/org/repo.git
   * Returns the repo name without .git suffix.
   */
  extractRepoName(url: string): string {
    // Remove trailing slashes
    let cleaned = url.replace(/\/+$/, "");

    // Remove .git suffix if present
    cleaned = cleaned.replace(/\.git$/, "");

    // Extract last path segment - handles both : and / separators
    // git@github.com:org/repo -> repo
    // https://github.com/org/repo -> repo
    // ssh://git@github.com/org/repo -> repo
    const match = cleaned.match(/[/:]([\w.-]+)$/);
    if (!match) {
      throw new Error(`Could not extract repository name from URL: ${url}`);
    }

    return match[1];
  }

  /**
   * Detect the default branch from origin/HEAD or fall back to main/master.
   */
  private async detectDefaultBranch(gitDir: string): Promise<string> {
    // Try to get the default branch from origin/HEAD
    try {
      const result =
        await $`git --git-dir=${gitDir} symbolic-ref refs/remotes/origin/HEAD`
          .quiet()
          .text();
      // Result is like "refs/remotes/origin/main"
      const branch = result.trim().replace("refs/remotes/origin/", "");
      if (branch) {
        return branch;
      }
    } catch {
      // origin/HEAD not set, fall through to check main/master
    }

    // Check if main branch exists
    try {
      await $`git --git-dir=${gitDir} rev-parse --verify refs/remotes/origin/main`.quiet();
      return "main";
    } catch {
      // main doesn't exist
    }

    // Check if master branch exists
    try {
      await $`git --git-dir=${gitDir} rev-parse --verify refs/remotes/origin/master`.quiet();
      return "master";
    } catch {
      // master doesn't exist
    }

    throw new Error(
      "Could not detect default branch. Neither origin/HEAD, main, nor master found."
    );
  }

  /**
   * Create a template post_create hook script.
   */
  private async createPostCreateHook(targetDir: string): Promise<void> {
    const hookPath = `${targetDir}/post_create`;
    const hookContent = `#!/bin/bash
# wtm post_create hook
# Runs after each worktree is created, with cwd set to the new worktree.
#
# Available environment variables:
#   WORKTREE_DIR   - Absolute path to the new worktree
#   WORKTREE_NAME  - Name of the worktree
#   BASE_BRANCH    - Branch the worktree was created from
#   BARE_REPO_PATH - Path to the bare repository

echo "Setting up worktree: $WORKTREE_NAME"

# Example: Install dependencies
# if [ -f "package.json" ]; then
#     pnpm install
# fi

# Example: Copy environment files
# cp "$BARE_REPO_PATH/.env.example" ".env"
`;

    await Bun.write(hookPath, hookContent);
    await $`chmod +x ${hookPath}`.quiet();
  }

  /**
   * Create the initial worktree for the default branch.
   */
  private async createInitialWorktree(
    targetDir: string,
    defaultBranch: string
  ): Promise<void> {
    const gitDir = `${targetDir}/.git`;
    const worktreePath = `${targetDir}/${defaultBranch}`;

    try {
      await $`git --git-dir=${gitDir} worktree add ${worktreePath} origin/${defaultBranch}`.quiet();
      console.log(`Created initial worktree: ${defaultBranch}`);
    } catch (error) {
      console.warn(
        `Warning: Could not create initial worktree for ${defaultBranch}`
      );
      if (error instanceof Error) {
        console.warn(`  ${error.message}`);
      }
    }
  }

  /**
   * Adopt an existing git repository into wtm-managed bare structure.
   */
  async adopt(path?: string): Promise<void> {
    const targetDir = resolve(path ?? process.cwd());
    const gitDir = join(targetDir, ".git");

    // --- Validation (no filesystem changes) ---
    await this.validateForAdopt(targetDir, gitDir);

    const currentBranch = (
      await $`git branch --show-current`.cwd(targetDir).quiet().text()
    ).trim();

    const defaultBranch = await this.detectDefaultBranch(gitDir);

    console.log(`Adopting repository: ${targetDir}`);
    console.log(`Current branch: ${currentBranch}`);
    console.log(`Default branch: ${defaultBranch}`);

    // --- Conversion (with error recovery) ---
    await this.convertToBare(targetDir, gitDir, currentBranch);

    // Create post_create hook (skip if exists)
    const hookPath = join(targetDir, "post_create");
    const hookExists = await Bun.file(hookPath).exists();
    if (!hookExists) {
      await this.createPostCreateHook(targetDir);
      console.log("Created post_create hook template");
    }

    // Success output
    const worktreePath = join(targetDir, currentBranch);
    console.log("");
    console.log("Repository adopted successfully!");
    console.log("");
    console.log(`Your code is now at: ${worktreePath}`);
    console.log(`Bare repository at:  ${gitDir}`);
    console.log("");
    console.log("Next steps:");
    console.log(`  cd ${currentBranch}`);
    console.log(`  wtm create <name> --from ${currentBranch}`);
    console.log("  wtm list");
  }

  private async validateForAdopt(
    targetDir: string,
    gitDir: string
  ): Promise<void> {
    // 1. Confirm .git/ exists as a directory (not a file)
    try {
      const gitStat = await stat(gitDir);
      if (!gitStat.isDirectory()) {
        throw new Error(
          "Not a git repository — .git is a file (this is already a worktree)."
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes(".git is a file")) {
        throw err;
      }
      throw new Error(
        `Not a git repository: ${targetDir} (no .git directory found)`
      );
    }

    // 2. Confirm not already bare
    try {
      const bareResult = await $`git config --get core.bare`
        .cwd(targetDir)
        .quiet()
        .text();
      if (bareResult.trim() === "true") {
        throw new Error(
          "This is already a bare repository. If it's wtm-managed, use wtm commands directly."
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("already a bare")) {
        throw err;
      }
      // core.bare not set means it's not bare — continue
    }

    // 3. Confirm remote exists
    try {
      await $`git remote get-url origin`.cwd(targetDir).quiet();
    } catch {
      throw new Error(
        "No remote 'origin' found. wtm requires a remote to function. Add one with: git remote add origin <url>"
      );
    }

    // 4. Confirm clean working tree
    const unstaged = await $`git diff --quiet`.cwd(targetDir).quiet().nothrow();
    const staged = await $`git diff --cached --quiet`
      .cwd(targetDir)
      .quiet()
      .nothrow();
    if (unstaged.exitCode !== 0 || staged.exitCode !== 0) {
      throw new Error(
        "Working tree has uncommitted changes. Please commit or stash before running wtm init."
      );
    }

    // 5. Check for existing worktrees
    const worktreeOutput = await $`git worktree list --porcelain`
      .cwd(targetDir)
      .quiet()
      .text();
    const worktreeBlocks = worktreeOutput
      .split("\n\n")
      .filter((b) => b.trim());
    if (worktreeBlocks.length > 1) {
      throw new Error(
        "Repository has existing worktrees. Please remove them before running wtm init."
      );
    }

    // 6. Confirm not detached HEAD
    const branchName = (
      await $`git branch --show-current`.cwd(targetDir).quiet().text()
    ).trim();
    if (!branchName) {
      throw new Error(
        "HEAD is detached. Please checkout a branch before running wtm init."
      );
    }

    // 7. Check for stale temp dir
    const tmpDir = join(targetDir, ".wtm-adopt-tmp");
    try {
      await stat(tmpDir);
      // stat succeeded — dir exists, which is a problem
      throw new Error(
        "Found .wtm-adopt-tmp/ — a previous adopt may have failed. Please inspect and remove it manually."
      );
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.startsWith("Found .wtm-adopt-tmp/")
      ) {
        throw err;
      }
      // ENOENT or similar — dir doesn't exist, good
    }
  }

  private async convertToBare(
    targetDir: string,
    gitDir: string,
    currentBranch: string
  ): Promise<void> {
    const tmpDir = join(targetDir, ".wtm-adopt-tmp");
    const worktreePath = join(targetDir, currentBranch);
    let bareSet = false;
    let worktreeCreated = false;

    try {
      // 1. Collect and move non-git entries to temp dir
      await mkdir(tmpDir);
      const entries = await readdir(targetDir);
      for (const entry of entries) {
        if (entry === ".git" || entry === ".wtm-adopt-tmp") continue;
        await rename(join(targetDir, entry), join(tmpDir, entry));
      }

      // 2. Set bare
      await $`git config core.bare true`.cwd(targetDir).quiet();
      bareSet = true;

      // 3. Configure fetch refspec (no-op for most clones, consistency guarantee)
      await $`git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"`
        .cwd(targetDir)
        .quiet();

      // 4. Fetch
      await $`git --git-dir=${gitDir} fetch origin`.quiet();

      // 5. Create worktree using LOCAL branch (preserves unpushed commits)
      await $`git --git-dir=${gitDir} worktree add ${worktreePath} ${currentBranch}`.quiet();
      worktreeCreated = true;

      // 6. Restore non-tracked files (no-clobber recursive copy)
      await cp(tmpDir, worktreePath, { recursive: true, force: false });

      // 7. Remove temp dir
      await rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Error recovery: revert to original state
      console.error("Adopt failed, reverting changes...");

      if (worktreeCreated) {
        await $`git --git-dir=${gitDir} worktree remove ${worktreePath} --force`
          .quiet()
          .nothrow();
        await rm(worktreePath, { recursive: true, force: true }).catch(
          () => {}
        );
      }

      if (bareSet) {
        await $`git config core.bare false`.cwd(targetDir).quiet().nothrow();
      }

      // Move files back from temp
      try {
        const tmpEntries = await readdir(tmpDir);
        for (const entry of tmpEntries) {
          await rename(join(tmpDir, entry), join(targetDir, entry));
        }
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // Temp dir may not exist if failure was before the move
      }

      throw new Error(
        `Failed to adopt repository: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  /**
   * Initialize a new wtm-managed bare repository.
   * Main entry point.
   */
  async run(url: string, path?: string): Promise<void> {
    // Determine target directory
    const targetDir = path ?? this.extractRepoName(url);
    const gitDir = `${targetDir}/.git`;

    // Check if directory already exists
    const exists = await Bun.file(targetDir).exists();
    if (exists) {
      throw new Error(`Directory already exists: ${targetDir}`);
    }

    console.log(`Initializing wtm repository: ${targetDir}`);

    // Create the directory
    await $`mkdir -p ${targetDir}`.quiet();

    // Clone as bare repository into .git subdirectory
    console.log(`Cloning ${url}...`);
    await $`git clone --bare ${url} ${gitDir}`;

    // Configure fetch refspec to get all branches
    await $`git --git-dir=${gitDir} config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"`.quiet();

    // Fetch all branches
    console.log("Fetching all branches...");
    await $`git --git-dir=${gitDir} fetch origin`.quiet();

    // Create template post_create hook
    await this.createPostCreateHook(targetDir);
    console.log("Created post_create hook template");

    // Detect default branch
    const defaultBranch = await this.detectDefaultBranch(gitDir);
    console.log(`Detected default branch: ${defaultBranch}`);

    // Create initial worktree
    await this.createInitialWorktree(targetDir, defaultBranch);

    // Print success message with next steps
    console.log("");
    console.log("Repository initialized successfully!");
    console.log("");
    console.log("Next steps:");
    console.log(`  cd ${targetDir}/${defaultBranch}`);
    console.log("  wtm create <branch-name>    # Create a new worktree");
    console.log("  wtm list                    # List all worktrees");
    console.log("");
    console.log(
      `Customize ${targetDir}/post_create to run setup commands after worktree creation.`
    );
  }
}
