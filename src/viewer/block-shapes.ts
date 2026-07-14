import type { PreviewBlock } from "../litematic/parser";

export interface BlockPart {
  offset: [number, number, number];
  scale: [number, number, number];
  rotationY?: number;
}

const FULL: BlockPart[] = [{ offset: [0, 0, 0], scale: [0.98, 0.98, 0.98] }];
const horizontal = (facing = "north") => facing === "east" || facing === "west";
const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number): BlockPart => ({ offset: [x, y, z], scale: [sx, sy, sz] });

function connections(p: Record<string, string>) {
  const connected = (direction: string) => p[direction] !== undefined && p[direction] !== "false" && p[direction] !== "none";
  return { north: connected("north"), south: connected("south"), east: connected("east"), west: connected("west") };
}

/** Lightweight, independently implemented block-state geometry for preview mode. */
export function blockParts(block: PreviewBlock): BlockPart[] {
  const id = block.name.replace(/^minecraft:/, "");
  const p = block.properties;

  if (/_slab$/.test(id)) {
    if (p.type === "double") return FULL;
    return [box(0, p.type === "top" ? 0.245 : -0.245, 0, 0.98, 0.49, 0.98)];
  }
  if (/_stairs$/.test(id)) {
    const top = p.half === "top";
    const facing = p.facing || "north";
    const y1 = top ? 0.245 : -0.245, y2 = top ? -0.245 : 0.245;
    const second = horizontal(facing)
      ? box(facing === "east" ? 0.245 : -0.245, y2, 0, 0.49, 0.49, 0.98)
      : box(0, y2, facing === "south" ? 0.245 : -0.245, 0.98, 0.49, 0.49);
    return [box(0, y1, 0, 0.98, 0.49, 0.98), second];
  }
  if (/_fence$/.test(id) || id === "nether_brick_fence") {
    const c = connections(p), parts = [box(0, 0, 0, 0.25, 0.98, 0.25)];
    if (c.north) parts.push(box(0, 0, -0.31, 0.19, 0.75, 0.62));
    if (c.south) parts.push(box(0, 0, 0.31, 0.19, 0.75, 0.62));
    if (c.east) parts.push(box(0.31, 0, 0, 0.62, 0.75, 0.19));
    if (c.west) parts.push(box(-0.31, 0, 0, 0.62, 0.75, 0.19));
    return parts;
  }
  if (/_wall$/.test(id)) {
    const c = connections(p), parts: BlockPart[] = [];
    if (p.up !== "false") parts.push(box(0, 0, 0, 0.5, 0.98, 0.5));
    if (c.north) parts.push(box(0, 0, -0.3, 0.36, 0.8, 0.6));
    if (c.south) parts.push(box(0, 0, 0.3, 0.36, 0.8, 0.6));
    if (c.east) parts.push(box(0.3, 0, 0, 0.6, 0.8, 0.36));
    if (c.west) parts.push(box(-0.3, 0, 0, 0.6, 0.8, 0.36));
    return parts.length ? parts : FULL;
  }
  if (/_pane$/.test(id) || id === "iron_bars") {
    const c = connections(p), parts: BlockPart[] = [];
    if (c.north || c.south || (!c.east && !c.west)) parts.push(box(0, 0, 0, 0.12, 0.98, 0.98));
    if (c.east || c.west || (!c.north && !c.south)) parts.push(box(0, 0, 0, 0.98, 0.98, 0.12));
    return parts;
  }
  if (/_door$/.test(id)) {
    const facing = p.facing || "north";
    const open = p.open === "true";
    const rotatedFacing = open
      ? ({ north: "east", east: "south", south: "west", west: "north" } as Record<string, string>)[facing]
      : facing;
    return [horizontal(rotatedFacing) ? box(0, 0, 0, 0.18, 0.98, 0.98) : box(0, 0, 0, 0.98, 0.98, 0.18)];
  }
  if (/_trapdoor$/.test(id)) {
    if (p.open !== "true") return [box(0, p.half === "top" ? 0.4 : -0.4, 0, 0.98, 0.18, 0.98)];
    return [horizontal(p.facing) ? box(0, 0, 0, 0.18, 0.98, 0.98) : box(0, 0, 0, 0.98, 0.98, 0.18)];
  }
  if (/_carpet$/.test(id) || /pressure_plate$/.test(id)) return [box(0, -0.45, 0, 0.98, 0.08, 0.98)];
  if (id === "snow") {
    const height = Math.max(1, Number(p.layers) || 1) / 8;
    return [box(0, -0.5 + height / 2, 0, 0.98, height, 0.98)];
  }
  if (/(_path|farmland)$/.test(id)) return [box(0, -0.06, 0, 0.98, 0.86, 0.98)];
  if (/torch$/.test(id)) return [box(0, -0.08, 0, 0.12, 0.7, 0.12)];
  if (/(_sapling|_flower|tulip|orchid|dandelion|poppy|fern|grass|bush|roots|fungus|mushroom)$/.test(id)) {
    return [box(0, -0.05, 0, 0.08, 0.85, 0.82), box(0, -0.05, 0, 0.82, 0.85, 0.08)];
  }
  if (/(_button|lever)$/.test(id)) {
    const face = p.face || "wall";
    if (face === "floor" || face === "ceiling") return [box(0, face === "floor" ? -0.42 : 0.42, 0, 0.35, 0.14, 0.25)];
    return [horizontal(p.facing) ? box(0, 0, 0, 0.14, 0.35, 0.25) : box(0, 0, 0, 0.25, 0.35, 0.14)];
  }
  if (/(_chest|ender_chest)$/.test(id)) return [box(0, -0.04, 0, 0.88, 0.86, 0.88)];
  if (/(_bed)$/.test(id)) return [box(0, -0.28, 0, 0.98, 0.45, 0.98)];
  if (/chain$|end_rod$|lightning_rod$/.test(id)) {
    return p.axis === "x" ? [box(0, 0, 0, 0.98, 0.16, 0.16)] : p.axis === "z" ? [box(0, 0, 0, 0.16, 0.16, 0.98)] : [box(0, 0, 0, 0.16, 0.98, 0.16)];
  }
  return FULL;
}

export function blockOpacity(name: string) {
  const id = name.replace(/^minecraft:/, "");
  if (/water|bubble_column/.test(id)) return 0.48;
  if (/glass|ice|slime|honey/.test(id)) return 0.68;
  return 1;
}
