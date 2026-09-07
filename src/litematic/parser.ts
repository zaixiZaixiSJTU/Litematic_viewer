import { gunzipSync } from "fflate";
import { compound, parseNbt, type NbtLong, type NbtValue } from "./nbt";

export interface PreviewBlock {
  x: number;
  y: number;
  z: number;
  name: string;
  color: number;
  properties: Record<string, string>;
}
export interface LitematicPreview {
  name: string;
  author: string;
  description: string;
  minecraftDataVersion?: number;
  regionCount: number;
  totalVolume: number;
  declaredBlocks: number;
  visibleBlocks: number;
  skippedBlocks: number;
  blocks: PreviewBlock[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

const MAX_RENDERED_BLOCKS = 250_000;

function numberAt(value: NbtValue | undefined, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}
function stringAt(value: NbtValue | undefined): string { return typeof value === "string" ? value : ""; }
function vector(value: NbtValue | undefined, label: string): [number, number, number] {
  const v = compound(value, label); return [numberAt(v.x), numberAt(v.y), numberAt(v.z)];
}
interface PaletteEntry { name: string; properties: Record<string, string>; }

/** Litematica stores block-state index 0 at the region bounding box's minimum corner. */
export function regionMinCorner(position: [number, number, number], size: [number, number, number]): [number, number, number] {
  return [
    position[0] + (size[0] < 0 ? size[0] + 1 : 0),
    position[1] + (size[1] < 0 ? size[1] + 1 : 0),
    position[2] + (size[2] < 0 ? size[2] + 1 : 0)
  ];
}

function paletteEntry(value: NbtValue): PaletteEntry {
  const item = compound(value, "BlockStatePalette 项");
  const rawProperties = item.Properties ? compound(item.Properties, "BlockStatePalette.Properties") : {};
  const properties: Record<string, string> = {};
  for (const [key, raw] of Object.entries(rawProperties)) {
    if (typeof raw === "string" || typeof raw === "number") properties[key] = String(raw);
  }
  return { name: stringAt(item.Name) || "minecraft:air", properties };
}
function isInvisible(name: string) {
  return /(^|:)(air|cave_air|void_air|structure_void|barrier|light)$/.test(name);
}

const COLOR_RULES: Array<[RegExp, number]> = [
  [/water|bubble_column/, 0x3f76e4], [/lava/, 0xff6b19], [/grass|moss|leaves|vine|azalea/, 0x65a844],
  [/sand|sandstone|end_stone|birch/, 0xd9ca8b], [/stone|cobble|andesite|gravel|bedrock/, 0x858585],
  [/deepslate|blackstone|basalt|coal/, 0x3f4247], [/dirt|mud|soul_soil/, 0x79553a],
  [/oak|spruce|jungle|acacia|mangrove|cherry|wood|log|planks/, 0x9b7044],
  [/glass|ice/, 0x9ed9e5], [/snow|quartz|calcite|white_/, 0xe8ecec], [/redstone|red_|netherrack|nether_wart/, 0xb33b32],
  [/orange_|copper|terracotta/, 0xb86f45], [/yellow_|gold|hay|sponge/, 0xe4c63c], [/lime_|slime/, 0x78c64b],
  [/green_|emerald/, 0x3b9b57], [/cyan_|warped|prismarine/, 0x3d9a94], [/blue_|lapis/, 0x4264b9],
  [/purple_|amethyst|purpur/, 0x8d55b5], [/magenta_|pink_|cherry/, 0xc96f9f], [/brown_/, 0x754b32],
  [/gray_|iron|anvil|hopper/, 0x8c9194], [/black_|obsidian/, 0x25252b]
];
function blockColor(name: string): number {
  for (const [pattern, color] of COLOR_RULES) if (pattern.test(name)) return color;
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619);
  const r = 72 + (hash & 0x7f), g = 72 + ((hash >>> 8) & 0x7f), b = 72 + ((hash >>> 16) & 0x7f);
  return (r << 16) | (g << 8) | b;
}
function isNbtLong(value: unknown): value is NbtLong {
  return !!value && typeof value === "object" && (value as NbtLong).__nbtLong === true;
}
function paletteIndex(longs: NbtLong[], index: number, bits: number): number {
  const bitIndex = index * bits;
  const laneIndex = Math.floor(bitIndex / 32), shift = bitIndex % 32;
  const lane = (at: number) => {
    const value = longs[Math.floor(at / 2)];
    if (!value) return 0;
    return at % 2 === 0 ? value.lo : value.hi;
  };
  let value = lane(laneIndex) >>> shift;
  const available = 32 - shift;
  if (available < bits) {
    const overflowBits = bits - available;
    value += (lane(laneIndex + 1) % Math.pow(2, overflowBits)) * Math.pow(2, available);
  }
  return value % Math.pow(2, bits);
}

export function parseLitematic(input: Uint8Array, fileName = "未命名投影"): LitematicPreview {
  const bytes = input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input) : input;
  const root = parseNbt(bytes);
  const regions = compound(root.Regions, "Regions");
  const metadata = root.Metadata ? compound(root.Metadata, "Metadata") : {};
  const regionEntries = Object.entries(regions);
  if (!regionEntries.length) throw new Error("该文件不包含任何投影区域");

