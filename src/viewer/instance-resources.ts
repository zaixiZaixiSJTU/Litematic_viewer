import type { ResourcePackInfo } from "../types/host";

export function archiveBaseName(path: string) {
  const name = path.split(/[\\/]/).pop() || "";
  return /\.(jar|zip)$/i.test(name) ? name : null;
}

export function enabledResourcePackNames(options: string) {
  const line = options.split(/\r?\n/).find((entry) => entry.startsWith("resourcePacks:"));
  if (!line) return [];
  try {
    const entries = JSON.parse(line.slice("resourcePacks:".length));
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) => {
      if (typeof entry !== "string" || !entry.startsWith("file/")) return [];
      const name = entry.slice("file/".length).split("/").pop() || "";
      return /\.zip$/i.test(name) ? [name] : [];
    });
  } catch { return []; }
}

export function selectEnabledResourcePacks(packs: ResourcePackInfo[], options: string) {
  const byFileName = new Map<string, ResourcePackInfo>();
  for (const pack of packs) {
    const fileName = archiveBaseName(pack.filePath);
    if (fileName?.toLowerCase().endsWith(".zip")) byFileName.set(fileName.toLowerCase(), pack);
  }
  return enabledResourcePackNames(options).flatMap((name) => {
    const pack = byFileName.get(name.toLowerCase());
    return pack ? [pack] : [];
  });
}
