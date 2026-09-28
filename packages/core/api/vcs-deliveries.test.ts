import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient VCS webhook deliveries", () => {
  it("returns a validated delivery response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      deliveries: [{
        id: "delivery-1",
        provider: "gitlab",
        event: "Push Hook",
        event_uuid: "event-1",
        webhook_uuid: "webhook-1",
        project_path: "team/project",
        ref: "refs/heads/main",
        before_sha: "before",
        after_sha: "after",
        checkout_sha: "after",
        commit_count: 2,
        handler_action: "record_only",
        received_at: "2026-09-28T08:00:00Z",
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const client = new ApiClient("https://api.example.test");
    const result = await client.listVCSWebhookDeliveries("workspace-1", "connection-1");

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]).toMatchObject({
      event: "Push Hook",
      project_path: "team/project",
      commit_count: 2,
    });
  });

  it("falls back to an empty list for a malformed response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      deliveries: [{ id: "delivery-1", event: 42 }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const client = new ApiClient("https://api.example.test");
    await expect(
      client.listVCSWebhookDeliveries("workspace-1", "connection-1"),
    ).resolves.toEqual({ deliveries: [] });
  });
});
