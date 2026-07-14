import {
  BlockDefinition,
  BlockModel,
  Identifier,
  TextureAtlas,
  type BlockFlags,
  type Resources
} from "deepslate";
import { unzipSync } from "fflate";

const decoder = new TextDecoder();
const TRANSPARENT_TEXTURE = /(water|lava|glass|ice|leaves|portal|slime|honey)/;
const TRANSLUCENT = /(water|bubble_column|glass|ice|portal|slime|honey)/;
const SELF_CULLING = /(water|glass|ice|leaves)/;

type RawModel = { elements?: Array<{ from?: number[]; to?: number[]; rotation?: unknown; faces?: Record<string, unknown> }> };
type RawDefinition = { variants?: Record<string, { model?: string } | Array<{ model?: string }>>; multipart?: unknown[] };

function isFullCubeModel(model: BlockModel | null) {
  const elements = (model as unknown as RawModel | null)?.elements;
  if (!elements || elements.length !== 1) return false;
  const element = elements[0], directions = ["up", "down", "north", "south", "east", "west"];
  return !element.rotation
    && element.from?.length === 3 && element.from.every((value) => value === 0)
    && element.to?.length === 3 && element.to.every((value) => value === 16)
    && directions.every((direction) => !!element.faces?.[direction]);
}

export class ClientResources implements Resources {
  private definitions = new Map<string, BlockDefinition>();
  private models = new Map<string, BlockModel>();
  private atlas = TextureAtlas.empty();
  private opaqueBlocks = new Set<string>();

  getBlockDefinition(id: Identifier) { return this.definitions.get(id.toString()) ?? null; }
  getBlockModel(id: Identifier) { return this.models.get(id.toString()) ?? null; }
  getTextureAtlas() { return this.atlas.getTextureAtlas(); }
  getTextureUV(id: Identifier) { return this.atlas.getTextureUV(id); }
  getPixelSize() { return this.atlas.getPixelSize(); }
  getBlockProperties(_id: Identifier) { return null; }
  getDefaultBlockProperties(_id: Identifier) { return null; }
  getBlockFlags(id: Identifier): BlockFlags {
    const name = id.toString();
    return { opaque: this.opaqueBlocks.has(name), semi_transparent: TRANSLUCENT.test(name), self_culling: SELF_CULLING.test(name) };
  }

  async loadJar(input: Uint8Array) {
    const entries = unzipSync(input, {
      filter: (file) => /^assets\/[^/]+\/(blockstates|models\/block|textures\/block)\/.*\.(json|png)$/i.test(file.name)
    });
    const textures: Record<string, Blob> = {};
    for (const [rawPath, bytes] of Object.entries(entries)) {
      const path = rawPath.replace(/\\/g, "/");
      let match = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/i.exec(path);
      if (match) {
        try { this.definitions.set(`${match[1]}:${match[2]}`, BlockDefinition.fromJson(JSON.parse(decoder.decode(bytes)))); } catch { /* malformed resource */ }
        continue;
      }
      match = /^assets\/([^/]+)\/models\/block\/(.+)\.json$/i.exec(path);
      if (match) {
        try { this.models.set(`${match[1]}:block/${match[2]}`, BlockModel.fromJson(JSON.parse(decoder.decode(bytes)))); } catch { /* malformed resource */ }
        continue;
      }
      match = /^assets\/([^/]+)\/textures\/block\/(.+)\.png$/i.exec(path);
      if (match) textures[`${match[1]}:block/${match[2]}`] = new Blob([bytes.slice().buffer], { type: "image/png" });
    }
    if (!this.definitions.size || !this.models.size || !Object.keys(textures).length) throw new Error("客户端 JAR 中没有完整的方块状态、模型和纹理资源");
    this.atlas = await TextureAtlas.fromBlobs(textures);
    for (const model of this.models.values()) {
      try { model.flatten(this); } catch { /* missing optional parent model */ }
    }
    // Deepslate's culling API is per block ID rather than per state. Be conservative:
    // only definitions whose every possible variant is a complete six-faced cube may
    // hide a neighbour face. Extra faces cost performance; missing faces break models.
    for (const [id, definition] of this.definitions) {
      if (TRANSPARENT_TEXTURE.test(id)) continue;
      const raw = definition as unknown as RawDefinition;
      if (!raw.variants || raw.multipart?.length) continue;
      const variants = Object.values(raw.variants).flatMap((entry) => Array.isArray(entry) ? entry : [entry]);
      if (variants.length && variants.every((variant) => {
        if (!variant.model) return false;
        return isFullCubeModel(this.models.get(Identifier.parse(variant.model).toString()) ?? null);
      })) this.opaqueBlocks.add(id);
    }
  }
}
