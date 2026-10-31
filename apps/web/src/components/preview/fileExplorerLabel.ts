import type {
  ExecutionEnvironmentPlatformOs,
  FileManagerRevealKind,
  ServerConfig,
} from "@t3tools/contracts";

export function revealInFileExplorerLabel(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return "Reveal in Finder";
  if (normalized.includes("win")) return "Reveal in File Explorer";
  return "Reveal in Files";
}

function revealInFileExplorerLabelForOs(os: ExecutionEnvironmentPlatformOs): string {
  if (os === "darwin") return "Reveal in Finder";
  if (os === "windows") return "Reveal in File Explorer";
  return "Reveal in Files";
}

function revealInFileExplorerLabelForKind(kind: FileManagerRevealKind): string {
  if (kind === "finder") return "Reveal in Finder";
  if (kind === "file-explorer") return "Reveal in File Explorer";
  return "Reveal in Files";
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
): string | undefined {
  if (
    config?.shellRevealInFileManager !== true ||
    !config.availableEditors.includes("file-manager")
  ) {
    return undefined;
  }
  // WSL can reveal in Windows Explorer despite reporting Linux; use server wording.
  return config.shellRevealInFileManagerKind === undefined
    ? revealInFileExplorerLabelForOs(config.environment.platform.os)
    : revealInFileExplorerLabelForKind(config.shellRevealInFileManagerKind);
}
