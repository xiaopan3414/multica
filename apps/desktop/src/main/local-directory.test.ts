// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}));

import { validateWorkspacesRootDirectory } from "./local-directory";

const temporaryRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "multica-workspaces-root-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("validateWorkspacesRootDirectory", () => {
  it("accepts an empty dedicated directory", async () => {
    const root = await makeRoot();

    await expect(validateWorkspacesRootDirectory(root)).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects a directory containing an existing project", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "existing-project", "src"), { recursive: true });

    await expect(validateWorkspacesRootDirectory(root)).resolves.toEqual({
      ok: false,
      reason: "contains_unmanaged_content",
    });
  });

  it("accepts an existing Multica-owned root with only managed entries", async () => {
    const root = await makeRoot();
    await mkdir(join(root, ".multica"), { recursive: true });
    await writeFile(
      join(root, ".multica", "daemon_task_context.json"),
      JSON.stringify({ managed_by: "multica-daemon-task" }),
      "utf-8",
    );
    await mkdir(join(root, ".repos"));
    await mkdir(join(root, "0198ad61-cf63-7c23-8c63-dba2ef4f91aa"));

    await expect(validateWorkspacesRootDirectory(root)).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects an existing marker when unmanaged entries are also present", async () => {
    const root = await makeRoot();
    await mkdir(join(root, ".multica"), { recursive: true });
    await writeFile(
      join(root, ".multica", "daemon_task_context.json"),
      JSON.stringify({ managed_by: "multica-daemon-task" }),
      "utf-8",
    );
    await writeFile(join(root, "important-notes.txt"), "keep", "utf-8");

    await expect(validateWorkspacesRootDirectory(root)).resolves.toEqual({
      ok: false,
      reason: "contains_unmanaged_content",
    });
  });
});
