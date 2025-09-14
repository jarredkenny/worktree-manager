# Worktree Manager (wtm)

🌳 **A fast, modern CLI tool for managing Git worktrees in bare repositories**

[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-black)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Worktree Manager simplifies Git worktree operations, making it easy to work with multiple branches simultaneously in bare repositories. Perfect for CI/CD environments, shared development servers, or anyone who wants to streamline their Git workflow.

## ✨ Features

- 🚀 **Lightning fast** - Built with Bun for maximum performance
- 🔒 **Bare repository focused** - Designed specifically for bare Git repositories
- 🔄 **Smart branch management** - Automatic fetching and branch creation
- 🪝 **Hook system** - Extensible post-creation hooks for automation
- 📋 **Clear output** - Beautiful, informative command output
- ⚡ **Zero dependencies** - Uses Bun's built-in shell capabilities
- 🛡️ **Safe operations** - Comprehensive validation and error handling

## 📦 Installation

### Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0+)
- Git repository configured as bare (`git config core.bare true`)
- Git remotes configured (typically `origin`)

### Local Installation

```bash
# Clone the repository
git clone https://github.com/your-username/worktree-manager.git
cd worktree-manager

# Install and link globally
bun install
bun link

# Verify installation
wtm help
```

### Development Setup

```bash
# Clone and install
git clone https://github.com/your-username/worktree-manager.git
cd worktree-manager

# Make executable and test
chmod +x index.ts
./index.ts help

# For development with auto-reload
bun run dev
```

## 🚀 Quick Start

```bash
# Navigate to your bare repository
cd /path/to/your/bare-repo.git

# Create a new worktree from main branch
wtm create feature-auth --from main

# List all worktrees
wtm list

# Switch to the worktree (if not automatically switched)
wtm checkout feature-auth

# Work on your feature...
# (edit files, make commits, etc.)

# When done, clean up
wtm delete feature-auth
```

## 📖 Command Reference

### `wtm create <name> --from <base_branch>`

Creates a new worktree with a new branch based on the specified base branch.

```bash
# Create worktree from main branch
wtm create feature-auth --from main

# Create hotfix from master
wtm create hotfix-123 --from master

# Create feature branch from another branch
wtm create review-pr --from feature-x
```

**What it does:**
1. Validates you're in a bare repository
2. Fetches the latest changes from the base branch
3. Creates a new branch named `<name>`
4. Creates a worktree directory at `./<name>`
5. Executes `post_create` hook if present

### `wtm checkout <name>`

Switches to an existing worktree or creates one if it doesn't exist.

```bash
# Switch to existing worktree
wtm checkout feature-auth

# If worktree doesn't exist but remote branch does, creates it automatically
wtm checkout existing-remote-branch
```

**Behavior:**
- If worktree exists: changes directory to worktree
- If worktree doesn't exist but remote branch exists: creates worktree and switches
- If neither exists: shows available worktrees and creation instructions

### `wtm list`

Displays all worktrees in a formatted table.

```bash
wtm list
```

**Output:**
```
Worktrees:
────────────────────────────────────────────────────────────────────────────────
feature-auth                   [feature-auth]       a1b2c3d4e
main-work                      [main]              f5g6h7i8j
(bare)                         (bare)              k9l0m1n2o
```

### `wtm delete <name> [--force]`

Removes a worktree and its associated files.

```bash
# Safe deletion (with confirmation if needed)
wtm delete feature-auth

# Force deletion (skips safety checks)
wtm delete old-feature --force
```

**Safety features:**
- Cannot delete bare repository
- Validates worktree exists before deletion
- Force flag available for stuck worktrees

### `wtm help`

Shows comprehensive help information including examples and features.

## 🪝 Hook System

Worktree Manager supports executable hooks that run automatically during worktree lifecycle events. Hooks are placed in the bare repository root and must be executable.

### Available Hooks

#### `post_create`

Runs immediately after a worktree is created, with the working directory set to the new worktree.

**Environment Variables:**
- `$WORKTREE_DIR` - Absolute path to the new worktree
- `$WORKTREE_NAME` - Name of the worktree
- `$BASE_BRANCH` - Branch the worktree was created from
- `$BARE_REPO_PATH` - Path to the bare repository

**Example post_create hook:**

```bash
#!/bin/bash
# File: post_create (in bare repo root)

echo "🪝 Setting up new worktree: $WORKTREE_NAME"

# Install dependencies if package.json exists
if [ -f "package.json" ]; then
    echo "📦 Installing dependencies..."
    pnpm install --silent
fi

# Copy environment files from bare repo
if [ -f "$BARE_REPO_PATH/.env.example" ]; then
    echo "📄 Copying .env.example to .env"
    cp "$BARE_REPO_PATH/.env.example" ".env"
fi

# Copy configuration files
if [ -f "$BARE_REPO_PATH/.vscode/settings.json" ]; then
    mkdir -p .vscode
    cp "$BARE_REPO_PATH/.vscode/settings.json" ".vscode/"
fi

echo "✅ Worktree setup complete!"
```

**Setup:**
```bash
# Create the hook file in your bare repository
vim post_create

# Make it executable
chmod +x post_create

# Test by creating a new worktree
wtm create test-feature --from main
```

## 🏗️ Architecture

```
worktree-manager/
├── src/
│   ├── cli.ts           # Command parsing and routing
│   ├── worktree.ts      # Core worktree operations
│   └── hooks.ts         # Hook execution system
├── index.ts             # Main entry point
├── package.json         # Project configuration
└── README.md           # Documentation
```

**Key Components:**
- **WorktreeManager**: Core class handling Git operations
- **HookManager**: Executes lifecycle hooks with proper environment
- **CLI Parser**: Robust argument parsing and command routing

## 🔧 Configuration

Worktree Manager works out of the box with standard bare repositories. No configuration files needed.

**Repository Requirements:**
```bash
# Must be a bare repository
git config core.bare true

# Should have remote configured
git remote -v
# origin  git@github.com:user/repo.git (fetch)
# origin  git@github.com:user/repo.git (push)
```

## 🎯 Use Cases

### Development Server Workflows
Perfect for shared development servers where multiple developers work on different features:

```bash
# Developer 1
wtm create user-authentication --from main

# Developer 2  
wtm create payment-integration --from main

# Code review
wtm create review-pr-123 --from feature-branch
```

### CI/CD Environments
Ideal for build systems that need to work with multiple branches:

```bash
# Build script
wtm create build-$BUILD_ID --from $BRANCH_NAME
cd build-$BUILD_ID
# ... run build process ...
cd ..
wtm delete build-$BUILD_ID --force
```

### Feature Development
Streamline your feature development workflow:

```bash
# Start new feature
wtm create feature-dashboard --from main

# Work on feature...
# (commits, testing, etc.)

# Switch to another feature temporarily
wtm checkout hotfix-urgent

# Return to feature
wtm checkout feature-dashboard

# Clean up when done
wtm delete feature-dashboard
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development

```bash
# Clone and setup
git clone https://github.com/your-username/worktree-manager.git
cd worktree-manager
bun install

# Run in development mode
bun run dev

# Build
bun run build

# Run tests (when available)
bun test
```

### Project Structure

- Keep core logic in `src/worktree.ts`
- Add new commands in `src/cli.ts`
- Hook system extensions go in `src/hooks.ts`
- Follow existing TypeScript patterns

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [Bun Documentation](https://bun.sh/docs)
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

**Made with ❤️ and [Bun](https://bun.sh/)**

*Worktree Manager - Because managing Git worktrees shouldn't be a tree of problems* 🌳