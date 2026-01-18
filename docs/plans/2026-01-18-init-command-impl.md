# wtm init Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `wtm init <url> [path]` command that clones a repo into a bare structure optimized for wtm worktree management.

**Architecture:** New `InitManager` class in `src/init.ts` handles URL parsing, bare clone, hook creation, and initial worktree setup. Reuses `WorktreeManager` for the final worktree creation.

**Tech Stack:** Bun, TypeScript, Bun shell ($)

---

### Task 1: Create InitManager class with URL parsing

**Files:**
- Create: `src/init.ts`

**Step 1: Create the file with types and URL parsing**

```typescript
import { $ } from "bun";
import { WorktreeManager } from "./worktree";

export class InitManager {
  /**
   * Extract repository name from various Git URL formats.
   * Handles SSH, HTTPS, and git:// protocols.
   */
  extractRepoName(url: string): string {
    // Remove trailing slashes
    let cleaned = url.replace(/\/+$/, "");

    // Remove .git suffix if present
    cleaned = cleaned.replace(/\.git$/, "");

    // Extract the last path segment
    // Handles: git@host:org/repo, https://host/org/repo, ssh://git@host/org/repo
    const lastSegment = cleaned.split(/[\/:]/).pop();

    if (!lastSegment) {
      throw new Error(`Could not extract repository name from URL: ${url}`);
    }

    return lastSegment;
  }
}
```

**Step 2: Verify it compiles**

Run: `bun build src/init.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/init.ts
git commit -m "feat(init): add InitManager with URL parsing"
```

---

### Task 2: Add the run method (main entry point)

**Files:**
- Modify: `src/init.ts`

**Step 1: Add run method after extractRepoName**

```typescript
  /**
   * Initialize a new wtm-managed bare repository.
   */
  async run(url: string, path?: string): Promise<void> {
    // Determine target directory
    const repoName = path || this.extractRepoName(url);
    const targetDir = `${process.cwd()}/${repoName}`;
    const gitDir = `${targetDir}/.git`;

    // Check if directory already exists
    const exists = await Bun.file(targetDir).exists();
    if (exists) {
      throw new Error(`Directory '${repoName}' already exists`);
    }

    console.log(`Initializing wtm repository: ${repoName}`);

    // Step 1: Create directory
    console.log(`Creating directory: ${targetDir}`);
    await $`mkdir -p ${targetDir}`;

    // Step 2: Clone bare into .git subdirectory
    console.log(`Cloning ${url} (bare)...`);
    try {
      await $`git clone --bare ${url} ${gitDir}`;
    } catch (error) {
      // Clean up on failure
      await $`rm -rf ${targetDir}`.nothrow();
      throw new Error(`Failed to clone repository: ${error}`);
    }

    // Step 3: Configure the bare repo
    console.log("Configuring bare repository...");
    await $`git -C ${gitDir} config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"`;

    // Step 4: Fetch all branches
    console.log("Fetching branches...");
    await $`git -C ${gitDir} fetch origin`.quiet();

    // Step 5: Create template post_create hook
    await this.createPostCreateHook(targetDir);

    // Step 6: Detect default branch and create initial worktree
    const defaultBranch = await this.detectDefaultBranch(gitDir);
    console.log(`Default branch: ${defaultBranch}`);

    await this.createInitialWorktree(targetDir, defaultBranch);

    console.log(`\n✅ Repository initialized at ${targetDir}`);
    console.log(`   Default worktree created: ${targetDir}/${defaultBranch}`);
    console.log(`\n   To start working:`);
    console.log(`   cd ${targetDir}/${defaultBranch}`);
  }
```

**Step 2: Verify it compiles**

Run: `bun build src/init.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: Error about missing methods (detectDefaultBranch, createPostCreateHook, createInitialWorktree)

**Step 3: Commit**

```bash
git add src/init.ts
git commit -m "feat(init): add run method skeleton"
```

---

### Task 3: Add helper methods

**Files:**
- Modify: `src/init.ts`

**Step 1: Add detectDefaultBranch method before run()**

