# Design: `wtm init` Adopt Flow for Existing Repositories

**Issue:** [jarredkenny/worktree-manager#1](https://github.com/jarredkenny/worktree-manager/issues/1)
**Date:** 2026-04-05

## Problem

`wtm init <url>` only supports fresh clones. Users with existing repos must re-clone from scratch to use wtm. This creates friction for adoption.

## Solution

Extend `wtm init` to detect when it's pointed at an existing repository and convert it in-place to wtm's bare-repo-with-worktrees structure.

## Command Routing

The existing `handleInit` in `cli.ts` changes to support three modes:

- `wtm init` (no args, inside a git repo) — adopt cwd
- `wtm init <path>` (existing directory) — adopt that path
- `wtm init <url> [path]` (not an existing directory) — clone flow (unchanged)

Detection: resolve `args[0]` and check if it exists as a directory on disk. If yes, adopt. If no (or looks like a URL), clone. Second arg (`path`) only applies to clone flow.

## Adopt Flow

### Validation (before any filesystem changes)

All checks run before any mutation. If any fail, the repo is untouched.

1. **Resolve repo root** — use provided path or cwd. Resolve to absolute path.
2. **Confirm git repo** — `.git/` must exist as a directory (not a file; a `.git` file means it's already a worktree).
3. **Confirm not already bare** — `core.bare` must not be `true`. If already bare, error with helpful message.
4. **Confirm remote exists** — `git remote get-url origin` must succeed. No remote means worktree workflows won't function.
5. **Confirm clean working tree** — `git diff --quiet` and `git diff --cached --quiet`. If dirty: "Working tree has uncommitted changes. Please commit or stash before running wtm init." Note: this deliberately does not check for untracked files — those are preserved during conversion. In the rare case where an untracked file shadows a tracked file on another branch, this could cause confusion, but that's too edge-case-y to block on.
6. **Check for existing worktrees** — `git worktree list` must show only the main working tree. If external worktrees exist, refuse with explanation.
7. **Confirm not detached HEAD** — `git branch --show-current` must return a branch name. If empty (detached HEAD), error: "HEAD is detached. Please checkout a branch before running wtm init."
8. **Check for stale temp dir** — if `.wtm-adopt-tmp/` already exists, a previous adopt may have failed partway. Refuse with: "Found .wtm-adopt-tmp/ — a previous adopt may have failed. Please inspect and remove it manually."
9. **Gather info** — current branch from step 7. Default branch via existing `detectDefaultBranch` called against `<repo>/.git` — the remote refs are already populated from the original clone, so this works before conversion.

### Conversion

1. **Collect non-git entries** — everything in repo root except `.git/` and `.wtm-adopt-tmp/` (excluded defensively, though step 8 of validation already checks it doesn't exist).
2. **Move to temp dir** — move all entries to `<repo>/.wtm-adopt-tmp/`. Same filesystem ensures atomic renames.
3. **Set bare** — `git config core.bare true`.
4. **Configure fetch refspec** — `git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"`.
5. **Fetch** — `git fetch origin` to ensure remote tracking refs are current.
6. **Create worktree** — `git worktree add <branch-dir> <branch>` where `<branch>` is the branch the user was on. Git creates the directory with correct tracked files and linked index.
7. **Restore non-tracked files** — recursively copy from `.wtm-adopt-tmp/` into the worktree dir using no-clobber semantics (`cp -rn` or equivalent). This preserves gitignored and untracked files that `git worktree add` didn't recreate, including those nested inside tracked directories (e.g., `src/.cache/`). Files already created by git are left untouched. Safety note: this step is safe because the clean-tree validation (step 5) guarantees tracked files in temp are identical to what git checked out — no-clobber simply skips them.
8. **Remove temp dir** — delete `.wtm-adopt-tmp/`.
9. **Create `post_create` hook** — reuse existing `createPostCreateHook`. Skip if one already exists.

### Error Recovery

If any step in the conversion block fails:

1. Revert `core.bare` to `false`
2. Move files from `.wtm-adopt-tmp/` back to repo root
3. Remove partial worktree (`git worktree remove` + delete directory) if created
4. Remove temp dir if present

The repo ends up back in its original state.

### Output

On success:
```
Repository adopted successfully!

Your code is now at: <repo>/<branch>/
Bare repository at:  <repo>/.git/

Next steps:
  cd <branch>
  wtm create <name> --from <branch>
  wtm list
```

## Considered Alternatives

**In-place restructure without temp dir:** Set `core.bare = true`, then `git worktree add ../<repo>-<branch> <branch>` to create the worktree as a sibling, then move it into position. Simpler file operations, but the worktree created by git would only contain tracked files — no way to preserve gitignored/untracked files (node_modules, .env, build artifacts) without a separate holding area. Since preserving those files is a core goal ("without disrupting current state"), the temp dir approach is the right tradeoff despite its added complexity.

**Auto-stash dirty state:** Instead of refusing on uncommitted changes, auto-stash before conversion and pop after. Rejected because a stash pop conflict after restructuring would leave the repo in a state that's hard to reason about or recover from. One extra user command (`git stash` or `git commit`) is a small cost for eliminating that class of failure.

## Testing Strategy

Integration tests using Bun's test runner. Each test creates a real (disposable) git repo in a temp directory, runs the adopt flow against it, and verifies the result. No mocks, no real user repos touched.

### Test Fixtures

A helper module (`tests/helpers.ts`) provides:

- `createTempRepo()` — creates a temp dir, `git init`, adds a file, commits, sets up a local "remote" (bare clone used as origin). Returns paths to both.
- `cleanup(dir)` — `rm -rf` the temp dir.

### Test Cases

**Validation tests:**
- Refuses non-git directory
- Refuses already-bare repo
- Refuses repo with no remote
- Refuses dirty working tree (staged changes)
- Refuses dirty working tree (unstaged changes)
- Refuses repo with existing external worktrees
- Refuses detached HEAD
- Refuses if .wtm-adopt-tmp/ already exists

**Conversion tests:**
- Converts standard repo: verifies bare, worktree exists, branch correct, files present
- Preserves gitignored files (create `.gitignore` + ignored file, verify it survives conversion)
- Preserves untracked files
- Preserves local commits (commit without pushing, verify it's in the worktree after adopt)
- Creates `post_create` hook template
- Configures fetch refspec correctly

**Error recovery tests:**
- Simulate failure mid-conversion (e.g., make worktree add fail), verify repo reverts to original state

**Command routing tests:**
- `wtm init` in a repo dir triggers adopt
- `wtm init <existing-dir>` triggers adopt
- `wtm init <url>` triggers clone (existing behavior, just verify not broken)

### Test Structure

```
tests/
  helpers.ts          # createTempRepo, cleanup utilities
  adopt.test.ts       # All adopt flow tests
```

Tests run via `bun test`. Each test is independent — creates its own temp repo, cleans up after itself.
