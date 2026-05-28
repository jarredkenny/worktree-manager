import { describe, test, expect, afterEach } from "bun:test";
import { createTempRepo, cleanup, type TempRepo } from "./helpers";
import { InitManager } from "../src/init";
import { WorktreeManager } from "../src/worktree";
import { $ } from "bun";
import { join } from "node:path";
import { existsSync } from "node:fs";

let tempRepo: TempRepo;

afterEach(async () => {
  if (tempRepo) await cleanup(tempRepo.tmpDir);
});

describe("checkoutWorktree", () => {
  test("resolves exact branch when a suffix-colliding branch also exists on remote", async () => {
    tempRepo = await createTempRepo();

    // Push two branches to origin via a separate clone so the main repo
    // doesn't know about them locally — forcing checkoutWorktree to hit the
    // "fetch from remote" path.
    //
    // The collision: `git ls-remote origin foo` tail-matches refs, so it
    // returns BOTH refs/heads/feat/foo and refs/heads/foo. Splitting the
    // multiline output on '\t' and taking [0] yields whichever SHA prints
    // first, which is the wrong branch.
    const seed = join(tempRepo.tmpDir, "seed");
    await $`git clone ${tempRepo.remotePath} ${seed}`.quiet();
    await $`git config user.email "test@test.com"`.cwd(seed).quiet();
    await $`git config user.name "Test"`.cwd(seed).quiet();

    await $`git checkout -b feat/foo`.cwd(seed).quiet();
    await $`echo "feat" > a.txt`.cwd(seed).quiet();
    await $`git add a.txt`.cwd(seed).quiet();
    await $`git commit -m "feat/foo commit"`.cwd(seed).quiet();
    await $`git push origin feat/foo`.cwd(seed).quiet();
    const featSha = (await $`git rev-parse HEAD`.cwd(seed).quiet().text()).trim();

    await $`git checkout main`.cwd(seed).quiet();
    await $`git checkout -b foo`.cwd(seed).quiet();
    await $`echo "foo" > b.txt`.cwd(seed).quiet();
    await $`git add b.txt`.cwd(seed).quiet();
    await $`git commit -m "foo commit"`.cwd(seed).quiet();
    await $`git push origin foo`.cwd(seed).quiet();
    const fooSha = (await $`git rev-parse HEAD`.cwd(seed).quiet().text()).trim();

    expect(featSha).not.toBe(fooSha);

    // Adopt the main clone — converts it to a bare wtm-managed repo.
    await new InitManager().adopt(tempRepo.repoPath);

    const manager = new WorktreeManager(tempRepo.repoPath);
    await manager.checkoutWorktree("foo");

    const worktreePath = join(tempRepo.repoPath, "foo");
    expect(existsSync(worktreePath)).toBe(true);

    const wtHead = (await $`git rev-parse HEAD`.cwd(worktreePath).quiet().text()).trim();
    expect(wtHead).toBe(fooSha);
    expect(wtHead).not.toBe(featSha);
  });

  test("surfaces the underlying error when worktree creation fails for a non-remote reason", async () => {
    tempRepo = await createTempRepo();

    // Push 'foo' to origin
    const seed = join(tempRepo.tmpDir, "seed");
    await $`git clone ${tempRepo.remotePath} ${seed}`.quiet();
    await $`git config user.email "test@test.com"`.cwd(seed).quiet();
    await $`git config user.name "Test"`.cwd(seed).quiet();
    await $`git checkout -b foo`.cwd(seed).quiet();
    await $`echo "foo" > b.txt`.cwd(seed).quiet();
    await $`git add b.txt`.cwd(seed).quiet();
    await $`git commit -m "foo"`.cwd(seed).quiet();
    await $`git push origin foo`.cwd(seed).quiet();

    await new InitManager().adopt(tempRepo.repoPath);

    // Pre-create a file at the worktree path so `git worktree add` fails.
    // The error must NOT be reported as "no remote branch 'origin/foo' exists",
    // because the branch demonstrably does exist.
    await $`mkdir -p ${join(tempRepo.repoPath, "foo")}`.quiet();
    await $`touch ${join(tempRepo.repoPath, "foo", "blocker.txt")}`.quiet();

    const manager = new WorktreeManager(tempRepo.repoPath);
    await expect(manager.checkoutWorktree("foo")).rejects.not.toThrow(
      /no remote branch 'origin\/foo' exists/,
    );
  });
});
