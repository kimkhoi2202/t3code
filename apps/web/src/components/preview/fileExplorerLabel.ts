import type {
  ExecutionEnvironmentPlatformOs,
  FileManagerRevealKind,
  ServerConfig,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

/** Components pass `useMessages()` so labels follow a language switch. */
export function revealInFileExplorerLabel(platform: string, resolve: MessageResolver = m): string {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return resolve(msg("Reveal in Finder"));
  if (normalized.includes("win")) return resolve(msg("Reveal in File Explorer"));
  return resolve(msg("Reveal in Files"));
}

export function revealInFileExplorerLabelForOs(
  os: ExecutionEnvironmentPlatformOs,
  resolve: MessageResolver = m,
): string {
  if (os === "darwin") return resolve(msg("Reveal in Finder"));
  if (os === "windows") return resolve(msg("Reveal in File Explorer"));
  return resolve(msg("Reveal in Files"));
}

export function revealInFileExplorerLabelForKind(
  kind: FileManagerRevealKind,
  resolve: MessageResolver = m,
): string {
  if (kind === "finder") return resolve(msg("Reveal in Finder"));
  if (kind === "file-explorer") return resolve(msg("Reveal in File Explorer"));
  return resolve(msg("Reveal in Files"));
}

/** The environment's reveal action label, or undefined when its machine cannot reveal paths. */
export function resolveRevealInFileManagerLabel(
  config:
    | Pick<
        ServerConfig,
        | "availableEditors"
        | "environment"
        | "shellRevealInFileManager"
        | "shellRevealInFileManagerKind"
      >
    | null
    | undefined,
  resolve: MessageResolver = m,
): string | undefined {
  if (
    config?.shellRevealInFileManager !== true ||
    !config.availableEditors.includes("file-manager")
  ) {
    return undefined;
  }
  // WSL can reveal in Windows Explorer despite reporting Linux; use server wording.
  return config.shellRevealInFileManagerKind === undefined
    ? revealInFileExplorerLabelForOs(config.environment.platform.os, resolve)
    : revealInFileExplorerLabelForKind(config.shellRevealInFileManagerKind, resolve);
}
