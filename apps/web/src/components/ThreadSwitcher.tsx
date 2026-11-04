import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { registerCommands } from "../shortcuts/dispatcher";
import { primaryServerKeybindingsAtom } from "../state/server";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { rankRecentThreadItems } from "./CommandPalette.logic";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { useCommandPaletteThreadItems } from "./CommandPaletteThreadItems";
import { Command, CommandDialog, CommandDialogPopup, CommandPanel } from "./ui/command";

type SwitcherModifier = "Control" | "Alt" | "Meta";

const SWITCHER_MODIFIERS: ReadonlyArray<SwitcherModifier> = ["Control", "Alt", "Meta"];

interface SwitcherOpening {
  readonly direction: 1 | -1;
  /** Releasing these opens the highlighted thread, like an app switcher. */
  readonly heldModifiers: ReadonlyArray<SwitcherModifier>;
}

/** Steps through the palette's Recent threads while the switcher chord is held. */
export function ThreadSwitcher() {
  const [opening, setOpening] = useState<SwitcherOpening | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the switcher's shortcuts with the keyboard dispatcher
  useEffect(() => {
    const open = (direction: 1 | -1) => (event: KeyboardEvent) => {
      if (isCommandPaletteOpen()) return false;
      event.preventDefault();
      setOpening({
        direction,
        heldModifiers: SWITCHER_MODIFIERS.filter((key) => event.getModifierState(key)),
      });
    };
    // Capture phase, so a focused terminal or editor cannot swallow the chord.
    return registerCommands(
      { "thread.switcher.next": open(1), "thread.switcher.previous": open(-1) },
      { capture: true },
    );
  }, []);

  return (
    <CommandDialog
      open={opening !== null}
      onOpenChange={(open) => {
        if (!open) setOpening(null);
      }}
    >
      {opening ? <ThreadSwitcherPopup opening={opening} onClose={() => setOpening(null)} /> : null}
    </CommandDialog>
  );
}

function ThreadSwitcherPopup(props: {
  readonly opening: SwitcherOpening;
  readonly onClose: () => void;
}) {
  const { opening, onClose } = props;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const target = resolveThreadRouteTarget(useParams({ strict: false }));
  const activeThread =
    target?.kind === "server"
      ? { environmentId: target.threadRef.environmentId, id: target.threadRef.threadId }
      : null;
  const { threadItems } = useCommandPaletteThreadItems({ activeThread, threadSearchQuery: "" });
  // Ranked once, so rows hold still while the highlight moves.
  const [items] = useState(() => rankRecentThreadItems(threadItems, activeThread));
  const [index, setIndex] = useState(() => (opening.direction === 1 ? 0 : items.length - 1));
  const panelRef = useRef<HTMLDivElement>(null);

  const step = (delta: number) => {
    if (items.length > 0) setIndex((current) => (current + delta + items.length) % items.length);
  };
  const openHighlighted = useEffectEvent(() => {
    const item = items[index];
    onClose();
    if (item) void item.run();
  });
  const close = useEffectEvent(onClose);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the held chord: steps on each press, opens the highlighted thread on release, cancels when the window loses focus
  useEffect(() => {
    const stepBy = (delta: number) => (event: KeyboardEvent) => {
      event.preventDefault();
      step(delta);
    };
    const unregister = registerCommands(
      { "thread.switcher.next": stepBy(1), "thread.switcher.previous": stepBy(-1) },
      {
        capture: true,
        onKeyDown: (event) => {
          if (event.key === "ArrowDown") stepBy(1)(event);
          else if (event.key === "ArrowUp") stepBy(-1)(event);
          else if (event.key === "Enter") {
            event.preventDefault();
            openHighlighted();
          } else return false;
        },
      },
    );
    const onKeyUp = (event: KeyboardEvent) => {
      const { heldModifiers } = opening;
      if (heldModifiers.length > 0 && !heldModifiers.some((key) => event.getModifierState(key))) {
        openHighlighted();
      }
    };
    const onBlur = () => close();
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      unregister();
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the popup mounts per opening, so its chord never changes
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the highlighted row visible as the chord moves past the panel's edge
  useEffect(() => {
    panelRef.current
      ?.querySelectorAll("[data-slot=command-item]")
      [index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <CommandDialogPopup aria-label="Switch thread" className="max-w-md">
      <Command mode="none">
        <CommandPanel
          ref={panelRef}
          className="flex max-h-[min(28rem,70vh)] min-h-0 flex-col"
          onContextMenu={(event) => {
            // The chord holds Control, and macOS turns Control+click into a right-click with no click.
            if (!event.ctrlKey) return;
            event.preventDefault();
            const rows = [
              ...(panelRef.current?.querySelectorAll("[data-slot=command-item]") ?? []),
            ];
            const { target } = event;
            const item =
              items[rows.findIndex((row) => target instanceof Node && row.contains(target))];
            if (!item) return;
            onClose();
            void item.run();
          }}
        >
          <CommandPaletteResults
            groups={items.length > 0 ? [{ value: "recent-threads", label: "Recent", items }] : []}
            highlightedItemValue={items[index]?.value ?? null}
            isActionsOnly={false}
            keybindings={keybindings}
            emptyStateMessage="No recent threads"
            onExecuteItem={(item) => {
              onClose();
              if (item.kind === "action") void item.run();
            }}
          />
        </CommandPanel>
      </Command>
    </CommandDialogPopup>
  );
}
