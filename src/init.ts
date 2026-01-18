import { $ } from "bun";

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
