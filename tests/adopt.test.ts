// tests/adopt.test.ts (temporary — will be replaced in Task 2)
import { describe, test, expect, afterEach } from "bun:test";
import { createTempRepo, cleanup, type TempRepo } from "./helpers";
import { $ } from "bun";

let tempRepo: TempRepo;

afterEach(async () => {
  if (tempRepo) await cleanup(tempRepo.tmpDir);
});

describe("test helpers", () => {
  test("createTempRepo creates a valid repo with remote", async () => {
    tempRepo = await createTempRepo();

    // Verify it's a git repo
    const isBare = await $`git config --get core.bare`.cwd(tempRepo.repoPath).quiet().text();
    expect(isBare.trim()).toBe("false");

    // Verify remote exists
    const remote = await $`git remote get-url origin`.cwd(tempRepo.repoPath).quiet().text();
    expect(remote.trim()).toBe(tempRepo.remotePath);

    // Verify has a commit
    const log = await $`git log --oneline`.cwd(tempRepo.repoPath).quiet().text();
    expect(log.trim()).toContain("initial commit");
  });
});
