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
