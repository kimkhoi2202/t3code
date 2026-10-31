import {
  COMPOSER_CONTEXT_MAX_RECORDS,
  COMPOSER_CONTEXT_MAX_SERIALIZED_CHARS,
  getProviderAttachmentLimitError,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ComposerContextId,
  type ComposerContextRecord,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
} from "@t3tools/contracts";

import {
  formatComposerContextReference,
  isAttachmentOnlyBootstrapPrompt,
  replaceComposerContextReferences,
  toComposerContextId,
} from "./composerContextReferences.ts";
import {
  isSlashCommandPrompt,
  modelSelectionsEqual,
  stripClaudePromptEffortPrefix,
} from "./model.ts";

type MergeRun = Pick<
  OrchestrationV2Run,
  | "delegatedTaskId"
  | "modelSelection"
  | "restartContinuationOfRunId"
  | "sourcePlanRef"
  | "workspacePreparation"
>;

type MergeMessage = Pick<
  OrchestrationV2ConversationMessage,
  | "attachments"
  | "context"
  | "createdBy"
  | "delegatedCompletion"
  | "notification"
  | "scheduledTaskId"
  | "senderThreadId"
  | "text"
  | "workflowScript"
>;

interface MergeEntry<R, M> {
  readonly run: R;
  readonly message: M;
}

type MergeGroup<R, M> = [MergeEntry<R, M>, ...Array<MergeEntry<R, M>>];

/** Commands, other senders' messages, and runs tied to other work would change meaning if merged. */
function isPlainPrompt(run: MergeRun, message: MergeMessage): boolean {
  return (
    message.createdBy === "user" &&
    message.context?.guest === undefined &&
    message.scheduledTaskId === undefined &&
    message.senderThreadId === undefined &&
    message.workflowScript !== true &&
    !isSlashCommandPrompt(message.text) &&
    run.delegatedTaskId === undefined &&
    run.restartContinuationOfRunId === undefined &&
    run.sourcePlanRef === undefined &&
    run.workspacePreparation === undefined
  );
}

function fitsInOneMessage(merged: ReturnType<typeof mergeQueuedMessages>): boolean {
  const records = merged.context?.records ?? [];
  return (
    merged.text.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS &&
    getProviderAttachmentLimitError(merged.attachments) === undefined &&
    records.length <= COMPOSER_CONTEXT_MAX_RECORDS &&
    JSON.stringify(records).length <= COMPOSER_CONTEXT_MAX_SERIALIZED_CHARS
  );
}

/**
 * The queued runs that merge, in groups of two or more. Merging never reorders the queue, so a
 * group is a stretch of neighbours that share a model selection; a message that stays separate
 * ends it, and one that would overflow a single message starts the next. The first run of a group
 * survives. Automatic deliveries aren't in the user's queue, so they don't separate neighbours.
 */
export function planQueuedRunMerge<R extends MergeRun, M extends MergeMessage>(
  entries: ReadonlyArray<{ readonly run: R; readonly message?: M | undefined }>,
): ReadonlyArray<Readonly<MergeGroup<R, M>>> {
  const groups: Array<MergeGroup<R, M>> = [];
  let open: MergeGroup<R, M> | null = null;
  for (const { run, message } of entries) {
    if (message?.delegatedCompletion !== undefined || message?.notification !== undefined) continue;
    if (message === undefined || !isPlainPrompt(run, message)) {
      open = null;
    } else if (
      open !== null &&
      modelSelectionsEqual(open[0].run.modelSelection, run.modelSelection) &&
      fitsInOneMessage(mergeQueuedMessages([...open.map((entry) => entry.message), message]))
    ) {
      open.push({ run, message });
    } else {
      open = [{ run, message }];
      groups.push(open);
    }
  }
  return groups.filter((group) => group.length > 1);
}

/** Keeps records in first-use order. A context id reused for other content gets a new id. */
function mergeContext(messages: ReadonlyArray<MergeMessage>) {
  const records = new Map<ComposerContextId, ComposerContextRecord>();
  const texts = messages.map(({ text, context }) => {
    const renamed = new Map<ComposerContextId, ComposerContextId>();
    for (const record of context?.records ?? []) {
      const existing = records.get(record.contextId);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(record)) {
        let copy = 2;
        while (records.has(toComposerContextId(`${record.contextId}-${copy}`))) copy += 1;
        renamed.set(record.contextId, toComposerContextId(`${record.contextId}-${copy}`));
      }
    }
    for (const record of context?.records ?? []) {
      const contextId = renamed.get(record.contextId) ?? record.contextId;
      if (records.has(contextId)) continue;
      const screenshotId =
        "screenshotContextId" in record && record.screenshotContextId !== undefined
          ? renamed.get(record.screenshotContextId)
          : undefined;
      records.set(contextId, {
        ...record,
        contextId,
        ...(screenshotId === undefined ? {} : { screenshotContextId: screenshotId }),
      });
    }
    return renamed.size === 0
      ? text
      : replaceComposerContextReferences(text, (occurrence) => {
          const contextId = renamed.get(occurrence.contextId);
          return contextId === undefined
            ? occurrence.source
            : formatComposerContextReference({ ...occurrence, contextId });
        });
  });
  return { texts, records: [...records.values()] };
}

/** One message's content in queue order. Repeated attachments and identical records appear once. */
export function mergeQueuedMessages(messages: ReadonlyArray<MergeMessage>) {
  const { texts, records } = mergeContext(messages);
  // An attachment-only message has placeholder words, needed only if no message has real ones.
  const [lead = texts[0] ?? "", ...rest] = texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && !isAttachmentOnlyBootstrapPrompt(text));
  // Runs in a group share their effort, so its prefix only needs to open the merged text.
  const leadHasEffortPrefix = stripClaudePromptEffortPrefix(lead) !== lead;
  return {
    text: [
      lead,
      ...rest.map((prompt) =>
        leadHasEffortPrefix ? stripClaudePromptEffortPrefix(prompt) : prompt,
      ),
    ].join("\n\n"),
    attachments: [
      ...new Map(
        messages.flatMap((message) => message.attachments).map((item) => [item.id, item] as const),
      ).values(),
    ],
    ...(records.length === 0 ? {} : { context: { version: 1 as const, records } }),
  };
}
