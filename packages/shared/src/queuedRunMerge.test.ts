import {
  COMPOSER_CONTEXT_MAX_RECORDS,
  EnvironmentId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderInstanceId,
  ThreadId,
  type ChatAttachment,
  type ComposerContextId,
  type ComposerContextRecord,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { serializeAssistantCitation } from "./assistantCitations.ts";
import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  collectComposerContextReferences,
  formatComposerContextReference,
  projectComposerContextForProvider,
} from "./composerContextReferences.ts";
import { createModelSelection } from "./model.ts";
import { mergeQueuedMessages, planQueuedRunMerge } from "./queuedRunMerge.ts";

const opus = createModelSelection(ProviderInstanceId.make("claude"), "opus");

type Run = Parameters<typeof planQueuedRunMerge>[0][number]["run"];
type Message = Pick<
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

function message(text: string, overrides: Partial<Message> = {}): Message {
  return { text, attachments: [], createdBy: "user", ...overrides };
}

function entry(text: string, overrides: Partial<Message> = {}, run: Partial<Run> = {}) {
  return { run: { modelSelection: opus, ...run }, message: message(text, overrides) };
}

const groupTexts = (entries: Parameters<typeof planQueuedRunMerge>[0]) =>
  planQueuedRunMerge(entries).map((group) => group.map((item) => item.message.text));

function file(id: string): ChatAttachment {
  return { type: "file", id, name: `${id}.txt`, mimeType: "text/plain", sizeBytes: 1 };
}

function mention(id: string, path: string): ComposerContextRecord {
  return {
    version: 1,
    kind: "mention",
    contextId: id as ComposerContextId,
    label: path,
    path,
  };
}

function mentionLink(id: string, label: string) {
  return formatComposerContextReference({
    kind: "mention",
    contextId: id as ComposerContextId,
    label,
  });
}

