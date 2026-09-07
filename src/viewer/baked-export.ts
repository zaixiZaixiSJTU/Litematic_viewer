import type { InstanceSummary, LocalModInfo } from "../types/host";

export interface InstanceRenderEnvironment {
  minecraftVersion: string;
  loader: "fabric" | "forge" | "neoforge" | "quilt" | "unknown";
  loaderVersion: string;
}

export interface BakedExporter {
  assetPath: string;
  fileName: string;
}

function normalizeLoader(value: unknown): InstanceRenderEnvironment["loader"] {
  const loader = String(value ?? "").toLowerCase();
  if (loader.includes("neoforge")) return "neoforge";
  if (loader.includes("forge")) return "forge";
  if (loader.includes("fabric")) return "fabric";
  if (loader.includes("quilt")) return "quilt";
  return "unknown";
}

export function detectRenderEnvironment(instance: InstanceSummary, mods: LocalModInfo[] = []): InstanceRenderEnvironment {
  let loader = normalizeLoader(instance.modLoader?.loaderType);
  if (loader === "unknown") loader = normalizeLoader(mods.find((mod) => mod.loaderType)?.loaderType);
  return {
    minecraftVersion: instance.majorVersion || instance.version || instance.versionPath?.split(/[\\/]/).pop() || "unknown",
    loader,
    loaderVersion: instance.modLoader?.version || ""
  };
}

export const BAKED_EXPORT_PATH = "litematic-viewer/baked-models.zip";

const FORGE_1_20_1_EXPORTER: BakedExporter = {
  assetPath: "assets/exporters/litematic-viewer-exporter-forge-1.20.1-1.0.0.jar",
  fileName: "litematic-viewer-exporter-forge-1.20.1-1.0.0.jar"
};

export function selectBakedExporter(environment: InstanceRenderEnvironment): BakedExporter | null {
  if (environment.minecraftVersion !== "1.20.1") return null;
  if (environment.loader !== "forge" && environment.loader !== "neoforge") return null;
  return FORGE_1_20_1_EXPORTER;
}

export function assetUrlToFilePath(assetUrl: string) {
  const url = new URL(assetUrl);
  let path = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  return /^[A-Za-z]:\//.test(path) ? path.replace(/\//g, "\\") : path;
}
