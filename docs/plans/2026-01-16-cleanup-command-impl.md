# Cleanup Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `wtm cleanup` command that identifies and removes worktrees whose branches have been merged upstream.

**Architecture:** New `CleanupManager` class in `src/cleanup.ts` handles detection logic. Reuses `WorktreeManager` for listing/deleting. Uses `@inquirer/prompts` for interactive UI.

**Tech Stack:** Bun, TypeScript, @inquirer/prompts, Bun shell ($)

---

### Task 1: Add @inquirer/prompts dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run: `bun add @inquirer/prompts`

**Step 2: Verify installation**

Run: `cat package.json | grep inquirer`
Expected: `"@inquirer/prompts": "^x.x.x"` in dependencies

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add @inquirer/prompts dependency"
```

---

### Task 2: Create CleanupManager class with types and constructor

**Files:**
- Create: `src/cleanup.ts`

**Step 1: Create the file with types and basic structure**

```typescript
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
}
```

**Step 2: Verify it compiles**

Run: `bun build src/cleanup.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cleanup.ts
git commit -m "feat(cleanup): add CleanupManager class with types"
```

---

### Task 3: Implement getBaseBranch method

**Files:**
- Modify: `src/cleanup.ts`

**Step 1: Add getBaseBranch method to CleanupManager class**

Add after the constructor:

```typescript
  async getBaseBranch(): Promise<string> {
    try {
      // Try to get the default branch from origin/HEAD
      const result = await $`git symbolic-ref refs/remotes/origin/HEAD`
        .cwd(this.cwd)
        .quiet()
        .nothrow();

      if (result.exitCode === 0) {
        const ref = result.stdout.toString().trim();
        // refs/remotes/origin/main -> main
        return ref.replace("refs/remotes/origin/", "");
      }
    } catch {
      // Fall through to default
    }

    // Fallback: check for common default branches
    for (const branch of ["main", "master"]) {
      const exists = await $`git show-ref --verify refs/remotes/origin/${branch}`
        .cwd(this.cwd)
        .quiet()
        .nothrow();
      if (exists.exitCode === 0) {
        return branch;
      }
    }

    throw new Error(
      "Could not detect base branch. Use --base <branch> to specify."
    );
  }
```

**Step 2: Verify it compiles**

Run: `bun build src/cleanup.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cleanup.ts
git commit -m "feat(cleanup): add getBaseBranch method"
```

---

### Task 4: Implement isMerged method

**Files:**
- Modify: `src/cleanup.ts`

**Step 1: Add isMerged method**

Add after getBaseBranch:

```typescript
  private async isMerged(
    candidate: CleanupCandidate,
    baseBranch: string
  ): Promise<boolean> {
    // Check if remote branch still exists - if deleted, it was likely merged
    const remoteExists = await $`git ls-remote --heads origin ${candidate.branch}`
      .cwd(this.cwd)
      .quiet()
      .nothrow();

    if (remoteExists.stdout.toString().trim() === "") {
      // Remote branch was deleted, likely merged
      return true;
    }

    // Check if branch commit is ancestor of base (covers regular merges)
    const isAncestor = await $`git merge-base --is-ancestor ${candidate.commit} origin/${baseBranch}`
      .cwd(this.cwd)
      .quiet()
      .nothrow();

    return isAncestor.exitCode === 0;
  }
```

**Step 2: Verify it compiles**

Run: `bun build src/cleanup.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cleanup.ts
git commit -m "feat(cleanup): add isMerged method"
```

---

### Task 5: Implement hasUncommittedChanges method

**Files:**
- Modify: `src/cleanup.ts`

**Step 1: Add hasUncommittedChanges method**

Add after isMerged:

```typescript
  private async hasUncommittedChanges(
    candidate: CleanupCandidate
  ): Promise<boolean> {
    // Check for unstaged changes
    const unstaged = await $`git -C ${candidate.path} diff --quiet`
      .quiet()
      .nothrow();
    if (unstaged.exitCode !== 0) return true;

    // Check for staged changes
    const staged = await $`git -C ${candidate.path} diff --cached --quiet`
      .quiet()
      .nothrow();
    if (staged.exitCode !== 0) return true;

    // Check for untracked files
    const untracked = await $`git -C ${candidate.path} ls-files --others --exclude-standard`
      .quiet()
      .nothrow();
    if (untracked.stdout.toString().trim() !== "") return true;

    return false;
  }
