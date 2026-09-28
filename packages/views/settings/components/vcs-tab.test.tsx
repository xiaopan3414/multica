import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";

const mockRefetch = vi.hoisted(() => vi.fn());
const deliveriesRef = vi.hoisted(() => ({
  current: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    if (opts.queryKey.includes("deliveries")) {
      return {
        data: { deliveries: deliveriesRef.current },
        refetch: mockRefetch,
        isFetching: false,
      };
    }
    return {
      data: {
        connections: [{
          id: "connection-1",
          workspace_id: "workspace-1",
          provider: "gitlab",
          instance_url: "https://gitlab.example.test",
          account_login: "acme",
          webhook_url: "https://multica.example.test/api/webhooks/vcs/connection-1",
          webhook_path: "/api/webhooks/vcs/connection-1",
          created_at: "2026-09-28T07:00:00Z",
        }],
        configured: true,
        can_manage: false,
      },
    };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  queryOptions: <T,>(opts: T) => opts,
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@multica/core/api", () => ({
  api: {
    listVCSConnections: vi.fn(),
    listVCSWebhookDeliveries: vi.fn(),
    connectVCS: vi.fn(),
    deleteVCSConnection: vi.fn(),
    rotateVCSWebhook: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { VCSTab } from "./vcs-tab";

const TEST_RESOURCES = {
  en: { common: enCommon, settings: enSettings },
};

function I18nWrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

describe("VCSTab webhook deliveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deliveriesRef.current = [];
  });

  it("shows the waiting state before the first authenticated delivery", () => {
    render(<VCSTab />, { wrapper: I18nWrapper });
    expect(screen.getByText("No authenticated webhook deliveries received yet.")).toBeTruthy();
  });

  it("shows received GitLab push metadata", () => {
    deliveriesRef.current = [{
      id: "delivery-1",
      provider: "gitlab",
      event: "Push Hook",
      event_uuid: "event-uuid-1",
      webhook_uuid: "webhook-uuid-1",
      project_path: "team/project",
      ref: "refs/heads/main",
      before_sha: "before",
      after_sha: "after",
      checkout_sha: "after",
      commit_count: 2,
      handler_action: "record_only",
      received_at: "2026-09-28T08:00:00Z",
    }];

    render(<VCSTab />, { wrapper: I18nWrapper });
    expect(screen.getByText("Push Hook")).toBeTruthy();
    expect(screen.getByText("team/project · refs/heads/main")).toBeTruthy();
    expect(screen.getByText("2 commits")).toBeTruthy();
    expect(screen.getByText("Record only")).toBeTruthy();
    expect(screen.getByText("Event UUID: event-uuid-1")).toBeTruthy();
  });
});
