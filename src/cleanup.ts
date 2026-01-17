import { $ } from "bun";
import { checkbox, confirm } from "@inquirer/prompts";
import { WorktreeManager, type WorktreeInfo } from "./worktree";

export interface CleanupCandidate {
  path: string;
  name: string;
  branch: string;
  commit: string;
}

export interface CleanupOptions {
  baseBranch?: string;
  dryRun?: boolean;
  yes?: boolean;
}

const PROTECTED_BRANCHES = ["main", "master", "next", "prerelease"];

export class CleanupManager {
  private cwd: string;
  private worktreeManager: WorktreeManager;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.worktreeManager = new WorktreeManager(cwd);
  }

  /**
   * Auto-detect base branch from origin/HEAD, fallback to main/master
   */
  async getBaseBranch(): Promise<string> {
    // Try to get the default branch from origin/HEAD
    try {
      const result = await $`git symbolic-ref refs/remotes/origin/HEAD`
        .cwd(this.cwd)
        .quiet();
      const ref = result.stdout.toString().trim();
      // ref looks like "refs/remotes/origin/main"
      const branch = ref.replace("refs/remotes/origin/", "");
      if (branch) {
        return branch;
      }
    } catch {
      // origin/HEAD not set, try fallbacks
    }

    // Check for main
    try {
      const mainResult = await $`git show-ref --verify refs/remotes/origin/main`
        .cwd(this.cwd)
        .quiet()
        .nothrow();
      if (mainResult.exitCode === 0) {
        return "main";
      }
    } catch {
      // main doesn't exist
    }

    // Check for master
    try {
      const masterResult = await $`git show-ref --verify refs/remotes/origin/master`
        .cwd(this.cwd)
        .quiet()
        .nothrow();
      if (masterResult.exitCode === 0) {
        return "master";
      }
    } catch {
      // master doesn't exist
    }

    throw new Error(
      "Could not detect base branch. No origin/HEAD, main, or master found. " +
        "Please specify a base branch with --base <branch>"
    );
  }

  /**
   * Check if branch is merged: commit is ancestor of origin/base OR remote branch deleted
   */
  private async isMerged(
    candidate: CleanupCandidate,
    baseBranch: string
  ): Promise<boolean> {
    // Check if remote branch still exists
    try {
      const remoteResult = await $`git ls-remote --heads origin ${candidate.branch}`
        .cwd(this.cwd)
        .quiet();
      const remoteOutput = remoteResult.stdout.toString().trim();

      // If remote branch is deleted (empty result), consider it merged
      if (!remoteOutput) {
        return true;
      }
    } catch {
      // Error checking remote - assume branch exists
    }

    // Check if commit is ancestor of base branch
    try {
      const result = await $`git merge-base --is-ancestor ${candidate.commit} origin/${baseBranch}`
        .cwd(this.cwd)
        .quiet()
        .nothrow();
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Check for unstaged, staged changes, and untracked files
   */
  private async hasUncommittedChanges(
    candidate: CleanupCandidate
  ): Promise<boolean> {
    // Check for unstaged changes
    try {
      const unstaged = await $`git -C ${candidate.path} diff --quiet`
        .quiet()
        .nothrow();
      if (unstaged.exitCode !== 0) {
        return true;
      }
    } catch {
      return true;
    }

    // Check for staged changes
    try {
      const staged = await $`git -C ${candidate.path} diff --cached --quiet`
        .quiet()
        .nothrow();
      if (staged.exitCode !== 0) {
        return true;
      }
    } catch {
      return true;
    }

    // Check for untracked files
    try {
      const untracked =
        await $`git -C ${candidate.path} ls-files --others --exclude-standard`
          .quiet();
      const untrackedOutput = untracked.stdout.toString().trim();
      if (untrackedOutput) {
        return true;
      }
    } catch {
      return true;
    }

    return false;
  }

  /**
   * Check if there are local commits not reachable from origin/base
   */
  private async hasUnpushedCommits(
    candidate: CleanupCandidate,
    baseBranch: string
  ): Promise<boolean> {
    try {
      const result =
        await $`git -C ${candidate.path} log origin/${baseBranch}..HEAD --oneline`
          .quiet();
      const output = result.stdout.toString().trim();
      return output.length > 0;
    } catch {
      // If we can't check, assume there are unpushed commits to be safe
      return true;
    }
  }

  /**
   * Find all worktrees that are safe to delete (merged, clean, no unpushed)
   */
  async findCandidates(baseBranch: string): Promise<CleanupCandidate[]> {
    const worktrees = await this.worktreeManager.listWorktrees();
    const candidates: CleanupCandidate[] = [];

    // Filter out bare repo and protected branches
    const checkable = worktrees.filter((w) => {
      if (w.isBare) return false;
      if (PROTECTED_BRANCHES.includes(w.branch)) return false;
      return true;
    });

    if (checkable.length === 0) {
      return [];
    }

    for (let i = 0; i < checkable.length; i++) {
      const worktree = checkable[i];
      const pathParts = worktree.path.split("/");
      const name = pathParts[pathParts.length - 1];

      process.stdout.write(
        `\rChecking worktree ${i + 1}/${checkable.length}: ${name}...`
      );

      const candidate: CleanupCandidate = {
        path: worktree.path,
        name,
        branch: worktree.branch,
        commit: worktree.commit,
      };

      // Run all checks in parallel
      const [merged, uncommitted, unpushed] = await Promise.all([
        this.isMerged(candidate, baseBranch),
        this.hasUncommittedChanges(candidate),
        this.hasUnpushedCommits(candidate, baseBranch),
      ]);

      // Only include if merged, has no uncommitted changes, and no unpushed commits
      if (merged && !uncommitted && !unpushed) {
        candidates.push(candidate);
      }
    }

    // Clear the progress line
    process.stdout.write("\r" + " ".repeat(60) + "\r");

    return candidates;
  }

  /**
   * Main entry point - handles interactive/non-interactive flow
   */
  async run(options: CleanupOptions = {}): Promise<void> {
    await this.worktreeManager.ensureBareRepo();

    // Get base branch
    const baseBranch = options.baseBranch ?? (await this.getBaseBranch());
    console.log(`Using base branch: ${baseBranch}`);

    // Fetch latest from origin/base
    console.log(`Fetching latest from origin/${baseBranch}...`);
    try {
      await $`git fetch origin ${baseBranch}`.cwd(this.cwd).quiet();
    } catch (error) {
      throw new Error(`Failed to fetch origin/${baseBranch}: ${error}`);
    }

    // Find candidates
    console.log("Scanning worktrees for cleanup candidates...");
    const candidates = await this.findCandidates(baseBranch);

    if (candidates.length === 0) {
      console.log("No worktrees found that are safe to clean up.");
      console.log(
        "Worktrees are kept if they have uncommitted changes, unpushed commits, or unmerged branches."
      );
      return;
    }

    console.log(`\nFound ${candidates.length} worktree(s) safe to clean up:`);
    for (const candidate of candidates) {
      console.log(`  - ${candidate.name} [${candidate.branch}]`);
    }

    // Dry run - just list and return
    if (options.dryRun) {
      console.log("\nDry run mode - no worktrees were deleted.");
      return;
    }

    let toDelete: CleanupCandidate[];

    if (options.yes) {
      // Non-interactive mode - delete all candidates
      toDelete = candidates;
    } else {
      // Interactive mode - let user select which to delete
      console.log("");
      const selected = await checkbox({
        message: "Select worktrees to delete:",
        choices: candidates.map((c) => ({
          name: `${c.name} [${c.branch}]`,
          value: c,
          checked: true,
        })),
      });

      if (selected.length === 0) {
        console.log("No worktrees selected for deletion.");
        return;
      }

      const confirmed = await confirm({
        message: `Delete ${selected.length} worktree(s)?`,
        default: false,
      });

      if (!confirmed) {
        console.log("Cleanup cancelled.");
        return;
      }

      toDelete = selected;
    }

    // Delete selected worktrees
    console.log("");
    for (const candidate of toDelete) {
      try {
        await this.worktreeManager.deleteWorktree(candidate.name, true);
      } catch (error) {
        console.error(`Failed to delete ${candidate.name}: ${error}`);
      }
    }

    // Prune worktree references
    try {
      await $`git worktree prune`.cwd(this.cwd).quiet();
      console.log("Pruned stale worktree references.");
    } catch {
      // Prune failed, not critical
    }

    console.log(`\nCleanup complete. Deleted ${toDelete.length} worktree(s).`);
  }
}
