import type { OrchestrationV2Run, OrchestrationV2ThreadProjection } from "@t3tools/contracts";

export function isAutomaticCompletionRun(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "messages">,
  run: OrchestrationV2Run,
): boolean {
  return projection.messages.some(
    (message) => message.id === run.userMessageId && message.delegatedCompletion !== undefined,
  );
}

export function queuedRunsInDeliveryOrder(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "messages">,
): ReadonlyArray<OrchestrationV2Run> {
  const automaticCompletionMessageIds = new Set(
    projection.messages
      .filter((message) => message.delegatedCompletion !== undefined)
      .map((message) => message.id),
  );
  return projection.runs
    .filter((run) => run.status === "queued")
    .toSorted((left, right) => {
      const deliveryPriority =
        Number(automaticCompletionMessageIds.has(right.userMessageId)) -
        Number(automaticCompletionMessageIds.has(left.userMessageId));
      return (
        deliveryPriority ||
        (left.queuePosition ?? left.ordinal) - (right.queuePosition ?? right.ordinal) ||
        left.ordinal - right.ordinal
      );
    });
}

/**
 * The queued run to start next. Held runs wait for Resume and are passed over, but a run paused
 * for an edit stops the queue: nothing behind it may start with the old text still ahead of it.
 */
export function nextDeliverableQueuedRun(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "messages">,
): OrchestrationV2Run | undefined {
  for (const run of queuedRunsInDeliveryOrder(projection)) {
    if (run.queuePausedForEdit === true) return undefined;
    if (run.queueHeld !== true) return run;
  }
  return undefined;
}

export function withoutEditPause(run: OrchestrationV2Run): OrchestrationV2Run {
  const { queuePausedForEdit: _paused, ...rest } = run;
  return rest;
}
