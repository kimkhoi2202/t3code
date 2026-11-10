import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupProviderModelItemsByModel } from "./modelOrdering";

describe("groupProviderModelItemsByModel", () => {
  it("keeps each model's instances together in the order given", () => {
    const item = (driverKind: string, instanceId: string, slug: string) => ({
      driverKind: ProviderDriverKind.make(driverKind),
      instanceId: ProviderInstanceId.make(instanceId),
      slug,
    });

    const grouped = groupProviderModelItemsByModel([
      item("codex", "codex", "gpt"),
      item("claudeAgent", "claudeAgent", "opus"),
      item("claudeAgent", "claudeAgent", "fable"),
      item("claudeAgent", "claudeAgent_work", "opus"),
      item("claudeAgent", "claudeAgent_work", "fable"),
      item("cursor", "cursor", "opus"),
    ]);

    expect(grouped.map((model) => `${model.instanceId}:${model.slug}`)).toEqual([
      "codex:gpt",
      "claudeAgent:opus",
      "claudeAgent_work:opus",
      "claudeAgent:fable",
      "claudeAgent_work:fable",
      "cursor:opus",
    ]);
  });
});
