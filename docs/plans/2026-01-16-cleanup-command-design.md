# wtm cleanup Command Design

## Overview

Add a `cleanup` command to wtm that identifies and removes worktrees whose branches have been merged upstream.

## Command Interface

```
wtm cleanup [--base <branch>] [--yes] [--dry-run]
```

**Flags:**
- `--base <branch>` - Override the base branch (auto-detected from `origin/HEAD` by default)
- `--yes` - Non-interactive mode, deletes all safe worktrees without prompting
- `--dry-run` - Show what would be deleted without actually deleting

## Safe-to-Delete Criteria

A worktree is considered safe to delete when ALL of these are true:

1. **Merged upstream**: Either:
   - Branch commit is an ancestor of `origin/{base}` (MR was merged), OR
   - Remote branch `origin/{branch}` no longer exists (deleted after merge)

2. **No uncommitted changes**: Working tree has no:
   - Unstaged modifications
   - Staged changes
   - Untracked files

3. **No unpushed work**: No local commits that aren't reachable from `origin/{base}`

**Protected branches** (never shown as deletable):
- `main`, `master`, `next`, `prerelease`

## Implementation

**New files:**
- `src/cleanup.ts` - Contains `CleanupManager` class with detection logic

**Modified files:**
- `src/cli.ts` - Add `cleanup` command routing and help text
- `package.json` - Add `@inquirer/prompts` dependency

**Code structure:**
```typescript
interface CleanupCandidate {
  path: string;
  name: string;
  branch: string;
  commit: string;
}

class CleanupManager {
  async getBaseBranch(): Promise<string>
  async findCandidates(base: string): Promise<CleanupCandidate[]>
  async isMerged(wt, base): Promise<boolean>
  async hasUncommittedChanges(wt): Promise<boolean>
  async hasUnpushedCommits(wt, base): Promise<boolean>
  async deleteWorktrees(candidates: CleanupCandidate[]): Promise<void>
}
```

Reuses `WorktreeManager.listWorktrees()` and `WorktreeManager.deleteWorktree()` for actual operations.

## User Flow

**Interactive mode (default):**
```
$ wtm cleanup

Worktree Cleanup
Base branch: main (auto-detected)

Fetching latest from origin/main...
Analyzing worktrees...

Found 3 worktrees safe to delete:

? Select worktrees to delete
  [ ] feature-auth [feature-auth]
  [ ] fix-bug-123 [fix-bug-123]
  [ ] old-experiment [old-experiment]

Selected 2 worktrees for deletion:
  - feature-auth
  - fix-bug-123

? Delete these 2 worktrees? (y/N)

Deleting feature-auth... done
Deleting fix-bug-123... done
Pruning stale entries...
Cleanup complete!
```

**With `--dry-run`:** Shows candidates but skips selection/deletion

**With `--yes`:** Skips selection, deletes all candidates after showing the list

## Dependencies

- `@inquirer/prompts` - For interactive checkbox and confirm prompts