describe("planQueuedRunMerge", () => {
  it("groups the whole queue when everything is a plain prompt", () => {
    expect(groupTexts([entry("a"), entry("b"), entry("c")])).toEqual([["a", "b", "c"]]);
  });

  it("has nothing to merge with fewer than two neighbours", () => {
    expect(groupTexts([])).toEqual([]);
    expect(groupTexts([entry("a")])).toEqual([]);
    expect(groupTexts([entry("a"), entry("/compact")])).toEqual([]);
  });

  it.each([
    ["a provider command", entry("/compact")],
    ["a command with arguments", entry("/goal ship it")],
    ["a guest's message", entry("hi", { context: guestContext() })],
    ["an agent's message", entry("hi", { createdBy: "agent" })],
    ["an automation", entry("hi", { scheduledTaskId: "task:1" as never })],
    ["another thread's message", entry("hi", { senderThreadId: ThreadId.make("thread:other") })],
    ["a workflow script", entry("run()", { workflowScript: true })],
    ["a plan implementation", entry("do it", {}, { sourcePlanRef: {} as never })],
    [
      "a restart continuation",
      entry("go on", {}, { restartContinuationOfRunId: "run:1" as never }),
    ],
    ["a delegated task", entry("go on", {}, { delegatedTaskId: "node:1" as never })],
    ["worktree setup", entry("go on", {}, { workspacePreparation: { type: "root" } })],
  ])("stays separate, and never reorders around, %s", (_label, separate) => {
    expect(groupTexts([entry("a"), entry("b"), separate, entry("c"), entry("d")])).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("treats a path or mid-text slash as ordinary words", () => {
    expect(groupTexts([entry("/etc/hosts is wrong"), entry("see\n/compact")])).toHaveLength(1);
  });

  it("merges $skill mentions, which work anywhere in a prompt", () => {
    expect(groupTexts([entry("$review this"), entry("and $deploy that")])).toHaveLength(1);
  });

  it("skips automatic deliveries, which are not in the user's queue", () => {
    const notification = {
      source: { kind: "system" as const },
      outcome: "completed" as const,
      summary: "Done",
    };
    const delegatedCompletion = {
      parentRunId: "run:1" as never,
      generation: 1 as never,
      taskIds: [],
    };
    expect(
      groupTexts([
        entry("wake", { delegatedCompletion }),
        entry("a"),
        entry("ping", { notification }),
        entry("b"),
      ]),
    ).toEqual([["a", "b"]]);
  });

  it("keeps a run whose message is not loaded apart from its neighbours", () => {
    expect(
      groupTexts([entry("a"), { run: { modelSelection: opus } as OrchestrationV2Run }, entry("b")]),
    ).toEqual([]);
  });

  it("keeps different model selections apart", () => {
    const high = createModelSelection(ProviderInstanceId.make("claude"), "opus", [
      { id: "effort", value: "high" },
    ]);
    const codex = createModelSelection(ProviderInstanceId.make("codex"), "opus");
    const haiku = createModelSelection(ProviderInstanceId.make("claude"), "haiku");
    expect(
      groupTexts([
        entry("a"),
        entry("b"),
        entry("c", {}, { modelSelection: high }),
        entry("d", {}, { modelSelection: high }),
        entry("e", {}, { modelSelection: codex }),
        entry("f", {}, { modelSelection: haiku }),
      ]),
    ).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it.each([
    [
      "text",
      () => [
        entry("x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 10)),
        entry("y".repeat(20)),
        entry("z"),
      ],
    ],
    [
      "attachments",
      () => [
        entry("x", {
          attachments: Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS }, (_, index) =>
            file(`a${index}`),
          ),
        }),
        entry("y", { attachments: [file("b")] }),
        entry("z"),
      ],
    ],
    [
      "context records",
      () => [
        entry("x", {
          context: {
            version: 1,
            records: Array.from({ length: COMPOSER_CONTEXT_MAX_RECORDS }, (_, index) =>
              mention(`m${index}`, `/m${index}`),
            ),
          },
        }),
        entry("y", { context: { version: 1, records: [mention("n", "/n")] } }),
        entry("z"),
      ],
    ],
  ])("starts a new group instead of overflowing %s", (_label, makeEntries) => {
    const [first, second, third] = makeEntries();
    expect(groupTexts([first!, second!, third!])).toEqual([[second!.message.text, "z"]]);
  });
});

describe("mergeQueuedMessages", () => {
  it("joins prompts in order, keeping citations and context links in place", () => {
    const quote = serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("environment:test"),
      threadId: ThreadId.make("thread:test"),
      messageId: MessageId.make("message:assistant"),
      text: "Cache the parsed config.",
      start: 0,
      end: 24,
      prefix: "",
      suffix: "",
      comment: "Why?",
    });
    const merged = mergeQueuedMessages([
      message(`  ${quote} first  `),
      message(`second ${mentionLink("m1", "a.ts")}`, {
        context: { version: 1, records: [mention("m1", "/a.ts")] },
      }),
    ]);
    expect(merged.text).toBe(`${quote} first\n\nsecond ${mentionLink("m1", "a.ts")}`);
    expect(merged.context?.records).toEqual([mention("m1", "/a.ts")]);
  });

  it("keeps every attachment once, in order", () => {
    const merged = mergeQueuedMessages([
      message("a", { attachments: [file("one"), file("two")] }),
      message("b", { attachments: [file("two"), file("three")] }),
    ]);
    expect(merged.attachments.map((attachment) => attachment.id)).toEqual(["one", "two", "three"]);
  });

  it("drops the attachment-only placeholder when real words exist", () => {
    const merged = mergeQueuedMessages([
      message(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT, { attachments: [file("one")] }),
      message("look at this"),
      message(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT, { attachments: [file("two")] }),
    ]);
    expect(merged.text).toBe("look at this");
    expect(merged.attachments).toHaveLength(2);
  });

  it("keeps the placeholder when every message is attachments only", () => {
    const merged = mergeQueuedMessages([
      message(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT, { attachments: [file("one")] }),
      message(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT, { attachments: [file("two")] }),
    ]);
    expect(merged.text).toBe(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT);
  });

  it("opens with the effort prefix once", () => {
    expect(
      mergeQueuedMessages([
        message("Ultrathink:\na"),
        message("Ultrathink:\nb"),
        message(`Ultrathink:\n${ATTACHMENT_ONLY_BOOTSTRAP_PROMPT}`),
      ]).text,
    ).toBe("Ultrathink:\na\n\nb");
    expect(
      mergeQueuedMessages([
        message(`Ultrathink:\n${ATTACHMENT_ONLY_BOOTSTRAP_PROMPT}`),
        message("Ultrathink:\nb"),
        message("Ultrathink:\nc"),
      ]).text,
    ).toBe("Ultrathink:\nb\n\nc");
  });

  it("keeps a prefix the first prompt did not add, since a person wrote it", () => {
    expect(mergeQueuedMessages([message("a"), message("Ultrathink:\nb")]).text).toBe(
      "a\n\nUltrathink:\nb",
    );
  });

  it("collapses an identical record and renames one that differs", () => {
    const merged = mergeQueuedMessages([
      message(`${mentionLink("same", "a")} ${mentionLink("clash", "b")}`, {
        context: { version: 1, records: [mention("same", "/a"), mention("clash", "/b")] },
      }),
      message(`${mentionLink("same", "a")} ${mentionLink("clash", "c")}`, {
        context: { version: 1, records: [mention("same", "/a"), mention("clash", "/c")] },
      }),
    ]);
    expect(merged.context?.records.map((record) => record.contextId)).toEqual([
      "same",
      "clash",
      "clash-2",
    ]);
    expect(
      collectComposerContextReferences(merged.text).map((reference) => reference.contextId),
    ).toEqual(["same", "clash", "same", "clash-2"]);
    const projected = projectComposerContextForProvider({
      text: merged.text,
      records: merged.context?.records ?? [],
    });
    expect(projected).toContain("path: /b");
    expect(projected).toContain("path: /c");
    expect(projected).not.toContain('unavailable="true"');
  });

  it("points a renamed preview annotation at its renamed screenshot", () => {
    const screenshot = (name: string): ComposerContextRecord => ({
      version: 1,
      kind: "image",
      contextId: "shot" as ComposerContextId,
      label: name,
      attachmentId: name,
      name,
      mimeType: "image/png",
      sizeBytes: 1,
    });
    const annotation = (comment: string): ComposerContextRecord => ({
      version: 1,
      kind: "preview-annotation",
      contextId: "note" as ComposerContextId,
      label: comment,
      annotationId: "note",
      pageUrl: "https://example.com",
      pageTitle: null,
      comment,
      targetSummary: "",
      styleChanges: [],
      screenshotContextId: "shot" as ComposerContextId,
    });
    const merged = mergeQueuedMessages([
      message("a", { context: { version: 1, records: [screenshot("one"), annotation("one")] } }),
      message("b", { context: { version: 1, records: [screenshot("two"), annotation("two")] } }),
    ]);
    const renamed = merged.context?.records.find((record) => record.contextId === "note-2");
    expect(renamed).toMatchObject({ comment: "two", screenshotContextId: "shot-2" });
  });

  it("carries no context when no message has any", () => {
    expect(mergeQueuedMessages([message("a"), message("b")])).not.toHaveProperty("context");
  });
});

function guestContext(): NonNullable<Message["context"]> {
  return {
    version: 1,
    guest: { guestMessageId: "guest:1" as never, name: "Sam", text: "hi" },
    records: [],
  };
}
