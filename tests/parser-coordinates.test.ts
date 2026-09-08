import assert from "node:assert/strict";
import test from "node:test";
import { regionMinCorner } from "../src/litematic/parser";
import { createSpecialBlockResources } from "../src/viewer/special-block-models";

test("positive region sizes keep Position as the minimum corner", () => {
  assert.deepEqual(regionMinCorner([10, 20, 30], [3, 4, 5]), [10, 20, 30]);
});

test("negative Y size starts block-state data at the lower corner", () => {
  assert.deepEqual(regionMinCorner([10, 20, 30], [3, -4, 5]), [10, 17, 30]);
});

test("mixed negative axes use the bounding-box minimum corner", () => {
  assert.deepEqual(regionMinCorner([10, 20, 30], [-3, -4, -5]), [8, 17, 26]);
});

test("block-entity rendered blocks receive preview models and state mappings", () => {
  const resources = createSpecialBlockResources();
  assert.ok(resources.definitions["minecraft:chest"]);
  assert.ok(resources.definitions["minecraft:oak_sign"]);
  assert.ok(resources.definitions["minecraft:oak_hanging_sign"]);
  assert.ok(resources.definitions["minecraft:red_bed"]);
  assert.ok(resources.definitions["minecraft:blue_shulker_box"]);
  assert.ok(resources.definitions["minecraft:player_wall_head"]);
  assert.ok(resources.definitions["minecraft:decorated_pot"]);
  assert.ok(resources.definitions["minecraft:end_portal"]);
  assert.equal(Object.keys(resources.definitions["minecraft:oak_sign"].variants).length, 16);
  assert.equal(Object.keys(resources.definitions["minecraft:chest"].variants).length, 4);
});
