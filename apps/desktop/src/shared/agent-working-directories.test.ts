import { describe, expect, it } from "vitest";
import {
  isValidAgentId,
  normalizeAgentWorkingDirectories,
} from "./agent-working-directories";

const AGENT_ID = "7f34eb65-30d5-44c9-9a76-723108504a72";

describe("agent working directories", () => {
  it("accepts UUID agent ids", () => {
    expect(isValidAgentId(AGENT_ID)).toBe(true);
    expect(isValidAgentId("agent-1")).toBe(false);
    expect(isValidAgentId("../../config")).toBe(false);
  });

  it("keeps only valid non-empty path mappings", () => {
    expect(
      normalizeAgentWorkingDirectories({
        [AGENT_ID]: "  D:\\work\\project  ",
        "agent-1": "D:\\ignored",
        "07a9eb59-8b47-4686-b683-152304344409": 42,
      }),
    ).toEqual({ [AGENT_ID]: "D:\\work\\project" });
  });

  it("normalizes malformed config values to an empty map", () => {
    expect(normalizeAgentWorkingDirectories(null)).toEqual({});
    expect(normalizeAgentWorkingDirectories([])).toEqual({});
    expect(normalizeAgentWorkingDirectories("not-an-object")).toEqual({});
  });
});