```typescript
  /**
   * Detect the default branch from origin/HEAD or common defaults.
   */
  private async detectDefaultBranch(gitDir: string): Promise<string> {
    // Try to get default branch from origin/HEAD
    try {
      const result = await $`git -C ${gitDir} symbolic-ref refs/remotes/origin/HEAD`
        .quiet()
        .nothrow();

      if (result.exitCode === 0) {
        const ref = result.stdout.toString().trim();
        const branch = ref.replace("refs/remotes/origin/", "");
        if (branch) return branch;
      }
    } catch {
      // Fall through to defaults
    }

    // Check for common default branches
    for (const branch of ["main", "master"]) {
      const exists = await $`git -C ${gitDir} show-ref --verify refs/remotes/origin/${branch}`
        .quiet()
        .nothrow();
      if (exists.exitCode === 0) {
        return branch;
      }
    }

    throw new Error(
      "Could not detect default branch. No origin/HEAD, main, or master found."
    );
  }
```

**Step 2: Add createPostCreateHook method**

```typescript
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
    await $`chmod +x ${hookPath}`;
    console.log("Created template post_create hook");
  }
```

**Step 3: Add createInitialWorktree method**

```typescript
  /**
   * Create the initial worktree for the default branch.
   */
  private async createInitialWorktree(
    targetDir: string,
    defaultBranch: string
  ): Promise<void> {
    const worktreePath = `${targetDir}/${defaultBranch}`;
    const gitDir = `${targetDir}/.git`;

    console.log(`Creating initial worktree: ${defaultBranch}`);

    try {
      // Create worktree from the remote tracking branch
      await $`git -C ${gitDir} worktree add ${worktreePath} origin/${defaultBranch}`;
    } catch (error) {
      console.warn(`Warning: Could not create initial worktree: ${error}`);
      console.warn("You can create one manually with: wtm checkout <branch>");
    }
  }
```

**Step 4: Verify it compiles**

Run: `bun build src/init.ts --outdir /tmp --target bun 2>&1 | head -5`
Expected: No errors

**Step 5: Commit**

```bash
git add src/init.ts
git commit -m "feat(init): add helper methods for branch detection, hook, and worktree"
```

---

### Task 4: Wire up init command in CLI

**Files:**
- Modify: `src/cli.ts`

**Step 1: Add import**

At the top of the file, after other imports:

```typescript
import { InitManager } from './init';
```

**Step 2: Add init case to switch statement**

In the `runCommand` function, add before `case 'cleanup'`:

```typescript
      case 'init':
        await handleInit(args);
        break;
```

**Step 3: Add handleInit function**

Add after `handleCleanup`:

```typescript
async function handleInit(args: string[]): Promise<void> {
  const url = args[0];
  const path = args[1];

  if (!url) {
    throw new Error("Repository URL is required. Usage: wtm init <url> [path]");
  }

  const manager = new InitManager();
  await manager.run(url, path);
}
```

**Step 4: Update help text - COMMANDS section**

Add after `cleanup [options]` line:

```typescript
  init <url> [path]                     Clone repo as wtm-managed bare repository
```

**Step 5: Update help text - EXAMPLES section**

Add new examples:

```typescript
  wtm init git@github.com:user/repo.git Clone and setup bare repo structure
  wtm init git@gitlab.com:org/repo.git myrepo  Clone with custom directory name
```

**Step 6: Verify it compiles**

Run: `bun run build`
Expected: No errors

**Step 7: Commit**

```bash
git add src/cli.ts
git commit -m "feat(init): wire up init command in CLI"
```

---

### Task 5: Manual verification and final build

**Step 1: Build the project**

Run: `bun run build`
Expected: Builds successfully

**Step 2: Test help output**

Run: `./dist/index.js help`
Expected: Shows init command in help

**Step 3: Test init with dry inspection**

Run: `./dist/index.js init` (no args)
Expected: Error message about missing URL

**Step 4: Update README**

Add init command documentation to README.md:
- Add to Command Reference section
- Add example usage

**Step 5: Commit README and any fixes**

```bash
git add -A
git commit -m "docs: add init command to README"
```
