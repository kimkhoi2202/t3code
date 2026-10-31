import { Check, Copy } from "lucide";
import { useRef, type ComponentProps } from "react";

import { canWriteImageToClipboard, useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  serializeTableElementToCsv,
  serializeTableElementToMarkdown,
} from "../../markdown-clipboard";
import { MorphIcon } from "../MorphIcon";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { reportMarkdownActionFailure } from "./markdownActionFailure";
import { renderTableImage, type TableImageTheme } from "./markdownTableImage";

export function MarkdownTable({ children, ...props }: ComponentProps<"table">) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const {
    copyToClipboard,
    copyImageToClipboard,
    isCopied: copied,
  } = useCopyToClipboard<"markdown" | "csv" | "png">({
    timeout: 1200,
    target: "table",
    onError: (cause, format) =>
      reportMarkdownActionFailure({ operation: "copy-table", format }, cause),
  });
  const copyLabel = copied ? "Copied" : "Copy table";

  const handleCopy = (format: "markdown" | "csv") => {
    const table = containerRef.current?.querySelector("table");
    if (!table) return;
    copyToClipboard(
      format === "markdown"
        ? serializeTableElementToMarkdown(table)
        : serializeTableElementToCsv(table),
      format,
    );
  };

  const handleCopyImage = (theme: TableImageTheme) => {
    const table = containerRef.current?.querySelector("table");
    if (!table) return;
    copyImageToClipboard(renderTableImage(table, theme), "png");
  };

  return (
    <div ref={containerRef} className="chat-markdown-table-container">
      <ScrollArea radius="none" chainVerticalScroll scrollFade className="w-full max-w-full">
        <table {...props}>{children}</table>
      </ScrollArea>
      {/* Stays within the row's px-1: the chat lane clips sideways overflow. */}
      <div className="mt-0.5 -mx-1 flex items-center justify-end select-none">
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost-muted"
                      size="icon-xs"
                      aria-label={copyLabel}
                    />
                  }
                />
              }
            >
              <MorphIcon className="size-3" icon={copied ? Check : Copy} />
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end">
            <MenuItem onClick={() => handleCopy("markdown")}>Copy as Markdown</MenuItem>
            <MenuItem onClick={() => handleCopy("csv")}>Copy as CSV</MenuItem>
            {canWriteImageToClipboard() ? (
              <MenuSub>
                <MenuSubTrigger>Copy as image</MenuSubTrigger>
                <MenuSubPopup>
                  <MenuItem onClick={() => handleCopyImage("dark")}>Dark</MenuItem>
                  <MenuItem onClick={() => handleCopyImage("light")}>Light</MenuItem>
                </MenuSubPopup>
              </MenuSub>
            ) : null}
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}
