# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Worktree Manager (`wtm`) is a CLI tool for managing Git worktrees in bare repositories. Published as `@jx0/wtm` on npm. Uses Bun as runtime and build system. Only runtime dependency is `@inquirer/prompts` for interactive cleanup UI.

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Watch mode development
bun run build        # Build to dist/index.js
bun link             # Link for local testing
```

No test suite exists. To verify changes work, build and test manually:
```bash
bun run build && ./dist/index.js help
```

## Architecture

```
index.ts           # Entry point - parses args and routes to CLI
src/
  cli.ts           # Command parsing and routing
  init.ts          # InitManager class - clone repos into wtm-managed bare structure
  worktree.ts      # WorktreeManager class - core Git operations
  cleanup.ts       # CleanupManager class - detect and remove merged worktrees
  hooks.ts         # HookManager class - post_create hook execution
```

**Key patterns:**
- Uses Bun's `$` shell template syntax for Git commands (no Git library)
- InitManager clones repos into bare structure with .git/ subdirectory, creates template hook
- WorktreeManager validates bare repo, fetches from remote, creates worktrees, spawns interactive shell
- CleanupManager detects merged branches, checks for uncommitted/unpushed work, interactive selection
- HookManager runs executable scripts from bare repo root with environment variables (WORKTREE_DIR, WORKTREE_NAME, BASE_BRANCH, BARE_REPO_PATH)

**CLI commands:**
- `wtm init <url> [path]` - Clone repo into wtm-managed bare structure with .git/ subdirectory
- `wtm create <name> --from <branch>` - Create worktree and spawn shell
- `wtm checkout <branch>` - Create worktree from existing remote branch
- `wtm list` - Show all worktrees
- `wtm delete <name> [--force]` - Remove worktree
- `wtm cleanup [--base <branch>] [--dry-run] [--yes]` - Find and delete merged worktrees

## Bun Shell Syntax

Git operations use Bun's shell:
```typescript
const result = await $`git worktree list --porcelain`.text();
await $`git fetch origin ${branch}:refs/remotes/origin/${branch}`.quiet();
```

Use `.quiet()` to suppress output, `.text()` to get stdout as string.
