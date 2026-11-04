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
  children = "The quick brown fox jumps over the lazy dog.",
}: {
  toolbar: React.Ref<AssistantSelectionToolbarHandle>;
  onCite: (citation: AssistantCitation) => boolean;
  children?: React.ReactNode;
}) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  return (
    <>
      <div ref={setViewport}>
        <p data-assistant-citation-source="assistant-message">{children}</p>
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

it.each([
  {
    paragraph: "plain text",
    content: "The quick brown fox jumps over the lazy dog.",
    clicked: "The quick brown fox jumps over the lazy dog.",
    cited: "The quick brown fox jumps over the lazy dog.",
  },
  {
    // The browser's own triple-click stops at an inline-flex chip, such as a thread link.
    paragraph: "a chip",
    content: (
      <>
        Your other thread,{" "}
        <a href="#thread" style={{ display: "inline-flex" }}>
          <span>Design Research</span>
        </a>
        <span>, is running a review workflow.</span>
      </>
    ),
    clicked: ", is running a review workflow.",
    cited: "Your other thread, Design Research, is running a review workflow.",
  },
])(
  "a triple-click cites the whole paragraph with $paragraph",
  async ({ content, clicked, cited }) => {
    const onCite = vi.fn((_citation: AssistantCitation) => true);
    const toolbar = createRef<AssistantSelectionToolbarHandle>();
    await using _screen = await render(
      <Reply toolbar={toolbar} onCite={onCite}>
        {content}
      </Reply>,
    );

    await userEvent.tripleClick(page.getByText(clicked));

    await vi.waitFor(() => expect(onCite).toHaveBeenCalledTimes(1));
    expect(onCite.mock.calls[0]![0].text).toBe(cited);
  },
);
