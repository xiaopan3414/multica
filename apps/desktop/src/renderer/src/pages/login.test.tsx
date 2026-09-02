import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captureLoginProps = vi.hoisted(() => vi.fn());

vi.mock("@multica/views/auth", () => ({
  LoginPage: (props: Record<string, unknown>) => {
    captureLoginProps(props);
    return <div>Desktop email login</div>;
  },
}));

vi.mock("@multica/views/platform", () => ({
  DragStrip: () => null,
}));

vi.mock("@multica/ui/components/common/multica-icon", () => ({
  MulticaIcon: () => <div>Multica</div>,
}));

import { DesktopLoginPage } from "./login";

describe("DesktopLoginPage", () => {
  it("uses email login without exposing a Google login action", () => {
    render(<DesktopLoginPage />);

    expect(screen.getByText("Desktop email login")).toBeInTheDocument();
    expect(captureLoginProps).toHaveBeenCalledTimes(1);
    expect(captureLoginProps.mock.calls[0]?.[0]).not.toHaveProperty(
      "onGoogleLogin",
    );
  });
});
