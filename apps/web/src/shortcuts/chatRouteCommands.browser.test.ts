import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import { useThreadSelectionStore } from "../threadSelectionStore";
import { useUiStateStore } from "../uiStateStore";
import { installChatRouteCommands } from "./chatRouteCommands";

const FILTER_KEY = "F9";
const OPEN_THREAD = { environmentId: "env", threadId: "thread-1" };
const entities = vi.hoisted(() => ({ archivedAt: null as string | null }));

vi.mock("../keybindings", async (original) => {
  const actual = await original<typeof import("../keybindings")>();
  return {
    ...actual,
    resolveShortcutCommand: (event: KeyboardEvent, ...rest: [never, never]) =>
      event.key === "F9" ? "thread.filterByProject" : actual.resolveShortcutCommand(event, ...rest),
  };
});
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  readProjects: () => [
    {
      environmentId: "env",
      id: "project-1",
      title: "Project",
      workspaceRoot: "/project",
      repositoryIdentity: null,
      archivedAt: entities.archivedAt,
    },
  ],
  readThreadShell: () => ({ environmentId: "env", projectId: "project-1" }),
}));

type Match = { readonly routeId: string; readonly pathname: string };

function routerAt(matches: Match[], params: Record<string, string> = {}) {
  const state = { matches: matches.map((match) => ({ ...match, params })) };
  return {
    router: { state } as unknown as AnyRouter,
    navigate: (next: Match[]) => {
      state.matches = next.map((match) => ({ ...match, params }));
    },
  };
}

const CHAT: Match[] = [
  { routeId: "__root__", pathname: "/" },
  { routeId: "/_chat", pathname: "/" },
];

const pressEscape = () => press("Escape");

function setup(archivedAt: string | null = null) {
  entities.archivedAt = archivedAt;
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function selectThread(threadKey: string) {
  useThreadSelectionStore.getState().clearSelection();
  useThreadSelectionStore.getState().toggleThread(threadKey);
}

describe("chat route commands", () => {
  it("clears a selection made after install, reading the store at keypress time", () => {
    const { router } = routerAt(CHAT);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());

    selectThread("env:thread-1");
    const event = pressEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(0);
    // With nothing selected, Escape is left for other handlers.
    expect(pressEscape().defaultPrevented).toBe(false);
  });

  it("stays out of the way off the chat route and under modal pages", () => {
    const { router, navigate } = routerAt([{ routeId: "__root__", pathname: "/pair" }]);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());
    selectThread("env:thread-1");

    expect(pressEscape().defaultPrevented).toBe(false);

    navigate([...CHAT, { routeId: "/_chat/settings", pathname: "/settings" }]);
    expect(pressEscape().defaultPrevented).toBe(false);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(1);

    navigate(CHAT);
    expect(pressEscape().defaultPrevented).toBe(true);
  });

  it("filters the sidebar to the open thread's project, and back to all", () => {
    setup();
    const { router } = routerAt(CHAT, OPEN_THREAD);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useUiStateStore.getState().setSidebarProjectScopeKeys([]));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());
    selectThread("env:thread-2");

    expect(press(FILTER_KEY).defaultPrevented).toBe(true);
    expect(useUiStateStore.getState().sidebarProjectScopeKeys).toHaveLength(1);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(0);

    expect(press(FILTER_KEY, { repeat: true }).defaultPrevented).toBe(true);
    expect(useUiStateStore.getState().sidebarProjectScopeKeys).toHaveLength(1);

    press(FILTER_KEY);
    expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual([]);
  });

  it.each([
    ["a draft", {}, null],
    ["an archived project", OPEN_THREAD, "2026-01-01T00:00:00.000Z"],
  ])("leaves the key alone on %s, which the menu doesn't filter", (_name, params, archivedAt) => {
    setup(archivedAt);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(routerAt(CHAT, params).router));

    expect(press(FILTER_KEY).defaultPrevented).toBe(false);
    expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual([]);
  });
});
