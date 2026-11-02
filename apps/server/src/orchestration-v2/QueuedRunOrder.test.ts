import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { nextDeliverableQueuedRun, queuedRunsInDeliveryOrder } from "./QueuedRunOrder.ts";

const at = (time: string) => DateTime.makeUnsafe(`2026-01-01T${time}Z`);
const delegatedCompletion = {
  generation: 1,
  parentRunId: "run:parent",
  taskIds: ["task:child"],
};

describe("queued run delivery order", () => {
  it("delivers completions and queued messages in request order, keeping manual queue order", () => {
    const projection = {
      messages: [
        { id: "message:old" },
        { id: "message:moved" },
        { id: "message:earlier-completion", delegatedCompletion },
        { id: "message:later-completion", delegatedCompletion },
      ],
      runs: [
        {
          id: "run:old",
          ordinal: 3,
          queuePosition: 2,
          requestedAt: at("10:00:00"),
          status: "queued",
          userMessageId: "message:old",
        },
        {
          id: "run:moved",
          ordinal: 4,
          queuePosition: 1,
          requestedAt: at("10:02:00"),
          status: "queued",
          userMessageId: "message:moved",
        },
        {
          id: "run:earlier-completion",
          ordinal: 2,
          queuePosition: 3,
          requestedAt: at("09:59:00"),
          status: "queued",
          userMessageId: "message:earlier-completion",
        },
        {
          id: "run:later-completion",
          ordinal: 5,
          queuePosition: 4,
          requestedAt: at("10:03:00"),
          status: "queued",
          userMessageId: "message:later-completion",
        },
      ],
    } as never;

    expect(queuedRunsInDeliveryOrder(projection).map((run) => run.id)).toEqual([
      "run:earlier-completion",
      "run:moved",
      "run:old",
      "run:later-completion",
    ]);
  });

  it("stops at a message paused for an edit instead of skipping past it", () => {
    const run = (id: string, position: number, flags: object = {}) => ({
      id,
      ordinal: position,
      queuePosition: position,
      requestedAt: at(`10:0${position}:00`),
      status: "queued",
      userMessageId: `message:${id}`,
      ...flags,
    });
    const next = (runs: ReadonlyArray<object>, automatic: ReadonlyArray<string> = []) =>
      nextDeliverableQueuedRun({
        messages: automatic.map((id) => ({
          id: `message:${id}`,
          delegatedCompletion: { generation: 1, parentRunId: "run:parent", taskIds: [] },
        })),
        runs,
      } as never)?.id;
    const held = { queueHeld: true };
    const paused = { queuePausedForEdit: true };

    // Held runs are passed over, but only up to the paused one.
    expect(next([run("held", 1, held), run("ahead", 2), run("paused", 3, paused)])).toBe("ahead");
    expect(
      next([run("held", 1, held), run("paused", 2, paused), run("behind", 3)]),
    ).toBeUndefined();
    expect(next([run("paused", 1, { ...paused, ...held }), run("behind", 2)])).toBeUndefined();
    // A completion requested before the paused message goes first; one requested after waits.
    const earlier = { requestedAt: at("09:00:00") };
    expect(next([run("paused", 1, paused), run("wake", 2, earlier)], ["wake"])).toBe("wake");
    expect(next([run("paused", 1, paused), run("wake", 2)], ["wake"])).toBeUndefined();
  });
});