```

**Step 2: Verify it compiles**

Run: `bun build src/cleanup.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cleanup.ts
git commit -m "feat(cleanup): add hasUncommittedChanges method"
```

---

### Task 6: Implement hasUnpushedCommits method

**Files:**
- Modify: `src/cleanup.ts`

**Step 1: Add hasUnpushedCommits method**

Add after hasUncommittedChanges:

```typescript
  private async hasUnpushedCommits(
    candidate: CleanupCandidate,
    baseBranch: string
  ): Promise<boolean> {
    // Check if there are local commits not reachable from base branch
    const unpushed = await $`git -C ${candidate.path} log origin/${baseBranch}..HEAD --oneline`
      .quiet()
      .nothrow();

    return unpushed.stdout.toString().trim() !== "";
  }
```

**Step 2: Verify it compiles**

Run: `bun build src/cleanup.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cleanup.ts
git commit -m "feat(cleanup): add hasUnpushedCommits method"
```

---

### Task 7: Implement findCandidates method

**Files:**
- Modify: `src/cleanup.ts`

**Step 1: Add findCandidates method**

Add after hasUnpushedCommits:

```typescript
  async findCandidates(baseBranch: string): Promise<CleanupCandidate[]> {
    const worktrees = await this.worktreeManager.listWorktrees();
    const candidates: CleanupCandidate[] = [];

    for (const wt of worktrees) {
      // Skip bare repo and protected branches
      if (wt.isBare) continue;
      if (PROTECTED_BRANCHES.includes(wt.branch)) continue;

      const name = wt.path.split("/").pop() || wt.path;
      const candidate: CleanupCandidate = {
        path: wt.path,
        name,
        branch: wt.branch,
        commit: wt.commit,
      };

      process.stdout.write(`  Checking ${name}...\r`);

      const [merged, uncommitted, unpushed] = await Promise.all([
        this.isMerged(candidate, baseBranch),
        this.hasUncommittedChanges(candidate),
        this.hasUnpushedCommits(candidate, baseBranch),
      ]);

      if (merged && !uncommitted && !unpushed) {
        candidates.push(candidate);
      }
    }

    // Clear the progress line
    process.stdout.write(" ".repeat(60) + "\r");

    return candidates;
  }
```

**Step 2: Verify it compiles**

Run: `bun build src/cleanup.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cleanup.ts
git commit -m "feat(cleanup): add findCandidates method"
```

---

### Task 8: Implement run method (main entry point)

**Files:**
- Modify: `src/cleanup.ts`

**Step 1: Add run method**

Add after findCandidates:

```typescript
  async run(options: CleanupOptions = {}): Promise<void> {
    await this.worktreeManager.ensureBareRepo();

    // Determine base branch
    const baseBranch = options.baseBranch || (await this.getBaseBranch());
    console.log(`\nWorktree Cleanup`);
    console.log(`Base branch: ${baseBranch}${options.baseBranch ? "" : " (auto-detected)"}\n`);

    // Fetch latest from base branch
    console.log(`Fetching latest from origin/${baseBranch}...`);
    await $`git fetch origin ${baseBranch}`.cwd(this.cwd).quiet().nothrow();

    // Find candidates
    console.log("Analyzing worktrees...\n");
    const candidates = await this.findCandidates(baseBranch);

    if (candidates.length === 0) {
      console.log("No worktrees found that are merged and clean.");
      return;
    }

    console.log(
      `Found ${candidates.length} worktree${candidates.length === 1 ? "" : "s"} safe to delete:\n`
    );

    for (const c of candidates) {
      console.log(`  - ${c.name} [${c.branch}]`);
    }
    console.log();

    // Dry run - just show what would be deleted
    if (options.dryRun) {
      console.log("Dry run - no worktrees were deleted.");
      return;
    }

    let toDelete: CleanupCandidate[];

    if (options.yes) {
      // Non-interactive mode - delete all
      toDelete = candidates;
    } else {
      // Interactive selection
      const selected = await checkbox({
        message: "Select worktrees to delete",
        choices: candidates.map((c) => ({
          name: `${c.name} [${c.branch}]`,
          value: c,
          checked: false,
        })),
        pageSize: 20,
        loop: false,
      });

      if (selected.length === 0) {
        console.log("\nNo worktrees selected. Cancelled.");
        return;
      }

      console.log(`\nSelected ${selected.length} worktree${selected.length === 1 ? "" : "s"} for deletion:\n`);
      for (const c of selected) {
        console.log(`  - ${c.name}`);
      }
      console.log();

      const confirmed = await confirm({
        message: `Delete ${selected.length === 1 ? "this worktree" : `these ${selected.length} worktrees`}?`,
        default: false,
      });

      if (!confirmed) {
        console.log("\nCancelled.");
        return;
      }

      toDelete = selected;
    }

    // Delete selected worktrees
    console.log("\nDeleting worktrees...\n");

    for (const c of toDelete) {
      process.stdout.write(`  Deleting ${c.name}...`);
      try {
        await this.worktreeManager.deleteWorktree(c.name, true);
        console.log(" done");
      } catch {
        console.log(" failed");
      }
    }

    // Prune stale entries
    console.log("\nPruning stale worktree entries...");
    await $`git worktree prune`.cwd(this.cwd).quiet();

    console.log("Cleanup complete!");
  }
