import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempRepo {
  /** Path to the cloned working repo (the one to adopt) */
  repoPath: string;
  /** Path to the bare repo used as "origin" */
  remotePath: string;
  /** Parent temp directory (cleanup this) */
  tmpDir: string;
}

/**
 * Creates a disposable git repo with a local bare "remote".
 * Structure:
 *   <tmpDir>/remote.git  — bare repo acting as origin
 *   <tmpDir>/repo        — normal clone to be adopted
 */
export async function createTempRepo(): Promise<TempRepo> {
  const tmpDir = await mkdtemp(join(tmpdir(), "wtm-test-"));
  const remotePath = join(tmpDir, "remote.git");
  const repoPath = join(tmpDir, "repo");

  // Create bare "remote"
  await $`git init --bare ${remotePath}`.quiet();

  // Clone it to get a normal repo
  await $`git clone ${remotePath} ${repoPath}`.quiet();

  // Configure git identity for commits
  await $`git config user.email "test@test.com"`.cwd(repoPath).quiet();
  await $`git config user.name "Test"`.cwd(repoPath).quiet();

  // Create initial commit so the repo isn't empty
  await $`echo "hello" > README.md`.cwd(repoPath).quiet();
  await $`git add README.md`.cwd(repoPath).quiet();
  await $`git commit -m "initial commit"`.cwd(repoPath).quiet();
  await $`git push origin main`.cwd(repoPath).quiet();

  return { repoPath, remotePath, tmpDir };
}

export async function cleanup(tmpDir: string): Promise<void> {
  await rm(tmpDir, { recursive: true, force: true });
}
