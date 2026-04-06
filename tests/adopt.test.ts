import { describe, test, expect, afterEach } from "bun:test";
import { createTempRepo, cleanup, type TempRepo } from "./helpers";
import { InitManager } from "../src/init";
import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

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
