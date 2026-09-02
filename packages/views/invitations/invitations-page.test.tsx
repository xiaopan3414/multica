import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

const {
  navigate,
  logout,
  refreshMe,
  acceptInvitation,
  joinByShareLink,
  markOnboardingComplete,
  listMyInvitations,
  listWorkspaces,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  logout: vi.fn(),
  refreshMe: vi.fn(),
  acceptInvitation: vi.fn(),
  joinByShareLink: vi.fn(),
  markOnboardingComplete: vi.fn(),
  listMyInvitations: vi.fn(),
  listWorkspaces: vi.fn(),
}));

// Mocked at the context module rather than the barrel so <AppLink> stays the
// real component and its click contract is what the test exercises.
vi.mock("../navigation/context", () => ({
  useNavigation: () => ({ push: navigate, replace: navigate }),
}));

vi.mock("../auth", () => ({
  useLogout: () => logout,
}));

vi.mock("../platform", () => ({
  DragStrip: () => null,
}));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = { refreshMe };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({ refreshMe }),
    },
  ),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    acceptInvitation,
    joinByShareLink,
    markOnboardingComplete,
    listMyInvitations,
    listWorkspaces,
  },
}));

import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../locales/en/common.json";
import enInvite from "../locales/en/invite.json";
import { extractShareLinkCode, InvitationsPage } from "./invitations-page";

const TEST_RESOURCES = { en: { common: enCommon, invite: enInvite } };

