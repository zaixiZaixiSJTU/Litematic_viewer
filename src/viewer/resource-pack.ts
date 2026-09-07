import {
  BlockDefinition,
  BlockModel,
  Identifier,
  Mesh,
  Quad,
  TextureAtlas,
  Vector,
  type BlockFlags,
  type Resources
} from "deepslate";
import { unzipSync } from "fflate";

const decoder = new TextDecoder();
const TRANSPARENT_TEXTURE = /(water|lava|glass|ice|leaves|portal|slime|honey)/;
const TRANSLUCENT = /(water|bubble_column|glass|ice|portal|slime|honey)/;
const SELF_CULLING = /(water|glass|ice|leaves)/;
const FALLBACK_MODEL = "litematic_viewer:block/missing";
const FALLBACK_TEXTURE = "litematic_viewer:block/missing";
const FALLBACK_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const MAX_NESTED_ARCHIVE_DEPTH = 2;

type RawModel = {
  elements?: Array<{ from?: number[]; to?: number[]; rotation?: unknown; faces?: Record<string, unknown> }>;
  textures?: Record<string, string>;
};
type RawDefinition = { variants?: Record<string, { model?: string } | Array<{ model?: string }>>; multipart?: unknown[] };

export interface ArchiveLoadResult {
  definitions: number;
  models: number;
  textures: number;
  namespaces: string[];
}

export interface BlockFallbackResult {
  approximated: string[];
  placeholders: string[];
}

type BlockRenderState = { name: string; properties: Record<string, string> };
type BakedVertex = [number, number, number, number, number];
type BakedQuad = { vertices: [BakedVertex, BakedVertex, BakedVertex, BakedVertex]; texture: string; color?: [number, number, number]; cullface?: string };
type BakedState = { name: string; properties?: Record<string, string>; quads: BakedQuad[] };
type BakedExport = { formatVersion: number; states: BakedState[] };
type BakedManifest = { formatVersion: number; minecraftVersion: string; loader: string; loaderVersion?: string };

function stateKey(properties: Record<string, string>) {
  return Object.entries(properties).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join(",");
}

function loadersCompatible(actual: string, expected: string) {
  const normalize = (loader: string) => loader.toLowerCase();
  const left = normalize(actual), right = normalize(expected);
  if (left === right) return true;
  return (left === "forge" || left === "neoforge") && (right === "forge" || right === "neoforge");
}

class BakedBlockDefinition {
  readonly baked = true;
  constructor(private readonly states: Map<string, BakedQuad[]>) {}
  getModelVariants() { return []; }
  getMesh(_name: Identifier | undefined, properties: Record<string, string>, atlas: ClientResources, _models: ClientResources, cull: Record<string, boolean | undefined>) {
    const quads = this.states.get(stateKey(properties)) ?? this.states.get("") ?? [];
    const mesh = new Mesh();
    for (const data of quads) {
      if (data.cullface && cull[data.cullface]) continue;
      const [u0, v0, u1, v1] = atlas.getTextureUV(Identifier.parse(data.texture));
      const vertices = data.vertices.map(([x, y, z, u, v]) => ({ point: new Vector(x, y, z), uv: [u0 + (u1 - u0) * u, v0 + (v1 - v0) * v] as [number, number] }));
      const quad = Quad.fromPoints(vertices[0].point, vertices[1].point, vertices[2].point, vertices[3].point);
      quad.setTexture(vertices.flatMap((vertex) => vertex.uv));
      quad.setColor(data.color ?? [1, 1, 1]);
      mesh.quads.push(quad);
    }
    return mesh;
  }
}

