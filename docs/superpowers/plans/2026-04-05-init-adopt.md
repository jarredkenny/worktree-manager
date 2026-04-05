# Init Adopt Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `wtm init` to adopt an existing git repo into wtm's bare-repo-with-worktrees structure.

**Architecture:** New `adopt()` method on `InitManager` handles validation (9 checks) and conversion (temp-dir-based file shuffling + `git worktree add`). `handleInit` in `cli.ts` gains routing logic to detect existing-directory-vs-URL. Integration tests use disposable git repos in temp directories.

**Tech Stack:** Bun runtime, Bun shell (`$`), Bun test runner, `node:fs/promises`, `node:path`, `node:os`

**Spec:** `docs/superpowers/specs/2026-04-05-init-adopt-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/init.ts` | Modify | Add `adopt()` method and private helpers for validation/conversion/recovery |
| `src/cli.ts` | Modify | Update `handleInit` routing and `printHelp` text |
| `tests/helpers.ts` | Create | Test fixtures: `createTempRepo()`, `cleanup()` |
| `tests/adopt.test.ts` | Create | All integration tests for adopt flow |

---

### Task 1: Test Helpers

**Files:**
- Create: `tests/helpers.ts`

- [ ] **Step 1: Create test helper module**

```typescript
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempRepo {
  /** Path to the cloned working repo (the one to adopt) */
  repoPath: string;
  /** Path to the bare repo used as "origin" */
  remotePath: string;
  /** Parent temp directory (cleanup this) */
  tmpDir: string;
}

/**
 * Creates a disposable git repo with a local bare "remote".
 * Structure:
 *   <tmpDir>/remote.git  — bare repo acting as origin
 *   <tmpDir>/repo        — normal clone to be adopted
 */
export async function createTempRepo(): Promise<TempRepo> {
  const tmpDir = await mkdtemp(join(tmpdir(), "wtm-test-"));
  const remotePath = join(tmpDir, "remote.git");
  const repoPath = join(tmpDir, "repo");

  // Create bare "remote"
  await $`git init --bare ${remotePath}`.quiet();

  // Clone it to get a normal repo
  await $`git clone ${remotePath} ${repoPath}`.quiet();

  // Configure git identity for commits
  await $`git config user.email "test@test.com"`.cwd(repoPath).quiet();
  await $`git config user.name "Test"`.cwd(repoPath).quiet();

  // Create initial commit so the repo isn't empty
  await $`echo "hello" > README.md`.cwd(repoPath).quiet();
  await $`git add README.md`.cwd(repoPath).quiet();
  await $`git commit -m "initial commit"`.cwd(repoPath).quiet();
  await $`git push origin main`.cwd(repoPath).quiet();

  return { repoPath, remotePath, tmpDir };
}

export async function cleanup(tmpDir: string): Promise<void> {
  await rm(tmpDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Verify helpers work by running a smoke test**

Create a minimal test to confirm `createTempRepo` produces a valid repo:

```typescript
// tests/adopt.test.ts (temporary — will be replaced in Task 3)
import { describe, test, expect, afterEach } from "bun:test";
import { createTempRepo, cleanup, type TempRepo } from "./helpers";
import { $ } from "bun";

let tempRepo: TempRepo;

afterEach(async () => {
  if (tempRepo) await cleanup(tempRepo.tmpDir);
});

describe("test helpers", () => {
  test("createTempRepo creates a valid repo with remote", async () => {
    tempRepo = await createTempRepo();

    // Verify it's a git repo
    const isBare = await $`git config --get core.bare`.cwd(tempRepo.repoPath).quiet().text();
    expect(isBare.trim()).toBe("false");

    // Verify remote exists
    const remote = await $`git remote get-url origin`.cwd(tempRepo.repoPath).quiet().text();
    expect(remote.trim()).toBe(tempRepo.remotePath);

    // Verify has a commit
    const log = await $`git log --oneline`.cwd(tempRepo.repoPath).quiet().text();
    expect(log.trim()).toContain("initial commit");
  });
});
```

- [ ] **Step 3: Run the smoke test**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun test tests/adopt.test.ts`
Expected: 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers.ts tests/adopt.test.ts
git commit -m "test: add test helpers for disposable git repos"
```

---

### Task 2: Adopt Validation

**Files:**
- Modify: `src/init.ts`
- Test: `tests/adopt.test.ts`

- [ ] **Step 1: Write failing validation tests**

Replace the contents of `tests/adopt.test.ts` with:

```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { createTempRepo, cleanup, type TempRepo } from "./helpers";
import { InitManager } from "../src/init";
import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