function renderWithClient(
  client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
  joinOnly = false,
) {
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <QueryClientProvider client={client}>
        <InvitationsPage joinOnly={joinOnly} />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

const mkInvite = (id: string, wsId: string, wsName: string) => ({
  id,
  workspace_id: wsId,
  inviter_id: "u-2",
  invitee_email: "x@example.com",
  invitee_user_id: null,
  role: "member" as const,
  status: "pending" as const,
  created_at: "",
  updated_at: "",
  expires_at: "",
  workspace_name: wsName,
  inviter_name: "Alice",
});

const mkWs = (id: string, slug: string) => ({
  id,
  name: slug,
  slug,
  description: null,
  context: null,
  settings: {},
  repos: [],
  issue_prefix: slug.toUpperCase(),
  avatar_url: null,
  created_at: "",
  updated_at: "",
});

describe("InvitationsPage", () => {
  beforeEach(() => {
    navigate.mockReset();
    logout.mockReset();
    refreshMe.mockReset();
    acceptInvitation.mockReset();
    joinByShareLink.mockReset();
    markOnboardingComplete.mockReset();
    listMyInvitations.mockReset();
    listWorkspaces.mockReset();
    refreshMe.mockResolvedValue(undefined);
    acceptInvitation.mockResolvedValue({});
    joinByShareLink.mockResolvedValue({});
    markOnboardingComplete.mockResolvedValue({});
  });

  it("renders pending invitations with workspace names", async () => {
    listMyInvitations.mockResolvedValue([
      mkInvite("inv-1", "ws-1", "Acme"),
      mkInvite("inv-2", "ws-2", "Beta Corp"),
    ]);
    renderWithClient();
    await waitFor(() => {
      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(screen.getByText("Beta Corp")).toBeInTheDocument();
    });
  });

  it("with no selections, submitting routes to /onboarding", async () => {
    listMyInvitations.mockResolvedValue([mkInvite("inv-1", "ws-1", "Acme")]);
    renderWithClient();
    await waitFor(() => screen.getByText("Acme"));
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(navigate).toHaveBeenCalledWith("/onboarding");
    // Empty submit doesn't accept anything or touch onboarding state.
    expect(acceptInvitation).not.toHaveBeenCalled();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
  });

  it("accepts selected invitations, marks onboarded, navigates to first ws", async () => {
    listMyInvitations.mockResolvedValue([
      mkInvite("inv-1", "ws-1", "Acme"),
      mkInvite("inv-2", "ws-2", "Beta"),
    ]);
    listWorkspaces.mockResolvedValue([mkWs("ws-1", "acme"), mkWs("ws-2", "beta")]);
    renderWithClient();

    await waitFor(() => screen.getByText("Acme"));
    // Select Acme via its label/checkbox row.
    fireEvent.click(screen.getByText("Acme"));

    fireEvent.click(screen.getByRole("button", { name: /join 1 workspace/i }));

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith("inv-1");
      expect(markOnboardingComplete).toHaveBeenCalledWith({
        completion_path: "invite_accept",
        workspace_id: "ws-1",
      });
      expect(refreshMe).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith("/acme/issues");
    });
  });

  it("empty list falls through to onboarding via Continue button", async () => {
    listMyInvitations.mockResolvedValue([]);
    renderWithClient();

    await waitFor(() =>
      screen.getByRole("button", { name: /continue to setup/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /continue to setup/i }),
    );
    expect(navigate).toHaveBeenCalledWith("/onboarding");
  });

  it("join-only mode waits for an invitation instead of offering setup", async () => {
    listMyInvitations.mockResolvedValue([]);
    listWorkspaces.mockResolvedValue([]);
    renderWithClient(undefined, true);

    expect(
      await screen.findByRole("heading", { name: /join an existing workspace/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /check for invitations/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/invitation link or code/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
    expect(screen.queryByText(/set up my own workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/continue to setup/i)).not.toBeInTheDocument();
  });

  it("join-only mode accepts a pasted share link and opens that workspace", async () => {
    const joinedWorkspace = mkWs("ws-link", "linked-team");
    listMyInvitations.mockResolvedValue([]);
    listWorkspaces
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([joinedWorkspace]);
    joinByShareLink.mockResolvedValue({
      member: {},
      workspace_id: "ws-link",
      workspace_slug: "linked-team",
    });
    renderWithClient(undefined, true);

    const input = await screen.findByLabelText(/invitation link or code/i);
    fireEvent.change(input, {
      target: {
        value:
          "http://10.0.37.30:3000/join?code=0123456789abcdef01234567",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /join workspace with link/i }),
    );

    await waitFor(() => {
      expect(joinByShareLink).toHaveBeenCalledWith("0123456789abcdef01234567");
      expect(markOnboardingComplete).toHaveBeenCalledWith({
        completion_path: "invite_accept",
        workspace_id: "ws-link",
      });
      expect(refreshMe).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith("/linked-team/issues");
    });
  });

  it("join-only mode requires selecting a pending invitation", async () => {
    listMyInvitations.mockResolvedValue([mkInvite("inv-1", "ws-1", "Acme")]);
    listWorkspaces.mockResolvedValue([]);
    renderWithClient(undefined, true);

    await screen.findByText("Acme");
    const submit = screen.getByRole("button", {
      name: /select a workspace to join/i,
    });
    expect(submit).toBeDisabled();
    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Acme"));
    expect(
      screen.getByRole("button", { name: /join 1 workspace/i }),
    ).toBeEnabled();
  });

  it("join-only mode enters an existing membership without creating resources", async () => {
    listMyInvitations.mockResolvedValue([]);
    listWorkspaces.mockResolvedValue([mkWs("ws-1", "acme")]);
    renderWithClient(undefined, true);

    fireEvent.click(
      await screen.findByRole("button", { name: /continue to workspace/i }),
    );

    await waitFor(() => {
      expect(markOnboardingComplete).toHaveBeenCalledWith({
        completion_path: "skip_existing",
        workspace_id: "ws-1",
      });
      expect(refreshMe).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith("/acme/issues");
    });
    expect(acceptInvitation).not.toHaveBeenCalled();
  });
});

describe("extractShareLinkCode", () => {
  it.each([
    ["0123456789abcdef01234567", "0123456789abcdef01234567"],
    [
      "/join?code=0123456789abcdef01234567",
      "0123456789abcdef01234567",
    ],
    [
      "http://10.0.37.30:3000/join?code=0123456789abcdef01234567",
      "0123456789abcdef01234567",
    ],
    ["not a link", null],
    ["", null],
  ])("extracts a share code from %j", (input, expected) => {
    expect(extractShareLinkCode(input)).toBe(expected);
  });
});
