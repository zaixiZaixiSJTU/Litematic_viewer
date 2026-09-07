import type { LitematicPreview } from "../litematic/parser";
import type { LocalModInfo } from "../types/host";
import { archiveBaseName } from "./instance-resources";

const VANILLA_NAMESPACE = "minecraft";

function normalizedId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function modArchiveFileName(mod: LocalModInfo) {
  return archiveBaseName(mod.filePath) ?? archiveBaseName(mod.fileName);
}

export function modelNamespaces(model: LitematicPreview) {
  const namespaces = new Set<string>();
  for (const name of model.blockNames || model.blocks.map((block) => block.name)) {
    const separator = name.indexOf(":");
    namespaces.add(separator > 0 ? name.slice(0, separator).toLowerCase() : VANILLA_NAMESPACE);
  }
  return namespaces;
}

export function modNamespaces(model: LitematicPreview) {
  const namespaces = modelNamespaces(model);
  namespaces.delete(VANILLA_NAMESPACE);
  return namespaces;
}

export function selectRelevantMods(mods: LocalModInfo[], namespaces: ReadonlySet<string>) {
  const targets = new Set(Array.from(namespaces, normalizedId));
  return mods.filter((mod) => {
    if (!mod.enabled || !modArchiveFileName(mod)) return false;
    const aliases = [mod.modId, mod.name, mod.fileName].map(normalizedId);
    return aliases.some((alias) => Array.from(targets).some((target) => alias === target || alias.startsWith(target)));
  });
}
