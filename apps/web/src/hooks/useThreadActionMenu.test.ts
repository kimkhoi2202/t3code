import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ThreadId,
  type ContextMenuItem,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ThreadActionMenuId } from "../components/threadActionMenu.logic";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const state = vi.hoisted(() => ({
  granted: new Set<string>(),
  effects: [] as string[],
  completed: deferred<void>(),
  show: vi.fn<
    (
      items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>,
      position: { x: number; y: number },
    ) => Promise<ThreadActionMenuId | null>
  >(),
}));

function recordEffect(action: string) {
  state.effects.push(action);
  state.completed.resolve();
}

vi.mock("../components/CustomSnoozeDialog", () => ({ requestCustomSnooze: vi.fn() }));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: async () => recordEffect("project-settings") }),
}));
vi.mock("../state/session", () => ({
  readEnvironmentScope: (environmentId: string, scope: string) =>
    scope === AuthOrchestrationOperateScope && state.granted.has(environmentId),
}));
vi.mock("../state/entities", () => ({
  readEnvironmentServerConfigLoaded: () => true,
  readEnvironmentSupportsAutoSettleOptOut: () => true,
  readThreadShell: () => ({
    id: "thread",
    environmentId: "secondary",
    projectId: "project",
    title: "Thread",
    branch: "main",
    worktreePath: null,
    runtime: null,
    latestRun: null,
  }),
  useProjects: () => [{ id: "project", environmentId: "secondary" }],
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "primary" }));
vi.mock("../state/threads", () => ({ threadEnvironment: { updateMetadata: "metadata" } }));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: () => async () => {
    recordEffect("metadata");
    return AsyncResult.success(undefined);
  },
}));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({
    contextMenu: { show: state.show, close: () => {} },
    dialogs: {
      confirm: async (message: string) => {
        recordEffect(`confirm: ${message.split(" ", 1)[0]}`);
        return false;
      },
    },
  }),
}));
vi.mock("@t3tools/client-runtime/state/project-grouping", () => ({
  deriveLogicalProjectKeyFromSettings: () => "project",
  derivePhysicalProjectKey: () => "project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../sidebarProjectGrouping", () => ({
  buildPhysicalToLogicalProjectKeyMap: () => new Map(),
}));
vi.mock("../uiStateStore", () => ({
  useUiStateStore: (select: (store: unknown) => unknown) =>
    select({
      markThreadUnread: () => recordEffect("mark-unread"),
    }),
}));
vi.mock("../components/ui/toast", () => ({
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: { add: () => state.completed.resolve() },
}));
vi.mock("../components/Sidebar.snooze", () => ({
  resolveSnoozePresets: () => [
    { id: "hour", label: "In 1 hour", whenLabel: "3 PM", snoozedUntil: "2099-01-01T00:00:00Z" },
  ],
  snoozeWakeDescription: () => "later",
}));
vi.mock("./useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({
    copyToClipboard: (text: string) => recordEffect(`copy: ${text}`),
  }),
}));
vi.mock("./useHandleNewThread", () => ({
  useNewThreadHandler: () => async () => recordEffect("draft"),
}));
vi.mock("./useSettings", () => ({
  useClientSettings: (select: (settings: unknown) => unknown) =>
    select({
      confirmThreadDelete: true,
      confirmThreadArchive: true,
      timestampFormat: "12-hour",
    }),
}));
vi.mock("./useThreadActions", () => ({
  canTurnThreadIntoProject: () => false,
  useThreadActions: () =>
    Object.fromEntries(
      [
        "markThreadUnread",
        "settleThread",
        "unsettleThread",
        "snoozeThread",
        "unsnoozeThread",
        "pinThread",
        "confirmAndUnpinThread",
        "archiveThread",
        "deleteThread",
      ].map((action) => [
        action,
        async () => {
          recordEffect(action === "markThreadUnread" ? "mark-unread" : action);
          return AsyncResult.success(undefined);
        },
      ]),
    ),
}));

import { useThreadActionMenu } from "./useThreadActionMenu";

const target = {
  environmentId: EnvironmentId.make("secondary"),
  threadId: ThreadId.make("thread"),
};
const position = { x: 10, y: 20 };
const createMenu = (options: { readonly onFind?: (threadRef: typeof target) => void } = {}) =>
  useThreadActionMenu({
    threadRef: target,
    projectCwd: "/project",
    onStartRename: () => recordEffect("rename"),
    onFind: options.onFind,
    canShareWithGuest: false,
  });

beforeEach(() => {
  state.granted = new Set(["primary"]);
  state.effects = [];
  state.completed = deferred<void>();
  state.show.mockReset().mockResolvedValue(null);
});

describe("thread menu permissions", () => {
  it.each(["rename", "regenerate-title", "delete", "pin", "settle", "archive"] as const)(
    "%s rechecks after the menu closes",
    async (action) => {
      state.granted.add("secondary");
      const choice = deferred<ThreadActionMenuId | null>();
      state.show.mockReturnValue(choice.promise);
      createMenu().openMenu(position);
      state.granted.delete("secondary");
      choice.resolve(action);
      await state.completed.promise;
      expect(state.effects).toEqual([]);
    },
  );

  it("offers find only to a header that can open it, without task permission", async () => {
    createMenu().openMenu(position);
    expect(state.show.mock.calls[0]![0].some((item) => item.id === "find")).toBe(false);
    state.show.mockResolvedValue("find");
    const onFind = vi.fn(() => recordEffect("find"));
    createMenu({ onFind }).openMenu(position);
    await state.completed.promise;
    const items = state.show.mock.calls[1]![0];
    expect(items[0]).toMatchObject({ id: "find", label: "Find in thread" });
    expect(items[0]?.disabled).not.toBe(true);
    expect(state.effects).toEqual(["find"]);
    expect(onFind).toHaveBeenCalledExactlyOnceWith(target);
  });
});

describe("thread menu shortcuts", () => {
  it.each([
    ["thread.rename", "rename"],
    ["thread.newOnBranch", "draft"],
    ["thread.regenerateTitle", "metadata"],
    ["thread.markUnread", "mark-unread"],
    ["thread.copyPath", "copy: /project"],
    ["thread.copyBranch", "copy: main"],
    ["thread.copyId", "copy: thread"],
    ["thread.projectSettings", "project-settings"],
    ["thread.archive", "confirm: Archive"],
    ["thread.delete", "confirm: Delete"],
  ] as const)("%s runs its entry without opening the menu", async (command, effect) => {
    state.granted.add("secondary");
    expect(createMenu().runCommand(command, position)).toBe(true);
    await state.completed.promise;
    expect(state.effects).toEqual([effect]);
    expect(state.show).not.toHaveBeenCalled();
  });

  it("opens an entry with choices at the given position", async () => {
    state.granted.add("secondary");
    createMenu().runCommand("thread.snooze", position);
    const [entries, shownAt] = state.show.mock.calls[0]!;
    expect(entries.map((entry) => entry.id)).toEqual(["snooze:hour", "snooze:custom"]);
    expect(shownAt).toBe(position);
  });

  it("says so instead of running an entry the menu has disabled", async () => {
    expect(createMenu().runCommand("thread.delete", position)).toBe(true);
    await state.completed.promise;
    expect(state.effects).toEqual([]);
  });

  it("leaves the key alone without a thread", () => {
    const menu = useThreadActionMenu({
      threadRef: null,
      projectCwd: null,
      onStartRename: () => recordEffect("rename"),
      canShareWithGuest: false,
    });
    expect(menu.runCommand("thread.rename", position)).toBe(false);
    expect(state.effects).toEqual([]);
  });
});