```

**Step 2: Verify it compiles**

Run: `bun build src/cleanup.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cleanup.ts
git commit -m "feat(cleanup): add run method as main entry point"
```

---

### Task 9: Export WorktreeManager.ensureBareRepo as public

**Files:**
- Modify: `src/worktree.ts`

**Step 1: Verify ensureBareRepo is already public**

Check line ~20 of worktree.ts - ensureBareRepo should already be public (no `private` keyword).

If it has `private`, remove the `private` keyword.

**Step 2: Export WorktreeInfo type**

The type is already defined as `export interface WorktreeInfo` - no change needed.

**Step 3: Commit (only if changes were made)**

```bash
git add src/worktree.ts
git commit -m "refactor: ensure WorktreeManager methods are accessible"
```

---

### Task 10: Wire up cleanup command in CLI

**Files:**
- Modify: `src/cli.ts`

**Step 1: Add import**

At the top of the file, add:

```typescript
import { CleanupManager } from './cleanup';
```

**Step 2: Add cleanup case to switch statement**

In the `runCommand` function, add a new case before `case 'help'`:

```typescript
      case 'cleanup':
        await handleCleanup(args, flags);
        break;
```

**Step 3: Add handleCleanup function**

Add after `handleDelete`:

```typescript
async function handleCleanup(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const manager = new CleanupManager();

  await manager.run({
    baseBranch: flags.base as string | undefined,
    dryRun: !!flags['dry-run'],
    yes: !!flags.yes,
  });
}
```

**Step 4: Update help text**

In `printHelp`, add cleanup to COMMANDS section:

```typescript
  cleanup [--base <branch>] [--yes] [--dry-run]  Clean up merged worktrees
```

And add to EXAMPLES:

```typescript
  wtm cleanup                            Find and delete merged worktrees
  wtm cleanup --base main                Use 'main' as the base branch
  wtm cleanup --dry-run                  Show what would be deleted
  wtm cleanup --yes                      Delete all merged worktrees without prompting
```

**Step 5: Verify it compiles**

Run: `bun run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cleanup): wire up cleanup command in CLI"
```

---

### Task 11: Manual verification

**Step 1: Build the project**

Run: `bun run build`
Expected: Builds successfully

**Step 2: Test help output**

Run: `./dist/index.js help`
Expected: Shows cleanup command in help

**Step 3: Test cleanup command (dry run)**

Run: `./dist/index.js cleanup --dry-run`
Expected: Shows any merged worktrees (or "No worktrees found")

**Step 4: Commit final changes if needed**

```bash
git add -A
git commit -m "feat: complete cleanup command implementation"
```
