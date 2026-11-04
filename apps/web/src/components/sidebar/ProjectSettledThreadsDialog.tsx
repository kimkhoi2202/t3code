import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeCanArchive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  resolveSettledThreadTimestamp,
  sortSettledThreads,
} from "@t3tools/client-runtime/state/thread-sort";
import type { OlderSettledScope } from "@t3tools/client-runtime/state/threads";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, Undo2Icon } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { isContextMenuOpen } from "../../contextMenu";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { readLocalApi } from "../../localApi";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useDelegatedUnderParent, useQuietThreadShells } from "../../state/entities";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../../state/olderSettledShelf";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { ProjectFavicon } from "../ProjectFavicon";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { RelativeTimeLabel } from "./SidebarThreadRow";

const PAGE_COUNT = 50;

function olderSettledScopes(group: SidebarProjectSnapshot): OlderSettledScope[] {
  const environmentIds = [...new Set(group.memberProjectRefs.map((ref) => ref.environmentId))];
  return environmentIds.map((environmentId) => ({
    environmentId,
    projectIds: group.memberProjectRefs.flatMap((ref) =>
      ref.environmentId === environmentId ? [ref.projectId] : [],
    ),
  }));
}

/** The project's Settled shelf on its own: the same rows, order, and older pages. */
function useProjectSettledThreads(group: SidebarProjectSnapshot, visibleCount: number) {
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const projectKeys = new Set(
    group.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`),
  );
  const visible = filterSidebarV2VisibleThreads(threads, projectKeys, delegatedUnderParent);
  const settled = sortSettledThreads(
    visible.filter((thread) => thread.settledOverride === "settled"),
  );
  const shelf = useOlderSettledShelf({
    scopes: olderSettledScopes(group),
    expanded: true,
    visibleCount,
  });
  const listed = settled.filter(shelf.isListed);
  useOlderSettledShelfGrowth(shelf, listed);
  return {
    threads: listed.slice(0, visibleCount),
    total: settled.length + shelf.unloadedCount(visible),
    shelf,
  };
}

function reportFailure(result: AtomCommandResult<unknown, unknown>, title: string) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function ProjectSettledThreadsDialog(props: {
  readonly group: SidebarProjectSnapshot;
  readonly onClose: () => void;
  readonly onOpenThread: (threadRef: ScopedThreadRef) => void;
}) {
  const { group, onOpenThread } = props;
  const [visibleCount, setVisibleCount] = useState(PAGE_COUNT);
  const popupRef = useRef<HTMLDivElement>(null);
  const { threads, total, shelf } = useProjectSettledThreads(group, visibleCount);
  const { unsettleThread, archiveThread, confirmAndDeleteThread } = useThreadActions();
  const confirmThreadArchive = useClientSettings((settings) => settings.confirmThreadArchive);
  const hiddenCount = Math.max(0, total - threads.length);

  const unsettle = async (threadRef: ScopedThreadRef) =>
    reportFailure(await unsettleThread(threadRef), "Failed to un-settle thread");

  const showThreadMenu = async (
    thread: EnvironmentThreadShell,
    position: { x: number; y: number },
  ) => {
    const api = readLocalApi();
    if (!api) return;
    const threadRef = scopeThreadRef(thread.environmentId, thread.id);
    const canOperate = readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
    const clicked = await settlePromise(() =>
      api.contextMenu.show(
        [
          { id: "open", label: "Open thread", icon: "message-square" },
          {
            id: "unsettle",
            label: "Un-settle thread",
            icon: "circle-check",
            disabled: !canOperate,
          },
          {
            id: "archive",
            label: "Archive thread",
            icon: "archive",
            disabled: !canOperate || !threadRuntimeCanArchive(thread.runtime),
            separatorBefore: true,
          },
          {
            id: "delete",
            label: "Delete",
            icon: "trash",
            destructive: true,
            disabled: !canOperate,
          },
        ],
        position,
      ),
    );
    if (clicked._tag === "Failure") return;
    switch (clicked.value) {
      case "open":
        onOpenThread(threadRef);
        return;
      case "unsettle":
        await unsettle(threadRef);
        return;
      case "archive": {
        if (confirmThreadArchive) {
          const confirmed = await settlePromise(() =>
            api.dialogs.confirm(`Archive thread "${thread.title}"?`),
          );
          if (confirmed._tag === "Failure" || !confirmed.value) return;
        }
        reportFailure(await archiveThread(threadRef), "Failed to archive thread");
        return;
      }
      case "delete":
        reportFailure(await confirmAndDeleteThread(threadRef), "Failed to delete thread");
        return;
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        // Escape belongs to a row's open context menu first.
        if (eventDetails.reason === "escape-key" && isContextMenuOpen()) {
          eventDetails.cancel();
          return;
        }
        props.onClose();
      }}
    >
      {/* The popup takes focus, so no row shows a focus highlight until Tab reaches it. */}
      <DialogPopup ref={popupRef} initialFocus={popupRef} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settled threads</DialogTitle>
          <DialogDescription>
            <span className="flex min-w-0 items-center gap-1.5">
              <ProjectFavicon project={group} className="size-3.5 shrink-0" />
              <span className="truncate">{group.displayName}</span>
              <span className="shrink-0 tabular-nums">
                · {total} {total === 1 ? "thread" : "threads"}
              </span>
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {threads.length === 0 && hiddenCount === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              No settled threads in this project.
            </p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {threads.map((thread) => (
                <SettledThreadRow
                  key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
                  thread={thread}
                  onOpen={onOpenThread}
                  onUnsettle={(threadRef) => void unsettle(threadRef)}
                  onContextMenu={(position) => void showThreadMenu(thread, position)}
                />
              ))}
            </ul>
          )}
          {hiddenCount > 0 ? (
            <Button
              type="button"
              variant="ghost-muted"
              size="sm"
              disabled={shelf.loading}
              onClick={() => {
                shelf.retry();
                setVisibleCount((count) => count + PAGE_COUNT);
              }}
            >
              {shelf.loading ? <Spinner size="sm" tone="muted" /> : <ChevronDownIcon aria-hidden />}
              {shelf.loading
                ? "Loading"
                : shelf.failed
                  ? "Could not load older threads. Retry"
                  : `Show ${Math.min(hiddenCount, PAGE_COUNT)} more`}
            </Button>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function SettledThreadRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly onOpen: (threadRef: ScopedThreadRef) => void;
  readonly onUnsettle: (threadRef: ScopedThreadRef) => void;
  readonly onContextMenu: (position: { x: number; y: number }) => void;
}) {
  const { thread } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  return (
    <li
      className="group/settled-row relative"
      onContextMenu={(event) => {
        event.preventDefault();
        props.onContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none group-hover/settled-row:bg-accent group-focus-within/settled-row:bg-accent"
        onClick={() => props.onOpen(threadRef)}
      >
        <span className="min-w-0 flex-1 truncate text-foreground">{thread.title}</span>
        <span
          className={cn(
            "shrink-0 text-right text-muted-foreground text-xs tabular-nums",
            canOperate &&
              "w-24 group-hover/settled-row:invisible group-focus-within/settled-row:invisible pointer-coarse:invisible",
          )}
        >
          <RelativeTimeLabel timestamp={resolveSettledThreadTimestamp(thread)} />
        </span>
      </button>
      {canOperate ? (
        // Takes the time's place while the row is hovered or focused.
        <span className="absolute inset-y-0 right-1.5 flex items-center opacity-0 group-hover/settled-row:opacity-100 group-focus-within/settled-row:opacity-100 pointer-coarse:opacity-100">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => props.onUnsettle(threadRef)}
          >
            <Undo2Icon aria-hidden />
            Un-settle
          </Button>
        </span>
      ) : null}
    </li>
  );
}
