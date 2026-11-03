import { EnvironmentId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { createRef, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  AssistantSelectionToolbar,
  type AssistantSelectionToolbarHandle,
} from "./AssistantSelectionToolbar";

function Reply({
  toolbar,
  onCite,
}: {
  toolbar: React.Ref<AssistantSelectionToolbarHandle>;
  onCite: (citation: AssistantCitation) => boolean;
}) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  return (
    <>
      <div ref={setViewport}>
        <p data-assistant-citation-source="assistant-message">
          The quick brown fox jumps over the lazy dog.
        </p>
      </div>
      <AssistantSelectionToolbar
        ref={toolbar}
        viewport={viewport}
        threadRef={{ environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") }}
        onCite={onCite}
      />
    </>
  );
}

it("the cite shortcut cites a selection before the Cite button appears", async () => {
  const onCite = vi.fn((_citation: AssistantCitation) => true);
  const toolbar = createRef<AssistantSelectionToolbarHandle>();
  await using screen = await render(<Reply toolbar={toolbar} onCite={onCite} />);
  const text = screen.container.querySelector("p")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, "The quick ".length);
  range.setEnd(text, "The quick brown fox".length);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);

  // Pressed at once, before the button's delayed appearance records the selection.
  expect(toolbar.current!.citeSelection()).toBe(true);
  expect(onCite).toHaveBeenCalledTimes(1);
  expect(onCite.mock.calls[0]![0].text).toBe("brown fox");
});

it("a triple-click cites the paragraph it selects", async () => {
  const onCite = vi.fn((_citation: AssistantCitation) => true);
  const toolbar = createRef<AssistantSelectionToolbarHandle>();
  await using _screen = await render(<Reply toolbar={toolbar} onCite={onCite} />);

  await userEvent.tripleClick(page.getByText("The quick brown fox jumps over the lazy dog."));

  await vi.waitFor(() => expect(onCite).toHaveBeenCalledTimes(1));
  expect(onCite.mock.calls[0]![0].text).toBe("The quick brown fox jumps over the lazy dog.");
});
