# In-Repo Hooks Design

**Date:** 2026-04-28
**Status:** Approved

## Summary

Move `wtm`'s hook discovery from the bare repository root (`<bareRoot>/<hookName>`) to an in-repo location inside each worktree (`<worktreePath>/.wtm/<hookName>`). This lets teams commit shared hooks alongside their code instead of requiring each developer to set them up locally outside the worktree.

## Motivation

Today, hooks like `post_create` live at the bare repository root, outside any worktree and untracked by git. That makes them per-developer-only — there is no way to share a setup script with the team via the repo itself. Moving discovery to `.wtm/` inside the worktree allows the hook to be committed and version-controlled like any other source file.

## Design

### Discovery

`HookManager` looks at exactly one location:

```
${worktreePath}/.wtm/${hookName}
```

If the file exists, it runs. If it does not exist, the hook is a silent no-op (matching today's behavior when no hook is present).

There is no fallback to the bare repository root. The previous `<bareRoot>/<hookName>` discovery is removed.

### Execution

Execution semantics are unchanged from today:

- **Interpreter:** `bash <hookPath>` — the executable bit is not required on the file.
- **Working directory:** the worktree path.
- **Environment variables (passthrough plus four additions):**
  - `WORKTREE_DIR` — absolute path to the worktree
  - `WORKTREE_NAME` — name of the worktree
  - `BASE_BRANCH` — branch the worktree was created from
  - `BARE_REPO_PATH` — path to the bare repository

`BARE_REPO_PATH` remains in the environment even though wtm itself no longer reads the bare-repo location for hook lookup; scripts may still want it.

### Logging

Same as today:

- `🪝 Running ${hookName} hook…` on start
- `✅ ${hookName} hook completed successfully` on success
- `❌ ${hookName} hook failed: <error>` on failure, and the surrounding `wtm create` / `wtm checkout` operation aborts

The resolved path is not surfaced in the message because there is only one possible location.

### `wtm init` and `wtm adopt`

Neither command scaffolds a hook template. The existing logic that writes `<targetDir>/post_create` and `chmod +x`'s it is removed. `wtm init` and `wtm adopt` no longer touch hook files.

If a user wants a starting point, the README provides the snippet to copy into `.wtm/post_create`.

### `.wtm/` directory semantics

`.wtm/` is an ordinary directory in the worktree. Treated by git like any other directory: tracked when committed, ignored if added to `.gitignore`. Users who want a personal (non-shared) hook can `.gitignore` `.wtm/` on their working branch. Users who want a shared team hook commit it.

## Components Changed

- **`src/hooks.ts`** — `HookManager` simplified to read from `${context.worktreePath}/.wtm/${hookName}`. The constructor's `bareRepoPath` argument and the corresponding private field are removed; `HookContext.bareRepoPath` already carries the value into the hook's environment, and the resolver no longer needs it. `getHookPath` / `hookExists` become trivial and can be inlined into `executeHook`.
- **`src/worktree.ts`** — `new HookManager(cwd)` becomes `new HookManager()` (no constructor arg). All existing `bareRepoPath: this.cwd` entries in `HookContext` calls are unchanged — they still flow through to the env var.
- **`src/init.ts`** — `createPostCreateHook` is deleted along with its call sites in `run` and `adopt`. The "Created post_create hook template" log line is removed. The "next steps" message that tells users to customize the bare-root `post_create` is updated to point at `.wtm/post_create` instead.
- **`README.md`** — hook contract documented: location is `.wtm/<hookName>`, executable bit not required, lists env vars, notes the gitignore pattern for personal hooks, and includes a migration note for users coming from the bare-root location.

## Threat Model

In-repo hooks are committed to git, so any commit that lands on a branch a developer checks out can execute arbitrary code on their machine when `wtm create` / `wtm checkout` runs. This is the same threat model as `npm install` post-install scripts and any build script in the repo. We accept this risk; the README calls it out. No trust prompt, hash verification, or allow-list infrastructure is added.

## Migration

Users with an existing `<bareRoot>/post_create` must move it to `<branch>/.wtm/post_create` on each branch they want it to run on (or commit it to a base branch so new worktrees inherit it). The README documents the migration step.

There is no automatic migration; this is a breaking change for existing users. Given the small user base and clean cut, that is acceptable over carrying both code paths indefinitely.

## Testing

The repo has no automated test suite today. Verification is manual:

1. **Hook present:** create `.wtm/post_create` in a worktree's base branch, commit it, run `wtm create <name> --from <baseBranch>`, observe the script runs in the new worktree.
2. **Hook absent:** create a worktree from a branch with no `.wtm/post_create`, observe silent no-op (no `🪝` log line).
3. **Hook failure:** create a `.wtm/post_create` that exits non-zero, observe `wtm create` aborts with the error message.
4. **`wtm init` clean:** run `wtm init <url>`, confirm no `post_create` file is written at the bare root or anywhere else.
5. **`wtm adopt` clean:** run `wtm adopt` on an existing repo, confirm no `post_create` file is written.

Optionally, a small `bun test` covering the resolver as pure logic over the filesystem could be added in the implementation plan, but is not required by this design.

## Out of Scope

- `.wtm/post_create.d/` directory format for multiple scripts per hook
- Trust prompts or hash-based hook verification
- New hook names beyond `post_create` (the namespace is ready for them; this change does not add any)
- Scaffolding `.wtm/post_create` from `wtm init` / `wtm adopt`
- Backwards-compatible fallback to `<bareRoot>/<hookName>`
