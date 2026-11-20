/**
 * The Cua Driver release T3 bundles and downloads. The catalog's SDK may trail it; it checks only
 * contract and protocol versions. To bump, copy each size and SHA-256 from the release assets.
 */
export const CUA_DRIVER_VERSION = "0.54.0";

const ARCHIVES = {
  "darwin-universal": {
    archiveName: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
    bytes: 43_674_626,
    sha256: "c0ddcf71381ec4b745703694c2cd19812d2938b8a095cbccac994d8d2dc4893d",
  },
  "linux-x64": {
    archiveName: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-x86_64-binary.tar.gz`,
    bytes: 30_223_995,
    sha256: "53b38ee3a5aeed39bdcd3acee0bea98a0eed3315e9df2d8af73345680c49868e",
  },
  "linux-arm64": {
    archiveName: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-arm64-binary.tar.gz`,
    bytes: 28_119_796,
    sha256: "5f9699f4933944dd735083bbc86d59a98c6574dbb220a85640aa2484590a11bf",
  },
  "win32-x64": {
    archiveName: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-x86_64-binary.zip`,
    bytes: 32_527_087,
    sha256: "f9a651bc085ba8a34bfd7f192ee463517e503cfc883d1cb65899017b7b7fe80c",
  },
  "win32-arm64": {
    archiveName: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-arm64-binary.zip`,
    bytes: 30_326_446,
    sha256: "2ab9e712ed4cc54eb2c003fa14152101a7bf1bd14ee161e7740121a263766b64",
  },
} as const;

export interface CuaDriverRelease {
  readonly version: string;
  readonly archiveName: string;
  readonly format: "tar.gz" | "zip";
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Executable name at the archive root. */
  readonly executable: string;
  /** Files the archive must contain for the driver and its SDK to run. */
  readonly requiredFiles: ReadonlyArray<string>;
}

/** The archive for a host, or null where Cua publishes no driver. macOS uses one universal build. */
export function cuaDriverRelease(platform: NodeJS.Platform, arch: string): CuaDriverRelease | null {
  const key =
    platform === "darwin" && (arch === "arm64" || arch === "x64")
      ? "darwin-universal"
      : (platform === "linux" || platform === "win32") && (arch === "x64" || arch === "arm64")
        ? (`${platform}-${arch}` as const)
        : null;
  if (key === null) return null;
  const archive = ARCHIVES[key];
  const windows = platform === "win32";
  return {
    version: CUA_DRIVER_VERSION,
    ...archive,
    format: windows ? "zip" : "tar.gz",
    url: `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}/${archive.archiveName}`,
    executable: windows ? "cua-driver.exe" : "cua-driver",
    requiredFiles: windows
      ? ["cua-driver.exe", "cua-driver-uia.exe", "cua-cursor-theme.exe"]
      : platform === "linux"
        ? ["cua-driver", "cua-cursor-theme", "wayland-helper/winrects@cua/extension.js"]
        : ["cua-driver", "cua-cursor-theme"],
  };
}