let tempRepo: TempRepo;

afterEach(async () => {
  if (tempRepo) await cleanup(tempRepo.tmpDir);
});

describe("adopt validation", () => {
  test("refuses non-git directory", async () => {
    tempRepo = await createTempRepo();
    const plainDir = join(tempRepo.tmpDir, "not-a-repo");
    await mkdir(plainDir);

    const manager = new InitManager();
    await expect(manager.adopt(plainDir)).rejects.toThrow("Not a git repository");
  });

  test("refuses already-bare repo", async () => {
    tempRepo = await createTempRepo();
    // Convert to bare
    await $`git config core.bare true`.cwd(tempRepo.repoPath).quiet();

    const manager = new InitManager();
    await expect(manager.adopt(tempRepo.repoPath)).rejects.toThrow("already a bare repository");
  });

  test("refuses repo with no remote", async () => {
    tempRepo = await createTempRepo();
    await $`git remote remove origin`.cwd(tempRepo.repoPath).quiet();

    const manager = new InitManager();
    await expect(manager.adopt(tempRepo.repoPath)).rejects.toThrow("No remote");
  });

  test("refuses dirty working tree (unstaged changes)", async () => {
    tempRepo = await createTempRepo();
    await $`echo "dirty" >> README.md`.cwd(tempRepo.repoPath).quiet();

    const manager = new InitManager();
    await expect(manager.adopt(tempRepo.repoPath)).rejects.toThrow("uncommitted changes");
  });

  test("refuses dirty working tree (staged changes)", async () => {
    tempRepo = await createTempRepo();
    await $`echo "staged" >> README.md`.cwd(tempRepo.repoPath).quiet();
    await $`git add README.md`.cwd(tempRepo.repoPath).quiet();

    const manager = new InitManager();
    await expect(manager.adopt(tempRepo.repoPath)).rejects.toThrow("uncommitted changes");
  });

  test("refuses repo with existing external worktrees", async () => {
    tempRepo = await createTempRepo();
    const wtPath = join(tempRepo.tmpDir, "extra-wt");
    await $`git worktree add ${wtPath} -b extra-branch`.cwd(tempRepo.repoPath).quiet();

    const manager = new InitManager();
    await expect(manager.adopt(tempRepo.repoPath)).rejects.toThrow("existing worktrees");
  });

  test("refuses detached HEAD", async () => {
    tempRepo = await createTempRepo();
    const commitHash = (await $`git rev-parse HEAD`.cwd(tempRepo.repoPath).quiet().text()).trim();
    await $`git checkout ${commitHash}`.cwd(tempRepo.repoPath).quiet();

    const manager = new InitManager();
    await expect(manager.adopt(tempRepo.repoPath)).rejects.toThrow("detached");
  });

  test("refuses if .wtm-adopt-tmp/ already exists", async () => {
    tempRepo = await createTempRepo();
    await mkdir(join(tempRepo.repoPath, ".wtm-adopt-tmp"));

    const manager = new InitManager();
    await expect(manager.adopt(tempRepo.repoPath)).rejects.toThrow(".wtm-adopt-tmp");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun test tests/adopt.test.ts`
Expected: 8 failures — `manager.adopt is not a function` (method doesn't exist yet).

- [ ] **Step 3: Implement validation in adopt()**

Add the `adopt` method and private validation helpers to `src/init.ts`. Insert before the `run` method (around line 124):

```typescript
import { $ } from "bun";
import { readdir, rename, cp, rm, stat, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
```

Replace the existing `import { $ } from "bun";` at line 1 with the above, then add these methods to `InitManager`:

```typescript
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
      throw new Error(
        "Found .wtm-adopt-tmp/ — a previous adopt may have failed. Please inspect and remove it manually."
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes(".wtm-adopt-tmp")) {
        throw err;
      }
      // Doesn't exist — good
    }
  }
```

Note: `convertToBare` is a stub for now — add a placeholder so the class compiles:

```typescript
  private async convertToBare(
    targetDir: string,
    gitDir: string,
    currentBranch: string
  ): Promise<void> {
    // Implemented in Task 3
    throw new Error("convertToBare not implemented");
  }
```

- [ ] **Step 4: Run validation tests**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun test tests/adopt.test.ts`
Expected: All 8 validation tests pass (they only exercise `validateForAdopt`, which throws before reaching the stub).

- [ ] **Step 5: Commit**

```bash
git add src/init.ts tests/adopt.test.ts
git commit -m "feat: add adopt validation checks for wtm init"
```

---

### Task 3: Adopt Conversion

**Files:**
- Modify: `src/init.ts`
- Test: `tests/adopt.test.ts`

- [ ] **Step 1: Write failing conversion tests**

Add `import { existsSync } from "node:fs";` to the imports at the top of the test file. Then append after the validation `describe` block:

```typescript
describe("adopt conversion", () => {
  test("converts standard repo to bare with worktree", async () => {
    tempRepo = await createTempRepo();
    const manager = new InitManager();
    await manager.adopt(tempRepo.repoPath);

    // Repo is now bare
    const isBare = await $`git config --get core.bare`
      .cwd(tempRepo.repoPath)
      .quiet()
      .text();
    expect(isBare.trim()).toBe("true");

    // Worktree exists at <repo>/main/
    const worktreePath = join(tempRepo.repoPath, "main");
    expect(existsSync(worktreePath)).toBe(true);

    // README.md exists in worktree
    expect(existsSync(join(worktreePath, "README.md"))).toBe(true);

    // Worktree is registered with git
    const wtList = await $`git worktree list --porcelain`
      .cwd(tempRepo.repoPath)
      .quiet()
      .text();
    expect(wtList).toContain(worktreePath);

    // No temp dir left behind
    expect(existsSync(join(tempRepo.repoPath, ".wtm-adopt-tmp"))).toBe(false);
  });

  test("preserves gitignored files", async () => {
    tempRepo = await createTempRepo();

    // Add .gitignore and an ignored file
    await $`echo "ignored.txt" > .gitignore`.cwd(tempRepo.repoPath).quiet();
    await $`git add .gitignore`.cwd(tempRepo.repoPath).quiet();
    await $`git commit -m "add gitignore"`.cwd(tempRepo.repoPath).quiet();
    await $`git push origin main`.cwd(tempRepo.repoPath).quiet();
    await $`echo "secret" > ignored.txt`.cwd(tempRepo.repoPath).quiet();

    const manager = new InitManager();
    await manager.adopt(tempRepo.repoPath);

    const worktreePath = join(tempRepo.repoPath, "main");
    const content = await Bun.file(join(worktreePath, "ignored.txt")).text();
    expect(content.trim()).toBe("secret");
  });

  test("preserves untracked files", async () => {
    tempRepo = await createTempRepo();
    await $`echo "notes" > untracked.txt`.cwd(tempRepo.repoPath).quiet();

    const manager = new InitManager();
    await manager.adopt(tempRepo.repoPath);

    const worktreePath = join(tempRepo.repoPath, "main");
    const content = await Bun.file(join(worktreePath, "untracked.txt")).text();
    expect(content.trim()).toBe("notes");
  });

  test("preserves local unpushed commits", async () => {
    tempRepo = await createTempRepo();

    // Create a local-only commit
    await $`echo "local work" > local.txt`.cwd(tempRepo.repoPath).quiet();
    await $`git add local.txt`.cwd(tempRepo.repoPath).quiet();
    await $`git commit -m "local commit"`.cwd(tempRepo.repoPath).quiet();
    // Deliberately NOT pushing

    const manager = new InitManager();
    await manager.adopt(tempRepo.repoPath);

    const worktreePath = join(tempRepo.repoPath, "main");
    // local.txt should exist in worktree (from the local commit)
    const content = await Bun.file(join(worktreePath, "local.txt")).text();
    expect(content.trim()).toBe("local work");

    // Verify the commit is in the log
    const log = await $`git log --oneline`
      .cwd(worktreePath)
      .quiet()
      .text();
    expect(log).toContain("local commit");
  });

  test("creates post_create hook template", async () => {
    tempRepo = await createTempRepo();
    const manager = new InitManager();
    await manager.adopt(tempRepo.repoPath);

    const hookPath = join(tempRepo.repoPath, "post_create");
    expect(existsSync(hookPath)).toBe(true);

    const content = await Bun.file(hookPath).text();
    expect(content).toContain("#!/bin/bash");
    expect(content).toContain("WORKTREE_DIR");
  });

  test("configures fetch refspec", async () => {
    tempRepo = await createTempRepo();
    const manager = new InitManager();
    await manager.adopt(tempRepo.repoPath);

    const refspec = await $`git config --get remote.origin.fetch`
      .cwd(tempRepo.repoPath)
      .quiet()
      .text();
    expect(refspec.trim()).toBe("+refs/heads/*:refs/remotes/origin/*");
  });
});
```

- [ ] **Step 2: Run tests to verify conversion tests fail**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun test tests/adopt.test.ts`
Expected: Validation tests pass, conversion tests fail with "convertToBare not implemented".

- [ ] **Step 3: Implement convertToBare**

Replace the `convertToBare` stub in `src/init.ts` with:

```typescript
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
```

- [ ] **Step 4: Run all tests**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun test tests/adopt.test.ts`
Expected: All 14 tests pass (8 validation + 6 conversion).

- [ ] **Step 5: Commit**

```bash
git add src/init.ts tests/adopt.test.ts
git commit -m "feat: implement adopt conversion with error recovery"
```

---

### Task 4: Error Recovery Test

**Files:**
- Test: `tests/adopt.test.ts`

- [ ] **Step 1: Write error recovery test**

Append to the test file:

```typescript
describe("adopt error recovery", () => {
  test("reverts to original state when conversion fails", async () => {
    tempRepo = await createTempRepo();

    // Corrupt remote URL — validation passes (just reads config) but fetch
    // fails during conversion, triggering error recovery
    await $`git remote set-url origin /nonexistent`
      .cwd(tempRepo.repoPath)
      .quiet();

    const manager = new InitManager();
    await expect(manager.adopt(tempRepo.repoPath)).rejects.toThrow();

    // Repo should be back to non-bare
    const isBare = await $`git config --get core.bare`
      .cwd(tempRepo.repoPath)
      .quiet()
      .text();
    expect(isBare.trim()).toBe("false");

    // Original files should be back
    expect(existsSync(join(tempRepo.repoPath, "README.md"))).toBe(true);

    // Temp dir should be cleaned up
    expect(existsSync(join(tempRepo.repoPath, ".wtm-adopt-tmp"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun test tests/adopt.test.ts`
Expected: All tests pass including the recovery test.

- [ ] **Step 3: Commit**

```bash
git add tests/adopt.test.ts
git commit -m "test: add error recovery test for adopt flow"
```

---

### Task 5: Command Routing

**Files:**
- Modify: `src/cli.ts:185-195`
- Test: `tests/adopt.test.ts`

- [ ] **Step 1: Write routing tests**

Append to the test file:

```typescript
describe("command routing", () => {
  test("handleInit adopts when given an existing directory", async () => {
    tempRepo = await createTempRepo();
    const manager = new InitManager();

    // Calling adopt directly with a path that is an existing directory
    await manager.adopt(tempRepo.repoPath);

    const isBare = await $`git config --get core.bare`
      .cwd(tempRepo.repoPath)
      .quiet()
      .text();
    expect(isBare.trim()).toBe("true");
  });

  test("isExistingRepo returns true for git directory", async () => {
    tempRepo = await createTempRepo();
    const manager = new InitManager();
    const result = await manager.isExistingRepo(tempRepo.repoPath);
    expect(result).toBe(true);
  });

  test("isExistingRepo returns false for non-existent path", async () => {
    const manager = new InitManager();
    const result = await manager.isExistingRepo("/tmp/nonexistent-path-xyz");
    expect(result).toBe(false);
  });

  test("isExistingRepo returns false for URL-like string", async () => {
    const manager = new InitManager();
    const result = await manager.isExistingRepo(
      "git@github.com:user/repo.git"
    );
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun test tests/adopt.test.ts`
Expected: `isExistingRepo` tests fail — method doesn't exist yet.

- [ ] **Step 3: Add isExistingRepo to InitManager**

Add this public method to `InitManager` in `src/init.ts` (before the `adopt` method):

```typescript
  /**
   * Check if a string refers to an existing directory containing a git repo.
   * Used by CLI routing to distinguish adopt vs clone.
   */
  async isExistingRepo(pathOrUrl: string): Promise<boolean> {
    try {
      const resolved = resolve(pathOrUrl);
      const s = await stat(resolved);
      if (!s.isDirectory()) return false;
      const gitStat = await stat(join(resolved, ".git"));
      return gitStat.isDirectory() || gitStat.isFile();
    } catch {
      return false;
    }
  }
```

- [ ] **Step 4: Update handleInit in cli.ts**

Replace the `handleInit` function in `src/cli.ts` (lines 185-195):

```typescript
async function handleInit(args: string[]): Promise<void> {
  const manager = new InitManager();
  const firstArg = args[0];

  if (!firstArg) {
    // No args — adopt cwd
    await manager.adopt();
    return;
  }

  // Check if first arg is an existing directory (adopt flow)
  if (await manager.isExistingRepo(firstArg)) {
    await manager.adopt(firstArg);
    return;
  }

  // Otherwise treat as URL (clone flow)
  const url = firstArg;
  const path = args[1];
  await manager.run(url, path);
}
```

- [ ] **Step 5: Run all tests**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun test tests/adopt.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/init.ts src/cli.ts tests/adopt.test.ts
git commit -m "feat: add command routing to detect adopt vs clone in wtm init"
```

---

### Task 6: Help Text Update

**Files:**
- Modify: `src/cli.ts:46-89`

- [ ] **Step 1: Update printHelp**

In `src/cli.ts`, replace the COMMANDS and EXAMPLES sections of the help text:

```typescript
export function printHelp(): void {
  console.log(`
🌳 Worktree Manager (wtm) - Git worktree management made simple

USAGE:
  wtm <command> [args] [flags]

COMMANDS:
  init <url> [path]                     Clone repo as wtm-managed bare repository
  init [path]                           Adopt existing repo into wtm structure
  create <name> --from <base_branch>    Create a new worktree and spawn shell
                        --no-shell      Create worktree without spawning shell
  checkout <name>                       Create worktree from remote branch
  list                                  List all worktrees
  delete <name> [--force]               Delete a worktree
  cleanup [options]                     Find and delete merged worktrees
  help                                  Show this help message

CLEANUP OPTIONS:
  --base <branch>                       Base branch for merge detection (auto-detected)
  --dry-run                             Show what would be deleted without deleting
  --yes                                 Delete all merged worktrees without prompting

EXAMPLES:
  wtm init git@github.com:user/repo.git Clone and setup bare repo structure
  wtm init git@gitlab.com:org/repo.git myrepo  Clone with custom directory name
  wtm init                              Adopt current repo into wtm structure
  wtm init ~/projects/myrepo            Adopt existing repo at path
  wtm create feature-auth --from main   Create worktree from main (spawns new shell)
  wtm create hotfix-123 --from master   Create worktree from master
  wtm checkout feature-auth             Create worktree from remote branch feature-auth
  wtm list                              Show all worktrees
  wtm delete feature-auth               Delete worktree
  wtm delete feature-auth --force       Force delete worktree
  wtm cleanup                           Find and delete merged worktrees interactively
  wtm cleanup --base main               Use main as base branch for merge detection
  wtm cleanup --dry-run                 Show what would be deleted
  wtm cleanup --yes                     Delete all merged worktrees without prompting

FEATURES:
  • Automatically fetches latest changes from base branch
  • Works only in bare git repositories
  • Creates new branch for each worktree
  • Spawns new shell in worktree after creation
  • Safe deletion with confirmation prompts
  • Clear status and error messages
  • Hook system: place executable scripts in bare repo root (e.g., post_create)
  • Adopt existing repos without re-cloning
`);
}
```

- [ ] **Step 2: Verify build still works**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun run build && ./dist/index.js help`
Expected: Help text shows the new `init [path]` command and adopt examples.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "docs: update help text with adopt usage and examples"
```

---

### Task 7: Manual Smoke Test and Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/jarred/Code/personal/worktree-manager && bun test`
Expected: All tests pass.

- [ ] **Step 2: Build and smoke test**

```bash
cd /Users/jarred/Code/personal/worktree-manager && bun run build
```

Expected: Build succeeds with `dist/index.js`.

- [ ] **Step 3: Add test script to package.json**

Add `"test": "bun test"` to the scripts section of `package.json`:

```json
"scripts": {
  "start": "bun run index.ts",
  "dev": "bun --watch index.ts",
  "build": "bun build index.ts --outdir ./dist --target bun --format esm",
  "test": "bun test",
  "link": "bun link",
  "unlink": "bun unlink"
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add test script to package.json"
```
