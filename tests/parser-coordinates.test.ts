import assert from "node:assert/strict";
import test from "node:test";
import { regionMinCorner } from "../src/litematic/parser";

test("positive region sizes keep Position as the minimum corner", () => {
  assert.deepEqual(regionMinCorner([10, 20, 30], [3, 4, 5]), [10, 20, 30]);
});

test("negative Y size starts block-state data at the lower corner", () => {
  assert.deepEqual(regionMinCorner([10, 20, 30], [3, -4, 5]), [10, 17, 30]);
});

test("mixed negative axes use the bounding-box minimum corner", () => {
  assert.deepEqual(regionMinCorner([10, 20, 30], [-3, -4, -5]), [8, 17, 26]);
});
