type JsonObject = Record<string, any>;

const DIRECTIONS: Record<string, number> = { south: 0, west: 90, north: 180, east: 270 };
const WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "bamboo", "crimson", "warped", "pale_oak"];
const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];

function cuboid(from: number[], to: number[]) {
  const face = { texture: "#texture" };
  return { from, to, faces: { down: face, up: face, north: face, south: face, west: face, east: face } };
}

function model(texture: string, elements: JsonObject[]) {
  return { textures: { particle: texture, texture }, elements };
}

function facingVariants(modelId: string) {
  return Object.fromEntries(Object.entries(DIRECTIONS).map(([facing, y]) => [`facing=${facing}`, { model: modelId, y }]));
}

function rotationVariants(modelId: string) {
  return Object.fromEntries(Array.from({ length: 16 }, (_, rotation) => [`rotation=${rotation}`, { model: modelId, y: rotation * 22.5 }]));
}

export interface SpecialBlockResources {
  definitions: Record<string, JsonObject>;
  models: Record<string, JsonObject>;
}

/** Approximate JSON models for blocks normally rendered by Minecraft block-entity renderers. */
export function createSpecialBlockResources(): SpecialBlockResources {
  const definitions: Record<string, JsonObject> = {};
  const models: Record<string, JsonObject> = {};

  const chestModel = "litematic_viewer:block/chest";
  models[chestModel] = model("minecraft:block/oak_planks", [
    cuboid([1, 1, 1], [15, 14, 15]), cuboid([1, 14, 1], [15, 15, 15]), cuboid([7, 7, 0], [9, 11, 1])
  ]);
  const enderChestModel = "litematic_viewer:block/ender_chest";
  models[enderChestModel] = model("minecraft:block/obsidian", [
    cuboid([1, 1, 1], [15, 14, 15]), cuboid([1, 14, 1], [15, 15, 15]), cuboid([7, 7, 0], [9, 11, 1])
  ]);
  definitions["minecraft:chest"] = { variants: facingVariants(chestModel) };
  definitions["minecraft:trapped_chest"] = { variants: facingVariants(chestModel) };
  definitions["minecraft:ender_chest"] = { variants: facingVariants(enderChestModel) };

  for (const wood of WOODS) {
    const texture = `minecraft:block/${wood}_planks`;
    const signModel = `litematic_viewer:block/${wood}_sign`;
    const wallSignModel = `litematic_viewer:block/${wood}_wall_sign`;
    const hangingModel = `litematic_viewer:block/${wood}_hanging_sign`;
    const wallHangingModel = `litematic_viewer:block/${wood}_wall_hanging_sign`;
    models[signModel] = model(texture, [cuboid([1, 8, 7], [15, 16, 9]), cuboid([7, 0, 7], [9, 8, 9])]);
    models[wallSignModel] = model(texture, [cuboid([1, 4, 14], [15, 12, 16])]);
    models[hangingModel] = model(texture, [cuboid([2, 3, 7], [14, 13, 9]), cuboid([3, 13, 7], [4, 16, 9]), cuboid([12, 13, 7], [13, 16, 9])]);
    models[wallHangingModel] = model(texture, [cuboid([2, 3, 14], [14, 13, 16]), cuboid([3, 13, 14], [4, 16, 16]), cuboid([12, 13, 14], [13, 16, 16])]);
    definitions[`minecraft:${wood}_sign`] = { variants: rotationVariants(signModel) };
    definitions[`minecraft:${wood}_wall_sign`] = { variants: facingVariants(wallSignModel) };
    definitions[`minecraft:${wood}_hanging_sign`] = { variants: rotationVariants(hangingModel) };
    definitions[`minecraft:${wood}_wall_hanging_sign`] = { variants: facingVariants(wallHangingModel) };
  }

  for (const color of COLORS) {
    const textile = `minecraft:block/${color}_wool`;
    const bannerModel = `litematic_viewer:block/${color}_banner`;
    const wallBannerModel = `litematic_viewer:block/${color}_wall_banner`;
    const bedModel = `litematic_viewer:block/${color}_bed`;
    const shulkerModel = `litematic_viewer:block/${color}_shulker_box`;
    models[bannerModel] = model(textile, [cuboid([2, 7, 7], [14, 16, 8]), cuboid([7, 0, 7], [9, 16, 9])]);
    models[wallBannerModel] = model(textile, [cuboid([2, 4, 15], [14, 16, 16])]);
    models[bedModel] = model(textile, [cuboid([0, 3, 0], [16, 9, 16]), cuboid([1, 0, 1], [3, 3, 3]), cuboid([13, 0, 13], [15, 3, 15])]);
    models[shulkerModel] = model(textile, [cuboid([1, 0, 1], [15, 16, 15])]);
    definitions[`minecraft:${color}_banner`] = { variants: rotationVariants(bannerModel) };
    definitions[`minecraft:${color}_wall_banner`] = { variants: facingVariants(wallBannerModel) };
    definitions[`minecraft:${color}_bed`] = { variants: facingVariants(bedModel) };
    definitions[`minecraft:${color}_shulker_box`] = { variants: facingVariants(shulkerModel) };
  }

  const headModel = "litematic_viewer:block/head";
  const wallHeadModel = "litematic_viewer:block/wall_head";
  models[headModel] = model("minecraft:block/bone_block_side", [cuboid([4, 0, 4], [12, 8, 12])]);
  models[wallHeadModel] = model("minecraft:block/bone_block_side", [cuboid([4, 4, 8], [12, 12, 16])]);
  for (const head of ["skeleton_skull", "wither_skeleton_skull", "zombie_head", "player_head", "creeper_head", "dragon_head", "piglin_head"]) {
    definitions[`minecraft:${head}`] = { variants: rotationVariants(headModel) };
    definitions[`minecraft:${head.replace(/(skull|head)$/, "wall_$1")}`] = { variants: facingVariants(wallHeadModel) };
  }

  const simpleSpecials: Array<[string, string, JsonObject[]]> = [
    ["decorated_pot", "minecraft:block/terracotta", [cuboid([3, 0, 3], [13, 16, 13])]],
    ["conduit", "minecraft:block/prismarine", [cuboid([5, 5, 5], [11, 11, 11])]],
    ["end_portal", "minecraft:block/obsidian", [cuboid([0, 6, 0], [16, 10, 16])]],
    ["end_gateway", "minecraft:block/obsidian", [cuboid([2, 2, 2], [14, 14, 14])]],
    ["moving_piston", "minecraft:block/piston_side", [cuboid([0, 0, 0], [16, 16, 16])]],
    ["shulker_box", "minecraft:block/purpur_block", [cuboid([1, 0, 1], [15, 16, 15])]]
  ];
  for (const [id, texture, elements] of simpleSpecials) {
    const modelId = `litematic_viewer:block/${id}`;
    models[modelId] = model(texture, elements);
    definitions[`minecraft:${id}`] = { variants: { "": { model: modelId } } };
  }

  return { definitions, models };
}
