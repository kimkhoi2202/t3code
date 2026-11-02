import { describe, expect, it } from "vite-plus/test";

import { nextDeliverableQueuedRun, queuedRunsInDeliveryOrder } from "./QueuedRunOrder.ts";

describe("queued run delivery order", () => {
  it("keeps automatic completion delivery ahead of visible queued messages", () => {
    const projection = {
      messages: [
        { id: "message:visible-first" },
        {
          id: "message:automatic",
          delegatedCompletion: {
            generation: 1,
            parentRunId: "run:parent",
            taskIds: ["task:child"],
          },
        },
        { id: "message:visible-second" },
      ],
      runs: [
        {
          id: "run:visible-first",
          ordinal: 2,
          queuePosition: 1,
          status: "queued",
          userMessageId: "message:visible-first",
        },
        {
          id: "run:automatic",
          ordinal: 4,
          queuePosition: 3,
          status: "queued",
          userMessageId: "message:automatic",
        },
        {
          id: "run:visible-second",
          ordinal: 3,
          queuePosition: 2,
          status: "queued",
          userMessageId: "message:visible-second",
        },
      ],
    } as never;

    expect(queuedRunsInDeliveryOrder(projection).map((run) => run.id)).toEqual([
      "run:automatic",
      "run:visible-first",
      "run:visible-second",
    ]);
  });

  it("stops at a message paused for an edit instead of skipping past it", () => {
    const run = (id: string, position: number, flags: object = {}) => ({
      id,
      ordinal: position,
      queuePosition: position,
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
    // A completion delivery goes ahead of every queued message, so the pause does not stop it.
    expect(next([run("paused", 1, paused), run("wake", 2)], ["wake"])).toBe("wake");
  });
});
