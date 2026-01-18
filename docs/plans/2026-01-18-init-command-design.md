# wtm init Command Design

## Overview

Add a `wtm init` command that clones a repository into a bare repo structure optimized for wtm worktree management.

## Command Interface

```
wtm init <url> [path]
```

- `<url>` - Git remote URL (SSH or HTTPS)
- `[path]` - Optional directory name (defaults to repo name extracted from URL)

**Examples:**
```bash
wtm init git@gitlab.com:org/myrepo.git           # Creates ./myrepo/
wtm init git@gitlab.com:org/myrepo.git platform  # Creates ./platform/
wtm init https://github.com/user/repo.git        # Creates ./repo/
```

## Execution Steps

When you run `wtm init git@gitlab.com:org/myrepo.git`:

1. **Extract repo name** from URL (handles `.git` suffix, various URL formats)
2. **Create directory** `./myrepo/`
3. **Clone bare** into `.git` subdirectory: `git clone --bare <url> myrepo/.git`
4. **Configure remote** - ensure `origin` fetch refspec is set correctly for a bare repo
5. **Fetch all branches** - `git fetch origin`
6. **Create template `post_create` hook** - minimal executable script
7. **Detect default branch** - from `origin/HEAD` or fall back to main/master
8. **Auto-create initial worktree** - equivalent to `wtm checkout <default-branch>`

**Final structure:**
```
myrepo/
├── .git/              <- bare Git internals
├── post_create        <- template hook (executable)
└── main/              <- initial worktree for default branch
```

## URL Parsing

Extract repo name from various URL formats:

| URL | Extracted Name |
|-----|----------------|
| `git@gitlab.com:org/myrepo.git` | `myrepo` |
| `git@github.com:user/repo.git` | `repo` |
| `https://github.com/user/repo.git` | `repo` |
| `https://gitlab.com/org/sub/repo` | `repo` |
| `ssh://git@gitlab.com/org/repo.git` | `repo` |

Logic: Take the last path segment, strip `.git` suffix if present.

## Template post_create Hook

```bash
#!/bin/bash
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
```

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Directory already exists | Error: "Directory 'myrepo' already exists" |
| Invalid/unreachable URL | Error from git clone (network/auth errors pass through) |
| No default branch detected | Fall back to `main`, then `master`, then error |
| Clone succeeds but worktree creation fails | Warn but don't fail (bare repo is still usable) |

## Implementation

**New file:**
- `src/init.ts` - Contains `InitManager` class

**Modified files:**
- `src/cli.ts` - Add `init` command routing and help text

**InitManager methods:**
- `extractRepoName(url: string): string` - Parse repo name from URL
- `run(url: string, path?: string): Promise<void>` - Main entry point
