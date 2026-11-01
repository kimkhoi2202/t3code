import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadActionMenuItems,
  findThreadMenuEntry,
  type ThreadActionMenuState,
} from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });
});

describe("findThreadMenuEntry", () => {
  it.each([
    ["thread.snooze", {}, "snooze"],
    ["thread.snooze", { isSnoozed: true }, "unsnooze"],
    ["thread.toggleAutoSettle", { autoSettleEnabled: true }, "auto-settle:disabled"],
    ["thread.toggleAutoSettle", { autoSettleEnabled: false }, "auto-settle:enabled"],
  ] as const)("%s in %j stands for %s", (command, state, id) => {
    const items = buildThreadActionMenuItems({ ...baseState, ...state });
    expect(findThreadMenuEntry(items, command)?.id).toBe(id);
  });

  it("finds nothing the menu is not offering", () => {
    const items = buildThreadActionMenuItems(baseState);
    expect(findThreadMenuEntry(items, "thread.copyBranch")).toBeUndefined();
    expect(findThreadMenuEntry(items, "thread.newOnBranch")).toBeUndefined();
    expect(findThreadMenuEntry(items, "thread.shareWithGuest")).toBeUndefined();
  });
});
