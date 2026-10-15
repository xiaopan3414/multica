import { describe, expect, it, vi } from "vitest";
import { deleteChatSessions } from "./batch-delete";

describe("chat batch deletion", () => {
  it("deletes only selected unique IDs, retains failures and continues", async () => {
    const remove = vi.fn(async (id: string) => {
      if (id === "forbidden") throw new Error("403");
    });
    const progress = vi.fn();
    const result = await deleteChatSessions(["mine", "forbidden", "mine", "last"], remove, progress);
    expect(remove.mock.calls).toEqual([["mine"], ["forbidden"], ["last"]]);
    expect(result).toEqual({ deletedIds: ["mine", "last"], failedIds: ["forbidden"] });
    expect(progress.mock.calls).toEqual([[1], [2], [3]]);
  });

  it("waits for each server response before advancing and does not retry destructive requests", async () => {
    let release!: () => void;
    const remove = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
      .mockRejectedValueOnce(new Error("network unavailable"));
    const work = deleteChatSessions(["first", "second"], remove);
    expect(remove).toHaveBeenCalledTimes(1);
    release();
    expect(await work).toEqual({ deletedIds: ["first"], failedIds: ["second"] });
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