function isBakedDefinition(definition: BlockDefinition | undefined): definition is BlockDefinition & { baked: true } {
  return !!definition && (definition as unknown as { baked?: boolean }).baked === true;
}

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
  private textures: Record<string, Blob> = {};

  getBlockDefinition(id: Identifier) { return this.definitions.get(id.toString()) ?? null; }
  getBlockModel(id: Identifier) { return this.models.get(id.toString()) ?? null; }
  getTextureAtlas() { return this.atlas.getTextureAtlas(); }
  getTextureUV(id: Identifier) { return this.atlas.getTextureUV(id); }
  getPixelSize() { return this.atlas.getPixelSize(); }
  getBlockProperties(_id: Identifier) { return null; }
  getDefaultBlockProperties(_id: Identifier) { return null; }
  hasBlockDefinition(id: string) { return this.definitions.has(id); }
  missingBlockDefinitions(blockNames: Iterable<string>) {
    return Array.from(new Set(blockNames)).filter((id) => !this.definitions.has(id));
  }
  unresolvedBlockNamespaces(blocks: Iterable<BlockRenderState>) {
    const unresolved = new Set<string>();
    for (const block of blocks) {
      const definition = this.definitions.get(block.name);
      if (isBakedDefinition(definition)) continue;
      try {
        const variants = definition?.getModelVariants(block.properties) ?? [];
        if (!variants.length) {
          unresolved.add(block.name.includes(":") ? block.name.split(":", 1)[0] : "minecraft");
        }
        for (const variant of variants) {
          const modelId = Identifier.parse(variant.model);
          if (!this.models.has(modelId.toString())) unresolved.add(modelId.namespace);
        }
      } catch { unresolved.add(block.name.includes(":") ? block.name.split(":", 1)[0] : "minecraft"); }
    }
    return unresolved;
  }
  getBlockFlags(id: Identifier): BlockFlags {
    const name = id.toString();
    return { opaque: this.opaqueBlocks.has(name), semi_transparent: TRANSLUCENT.test(name), self_culling: SELF_CULLING.test(name) };
  }

  loadArchive(input: Uint8Array, allowedNamespaces?: ReadonlySet<string>, includeExtendedAssets = false): ArchiveLoadResult {
    return this.loadArchiveAtDepth(input, allowedNamespaces, includeExtendedAssets, 0);
  }

  loadBakedArchive(input: Uint8Array, expected?: { minecraftVersion: string; loader: string }) {
    const entries = unzipSync(input, {
      filter: (file) => /(^|\/)(manifest|models)\.json$/i.test(file.name) || /^assets\/[^/]+\/textures\/.+\.png$/i.test(file.name.replace(/\\/g, "/"))
    });
    const manifestEntry = Object.entries(entries).find(([path]) => /(^|\/)manifest\.json$/i.test(path));
    const modelEntry = Object.entries(entries).find(([path]) => /(^|\/)models\.json$/i.test(path));
    if (!manifestEntry || !modelEntry) throw new Error("烘焙缓存缺少 manifest.json 或 models.json");
    const manifest = JSON.parse(decoder.decode(manifestEntry[1])) as BakedManifest;
    if (manifest.formatVersion !== 1) throw new Error("不支持的烘焙缓存格式");
    if (expected && (manifest.minecraftVersion !== expected.minecraftVersion || !loadersCompatible(manifest.loader, expected.loader))) {
      throw new Error(`烘焙缓存属于 ${manifest.minecraftVersion} ${manifest.loader}，与当前实例不匹配`);
    }
    const exported = JSON.parse(decoder.decode(modelEntry[1])) as BakedExport;
    if (exported.formatVersion !== 1 || !Array.isArray(exported.states)) throw new Error("不支持的烘焙缓存格式");

    let textures = 0;
    for (const [rawPath, bytes] of Object.entries(entries)) {
      const match = /^assets\/([^/]+)\/textures\/(.+)\.png$/i.exec(rawPath.replace(/\\/g, "/"));
      if (!match) continue;
      this.textures[`${match[1]}:${match[2]}`] = new Blob([bytes.slice().buffer], { type: "image/png" });
      textures++;
    }

    const definitions = new Map<string, Map<string, BakedQuad[]>>();
    for (const state of exported.states) {
      const states = definitions.get(state.name) ?? new Map<string, BakedQuad[]>();
      states.set(stateKey(state.properties ?? {}), state.quads);
      definitions.set(state.name, states);
    }
    for (const [id, states] of definitions) this.definitions.set(id, new BakedBlockDefinition(states) as unknown as BlockDefinition);
    return { definitions: definitions.size, textures };
  }

  private loadArchiveAtDepth(input: Uint8Array, allowedNamespaces: ReadonlySet<string> | undefined, includeExtendedAssets: boolean, depth: number): ArchiveLoadResult {
    const entries = unzipSync(input, {
      filter: (file) => {
        const path = file.name.replace(/\\/g, "/");
        const match = /^assets\/([^/]+)\/(blockstates\/.+\.json|models\/.+\.json|textures\/.+\.png)$/i.exec(path);
        if (!match) return depth < MAX_NESTED_ARCHIVE_DEPTH && /(^|\/)META-INF\/(jars|jarjar)\/.+\.jar$/i.test(path);
        if (allowedNamespaces && !allowedNamespaces.has(match[1].toLowerCase())) return false;
        return includeExtendedAssets || /^assets\/[^/]+\/(blockstates|models\/block|textures\/block)\//i.test(path);
      }
    });
    let definitions = 0, models = 0, textures = 0;
    const namespaces = new Set<string>();
    for (const [rawPath, bytes] of Object.entries(entries)) {
      const path = rawPath.replace(/\\/g, "/");
      if (/\.jar$/i.test(path)) {
        try {
          const nested = this.loadArchiveAtDepth(bytes, allowedNamespaces, includeExtendedAssets, depth + 1);
          definitions += nested.definitions; models += nested.models; textures += nested.textures;
          for (const namespace of nested.namespaces) namespaces.add(namespace);
        } catch { /* malformed optional nested archive */ }
        continue;
      }
      let match = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/i.exec(path);
      if (match) {
        try { this.definitions.set(`${match[1]}:${match[2]}`, BlockDefinition.fromJson(JSON.parse(decoder.decode(bytes)))); definitions++; namespaces.add(match[1].toLowerCase()); } catch { /* malformed resource */ }
        continue;
      }
      match = /^assets\/([^/]+)\/models\/(.+)\.json$/i.exec(path);
      if (match) {
        try { this.models.set(`${match[1]}:${match[2]}`, BlockModel.fromJson(JSON.parse(decoder.decode(bytes)))); models++; namespaces.add(match[1].toLowerCase()); } catch { /* malformed resource */ }
        continue;
      }
      match = /^assets\/([^/]+)\/textures\/(.+)\.png$/i.exec(path);
      if (match) { this.textures[`${match[1]}:${match[2]}`] = new Blob([bytes.slice().buffer], { type: "image/png" }); textures++; namespaces.add(match[1].toLowerCase()); }
    }
    return { definitions, models, textures, namespaces: Array.from(namespaces) };
  }

  ensureRenderableBlocks(blocks: Iterable<BlockRenderState>): BlockFallbackResult {
    if (!this.models.has(FALLBACK_MODEL)) {
      this.models.set(FALLBACK_MODEL, BlockModel.fromJson({
        parent: "minecraft:block/cube_all",
        textures: { all: FALLBACK_TEXTURE }
      }));
      const bytes = Uint8Array.from(atob(FALLBACK_PNG), (character) => character.charCodeAt(0));
      this.textures[FALLBACK_TEXTURE] = new Blob([bytes], { type: "image/png" });
    }

    for (const model of this.models.values()) {
      try { model.flatten(this); } catch { /* missing optional parent model */ }
    }

    const states = new Map<string, Array<Record<string, string>>>();
    for (const block of blocks) {
      const properties = states.get(block.name) ?? [];
      if (!properties.some((entry) => JSON.stringify(entry) === JSON.stringify(block.properties))) properties.push(block.properties);
      states.set(block.name, properties);
    }

    const approximated: string[] = [], placeholders: string[] = [];
    for (const [id, properties] of states) {
      const definition = this.definitions.get(id);
      if (isBakedDefinition(definition)) continue;
      let renderable = !!definition;
      if (definition) {
        try {
          renderable = properties.every((state) => {
            const variants = definition.getModelVariants(state);
            return variants.length > 0 && variants.every((variant) => {
              const model = this.models.get(Identifier.parse(variant.model).toString()) as unknown as RawModel | undefined;
              return !!model?.elements?.length;
            });
          });
        } catch { renderable = false; }
      }
      if (renderable) continue;

      const separator = id.indexOf(":"), namespace = separator > 0 ? id.slice(0, separator) : "minecraft";
      const path = separator > 0 ? id.slice(separator + 1) : id;
      const inferredModel = `${namespace}:block/${path}`;
      const rawModel = this.models.get(inferredModel) as unknown as RawModel | undefined;
      if (rawModel?.elements?.length) {
        this.definitions.set(id, BlockDefinition.fromJson({ variants: { "": { model: inferredModel } } }));
        approximated.push(id);
        continue;
      }

      const textureCandidates = [
        ...Object.values(rawModel?.textures ?? {}).filter((value) => !value.startsWith("#")),
        `${namespace}:block/${path}`,
        `${namespace}:block/${path}_side`,
        `${namespace}:block/${path}_top`,
        `${namespace}:block/${path.replace(/_(block|bricks?|planks?|wood)$/, "")}`
      ];
      const texture = textureCandidates.find((candidate) => this.textures[candidate])
        ?? Object.keys(this.textures).find((candidate) => candidate.startsWith(`${namespace}:block/${path}_`));
      if (texture) {
        const modelId = `litematic_viewer:block/inferred/${namespace}/${path}`;
        this.models.set(modelId, BlockModel.fromJson({ parent: "minecraft:block/cube_all", textures: { all: texture } }));
        this.definitions.set(id, BlockDefinition.fromJson({ variants: { "": { model: modelId } } }));
        approximated.push(id);
      } else {
        this.definitions.set(id, BlockDefinition.fromJson({ variants: { "": { model: FALLBACK_MODEL } } }));
        placeholders.push(id);
      }
    }
    return { approximated, placeholders };
  }

  ensureFallbackBlocks(blockNames: Iterable<string>) {
    const blocks = Array.from(new Set(blockNames), (name) => ({ name, properties: {} }));
    const result = this.ensureRenderableBlocks(blocks);
    return [...result.approximated, ...result.placeholders];
  }

  async finalize() {
    if (!this.definitions.size || !this.models.size || !Object.keys(this.textures).length) throw new Error("资源归档中没有完整的方块状态、模型和纹理资源");
    this.atlas = await TextureAtlas.fromBlobs(this.textures);
    for (const model of this.models.values()) {
      try { model.flatten(this); } catch { /* missing optional parent model */ }
    }
    // Deepslate's culling API is per block ID rather than per state. Be conservative:
    // only definitions whose every possible variant is a complete six-faced cube may
    // hide a neighbour face. Extra faces cost performance; missing faces break models.
    this.opaqueBlocks.clear();
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

  async loadJar(input: Uint8Array) {
    this.loadArchive(input);
    await this.finalize();
  }
}
