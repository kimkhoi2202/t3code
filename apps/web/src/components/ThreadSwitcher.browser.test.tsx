import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { makeThreadFixture } from "../test-fixtures";
import type { Thread } from "../types";
import { ThreadSwitcher } from "./ThreadSwitcher";

const entities = vi.hoisted(() => ({ threads: [] as ReadonlyArray<Thread> }));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useProjects: () => [],
  useVisibleThreadShells: () => entities.threads,
}));
// The default ctrl+tab binding is desktop-only.
vi.mock(import("../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  return {
    ...(await original()),
    primaryServerKeybindingsAtom: Atom.make(
      compileResolvedKeybindingsConfig([{ key: "ctrl+tab", command: "thread.switcher.next" }]),
    ),
  };
});

function setup() {
  const environmentId = EnvironmentId.make("local");
  const projectId = ProjectId.make("acme");
  entities.threads = [
    makeThreadFixture({
      id: ThreadId.make("newer"),
      environmentId,
      projectId,
      title: "Newer thread",
      latestUserMessageAt: "2026-03-03T00:00:00.000Z",
    }),
    makeThreadFixture({
      id: ThreadId.make("older"),
      environmentId,
      projectId,
      title: "Older thread",
      latestUserMessageAt: "2026-03-02T00:00:00.000Z",
    }),
  ];
}

it("opens the thread Control+clicked while the chord holds the switcher open", async () => {
  setup();
  await using screen = await render(<ThreadSwitcher />);
  // No keyup follows, so Control stays held.
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true, cancelable: true }),
  );
  const row = page.getByRole("option", { name: /Older thread/ });
  await expect.element(row).toBeVisible();

  // macOS sends Control+click as a context menu event and never fires click.
  const controlClick = new MouseEvent("contextmenu", {
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  row.element().dispatchEvent(controlClick);

  expect(controlClick.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/local/older"));
  await expect.element(row).not.toBeInTheDocument();
});