  let totalVolume = 0, declaredBlocks = numberAt(metadata.TotalBlocks), candidateBlocks = 0;
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const prepared: Array<{ origin: [number, number, number]; size: [number, number, number]; palette: PaletteEntry[]; states: NbtLong[] }> = [];
  for (const [regionName, raw] of regionEntries) {
    const region = compound(raw, `区域 ${regionName}`), size = vector(region.Size, `${regionName}.Size`);
    const position = vector(region.Position, `${regionName}.Position`), paletteRaw = region.BlockStatePalette;
    if (!Array.isArray(paletteRaw)) throw new Error(`区域 ${regionName} 缺少 BlockStatePalette`);
    const palette = paletteRaw.map(paletteEntry), states = region.BlockStates;
    if (!Array.isArray(states) || states.some((v) => !isNbtLong(v))) throw new Error(`区域 ${regionName} 缺少 BlockStates`);
    const origin = regionMinCorner(position, size);
    const dimensions: [number, number, number] = [Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2])];
    const volume = dimensions[0] * dimensions[1] * dimensions[2]; totalVolume += volume;
    const end: [number, number, number] = [
      origin[0] + dimensions[0] - 1,
      origin[1] + dimensions[1] - 1,
      origin[2] + dimensions[2] - 1
    ];
    min = [Math.min(min[0], origin[0]), Math.min(min[1], origin[1]), Math.min(min[2], origin[2])];
    max = [Math.max(max[0], end[0]), Math.max(max[1], end[1]), Math.max(max[2], end[2])];
    candidateBlocks += volume; prepared.push({ origin, size: dimensions, palette, states: states as NbtLong[] });
  }

  const stride = Math.max(1, Math.ceil(candidateBlocks / MAX_RENDERED_BLOCKS));
  const blocks: PreviewBlock[] = [];
  let visibleBlocks = 0, sampledVisible = 0;
  for (const region of prepared) {
    const sx = Math.abs(region.size[0]), sy = Math.abs(region.size[1]), sz = Math.abs(region.size[2]);
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, region.palette.length))));
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const state = region.palette[paletteIndex(region.states, x + z * sx + y * sx * sz, bits)]
        || { name: "minecraft:air", properties: {} };
      if (isInvisible(state.name)) continue;
      visibleBlocks++;
      if ((visibleBlocks - 1) % stride !== 0) continue;
      const wx = region.origin[0] + x;
      const wy = region.origin[1] + y;
      const wz = region.origin[2] + z;
      blocks.push({ x: wx, y: wy, z: wz, name: state.name, color: blockColor(state.name), properties: state.properties }); sampledVisible++;
    }
  }
  if (!blocks.length) { min = [0, 0, 0]; max = [0, 0, 0]; }
  return {
    name: stringAt(metadata.Name) || fileName.replace(/\.litematic$/i, ""),
    author: stringAt(metadata.Author), description: stringAt(metadata.Description),
    minecraftDataVersion: numberAt(root.MinecraftDataVersion) || undefined,
    regionCount: regionEntries.length, totalVolume, declaredBlocks: declaredBlocks || visibleBlocks,
    visibleBlocks, skippedBlocks: Math.max(0, visibleBlocks - sampledVisible), blocks, bounds: { min, max }
  };
}
