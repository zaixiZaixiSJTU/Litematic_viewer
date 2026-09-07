import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { regionMinCorner } from "../src/litematic/parser";
import { modArchiveFileName, modelNamespaces, selectRelevantMods } from "../src/viewer/mod-resources";
import { enabledResourcePackNames, selectEnabledResourcePacks } from "../src/viewer/instance-resources";
import { assetUrlToFilePath, detectRenderEnvironment, selectBakedExporter } from "../src/viewer/baked-export";
import { ClientResources } from "../src/viewer/resource-pack";

test("positive region sizes keep Position as the minimum corner", () => {
  assert.deepEqual(regionMinCorner([10, 20, 30], [3, 4, 5]), [10, 20, 30]);
});

test("negative Y size starts block-state data at the lower corner", () => {
  assert.deepEqual(regionMinCorner([10, 20, 30], [3, -4, 5]), [10, 17, 30]);
});

test("mixed negative axes use the bounding-box minimum corner", () => {
  assert.deepEqual(regionMinCorner([10, 20, 30], [-3, -4, -5]), [8, 17, 26]);
});

test("mod resource selection only includes enabled matching archives", () => {
  const model = { blockNames: ["minecraft:stone", "create:shaft", "ae2:controller"], blocks: [
    { name: "minecraft:stone" },
    { name: "create:shaft" },
    { name: "ae2:controller" }
  ] } as Parameters<typeof modelNamespaces>[0];
  const namespaces = modelNamespaces(model);
  assert.deepEqual(Array.from(namespaces).sort(), ["ae2", "create", "minecraft"]);

  const mods = [
    { enabled: true, modId: "create", name: "Create", fileName: "create-6.0", filePath: "C:\\instances\\pack\\mods\\create-6.0.jar" },
    { enabled: true, modId: "ae2", name: "Applied Energistics 2", fileName: "appliedenergistics2", filePath: "/instances/pack/mods/appliedenergistics2.jar" },
    { enabled: false, modId: "create", name: "Create old", fileName: "create-old", filePath: "C:\\instances\\pack\\mods\\create-old.jar.disabled" },
    { enabled: true, modId: "jei", name: "JEI", fileName: "jei.jar", filePath: "" }
  ];
  assert.deepEqual(selectRelevantMods(mods, new Set(["create", "ae2"])).map((mod) => mod.modId), ["create", "ae2"]);
  assert.equal(modArchiveFileName(mods[0]), "create-6.0.jar");
  assert.equal(modArchiveFileName(mods[1]), "appliedenergistics2.jar");
  assert.equal(modArchiveFileName(mods[3]), "jei.jar");
});

test("enabled zip resource packs follow the order stored in options.txt", () => {
  const options = 'resourcePacks:["vanilla","mod_resources","file/Base.zip","file/Override.zip"]\n';
  const packs = [
    { name: "Override", filePath: "C:\\instance\\resourcepacks\\Override.zip" },
    { name: "Base", filePath: "/instance/resourcepacks/Base.zip" },
    { name: "Folder pack", filePath: "C:\\instance\\resourcepacks\\Folder pack" }
  ];
  assert.deepEqual(enabledResourcePackNames(options), ["Base.zip", "Override.zip"]);
  assert.deepEqual(selectEnabledResourcePacks(packs, options).map((pack) => pack.name), ["Base", "Override"]);
});

test("render environment is detected from the SJMCL instance summary", () => {
  assert.deepEqual(detectRenderEnvironment({
    id: "instance", version: "1.20.1-forge-47.1.106", majorVersion: "1.20.1",
    modLoader: { loaderType: "NeoForge", version: "47.1.106" }
  }), { minecraftVersion: "1.20.1", loader: "neoforge", loaderVersion: "47.1.106" });
  assert.equal(selectBakedExporter(detectRenderEnvironment({
    majorVersion: "1.20.1", modLoader: { loaderType: "Forge", version: "47.2.0" }
  }))?.fileName, "litematic-viewer-exporter-forge-1.20.1-1.0.0.jar");
  assert.equal(selectBakedExporter(detectRenderEnvironment({
    majorVersion: "1.21.1", modLoader: { loaderType: "Fabric", version: "0.16.0" }
  })), null);
});

test("extension asset URLs resolve to copyable local paths", () => {
  assert.equal(
    assetUrlToFilePath("http://asset.localhost/C%3A/Users/Test/AppData/exporter.jar"),
    "C:\\Users\\Test\\AppData\\exporter.jar"
  );
  assert.equal(assetUrlToFilePath("asset://localhost/tmp/exporter.jar"), "/tmp/exporter.jar");
});

