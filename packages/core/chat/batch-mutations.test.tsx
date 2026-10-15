// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { chatKeys } from "./queries";
import { useDeleteChatSessions } from "./mutations";

vi.mock("../hooks", () => ({ useWorkspaceId: () => "ws-test" }));
const remove = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ api: { deleteChatSession: remove } }));

it("keeps rows until server success and never rolls successes back after a partial failure", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const key = chatKeys.sessions("ws-test");
  qc.setQueryData(key, [{ id: "ok" }, { id: "denied" }, { id: "untouched" }]);
  let finish!: () => void;
  remove.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(new Error("403"));
  const { result } = renderHook(() => useDeleteChatSessions(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  let work!: ReturnType<typeof result.current.mutateAsync>;
  await act(async () => {
    work = result.current.mutateAsync({ sessionIds: ["ok", "denied"] });
    await Promise.resolve();
  });
  expect(qc.getQueryData(key)).toEqual([{ id: "ok" }, { id: "denied" }, { id: "untouched" }]);
  await act(async () => { finish(); await work; });
  expect(qc.getQueryData(key)).toEqual([{ id: "denied" }, { id: "untouched" }]);
  expect(await work).toEqual({ deletedIds: ["ok"], failedIds: ["denied"] });
  expect(remove.mock.calls).toEqual([["ok"], ["denied"]]);
  qc.clear();
});