test("resource archives merge assets from selected mod namespaces", async () => {
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => ({
        fillRect: () => undefined,
        drawImage: () => undefined,
        getImageData: () => ({ width: 16, height: 16 })
      })
    })
  };
  (globalThis as any).createImageBitmap = async () => ({});
  const vanilla = zipSync({
    "assets/minecraft/models/block/cube_all.json": strToU8(JSON.stringify({}))
  });
  const archive = zipSync({
    "assets/create/blockstates/test.json": strToU8(JSON.stringify({ variants: { "": { model: "create:block/test" } } })),
    "assets/create/models/block/test.json": strToU8(JSON.stringify({ parent: "minecraft:block/cube_all", textures: { all: "create:block/test" } })),
    "assets/create/textures/block/test.png": new Uint8Array([1, 2, 3]),
    "assets/ignored/blockstates/test.json": strToU8(JSON.stringify({ variants: {} }))
  });
  const resources = new ClientResources();
  resources.loadArchive(vanilla, new Set(["minecraft"]));
  const result = resources.loadArchive(archive, new Set(["create"]));
  assert.deepEqual(result, { definitions: 1, models: 1, textures: 1, namespaces: ["create"] });
  assert.equal(resources.hasBlockDefinition("create:test"), true);
  assert.equal(resources.hasBlockDefinition("ignored:test"), false);
  assert.deepEqual(resources.ensureFallbackBlocks(["unknown:block"]), ["unknown:block"]);
  assert.equal(resources.hasBlockDefinition("unknown:block"), true);
  await resources.finalize();
  assert.equal(resources.getPixelSize() > 0, true);
});

test("runtime-generated blocks use an inferred same-name texture", () => {
  const archive = zipSync({
    "assets/example/textures/block/machine.png": new Uint8Array([1, 2, 3])
  });
  const resources = new ClientResources();
  resources.loadArchive(archive, new Set(["example"]), true);
  const result = resources.ensureRenderableBlocks([
    { name: "example:machine", x: 0, y: 0, z: 0, properties: {} }
  ]);
  assert.deepEqual(result, { approximated: ["example:machine"], placeholders: [] });
  assert.equal(resources.hasBlockDefinition("example:machine"), true);
});

test("resources inside Fabric and NeoForge nested jars are merged", () => {
  const nested = zipSync({
    "assets/embedded/blockstates/machine.json": strToU8(JSON.stringify({ variants: { "": { model: "embedded:block/machine" } } })),
    "assets/embedded/models/block/machine.json": strToU8(JSON.stringify({ elements: [] })),
    "assets/embedded/textures/block/machine.png": new Uint8Array([1, 2, 3])
  });
  const outer = zipSync({ "META-INF/jars/embedded.jar": nested });
  const resources = new ClientResources();
  const result = resources.loadArchive(outer, new Set(["embedded"]), true);
  assert.deepEqual(result, { definitions: 1, models: 1, textures: 1, namespaces: ["embedded"] });
  assert.equal(resources.hasBlockDefinition("embedded:machine"), true);
});

test("game-baked quads override missing static models", () => {
  const baked = zipSync({
    "manifest.json": strToU8(JSON.stringify({ formatVersion: 1, minecraftVersion: "1.20.1", loader: "neoforge" })),
    "models.json": strToU8(JSON.stringify({ formatVersion: 1, states: [{
      name: "example:dynamic", properties: { facing: "north" }, quads: [{
        texture: "example:block/dynamic", cullface: "north",
        vertices: [[0, 0, 0, 0, 1], [0, 1, 0, 0, 0], [1, 1, 0, 1, 0], [1, 0, 0, 1, 1]]
      }]
    }] })),
    "assets/example/textures/block/dynamic.png": new Uint8Array([1, 2, 3])
  });
  const resources = new ClientResources();
  assert.deepEqual(resources.loadBakedArchive(baked, { minecraftVersion: "1.20.1", loader: "neoforge" }), { definitions: 1, textures: 1 });
  assert.deepEqual(resources.ensureRenderableBlocks([
    { name: "example:dynamic", properties: { facing: "north" } }
  ]), { approximated: [], placeholders: [] });
});

test("blockstates with unavailable custom models receive a safe placeholder", () => {
  const archive = zipSync({
    "assets/example/blockstates/dynamic.json": strToU8(JSON.stringify({
      variants: { "": { model: "example:block/generated_at_runtime" } }
    }))
  });
  const resources = new ClientResources();
  resources.loadArchive(archive, new Set(["example"]), true);
  const result = resources.ensureRenderableBlocks([
    { name: "example:dynamic", x: 0, y: 0, z: 0, properties: {} }
  ]);
  assert.deepEqual(result, { approximated: [], placeholders: ["example:dynamic"] });
});
