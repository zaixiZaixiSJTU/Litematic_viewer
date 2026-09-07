package cn.sjtu.sjmcl.litematicviewer;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.stream.JsonWriter;
import com.mojang.blaze3d.platform.NativeImage;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.block.model.BakedQuad;
import net.minecraft.client.renderer.texture.TextureAtlasSprite;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.ModelEvent;
import net.minecraftforge.client.model.data.ModelData;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Mod(ExporterMod.MOD_ID)
public final class ExporterMod {
    public static final String MOD_ID = "litematic_viewer_exporter";
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    public ExporterMod() {
        MinecraftForge.EVENT_BUS.register(this);
    }

    @Mod.EventBusSubscriber(modid = MOD_ID, value = Dist.CLIENT, bus = Mod.EventBusSubscriber.Bus.MOD)
    public static final class ClientEvents {
        @SubscribeEvent
        public static void onModelsBaked(ModelEvent.BakingCompleted event) {
            Minecraft.getInstance().execute(ExporterMod::exportModels);
        }
    }

    private static void exportModels() {
        Minecraft minecraft = Minecraft.getInstance();
        Path output = minecraft.gameDirectory.toPath().resolve("litematic-viewer/baked-models.zip");
        Path temporaryOutput = output.resolveSibling(output.getFileName() + ".tmp");
        Map<ResourceLocation, TextureAtlasSprite> sprites = new HashMap<>();

        JsonObject manifest = new JsonObject();
        manifest.addProperty("formatVersion", 1);
        manifest.addProperty("minecraftVersion", "1.20.1");
        manifest.addProperty("loader", "neoforge");
        manifest.addProperty("loaderVersion", "47");
        try {
            Files.createDirectories(output.getParent());
            Files.deleteIfExists(temporaryOutput);
            try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(temporaryOutput))) {
                writeJson(zip, "manifest.json", manifest);
                writeModels(zip, minecraft, sprites);
                for (Map.Entry<ResourceLocation, TextureAtlasSprite> entry : sprites.entrySet()) {
                    writeTexture(zip, entry.getKey(), entry.getValue());
                }
            }
            try {
                Files.move(temporaryOutput, output, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (IOException exception) {
                Files.move(temporaryOutput, output, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception exception) {
            try { Files.deleteIfExists(temporaryOutput); } catch (IOException ignored) {}
            exception.printStackTrace();
        }
    }

    private static void writeModels(ZipOutputStream zip, Minecraft minecraft, Map<ResourceLocation, TextureAtlasSprite> sprites) throws IOException {
        zip.putNextEntry(new ZipEntry("models.json"));
        JsonWriter writer = new JsonWriter(new OutputStreamWriter(new NonClosingOutputStream(zip), StandardCharsets.UTF_8));
        writer.beginObject();
        writer.name("formatVersion").value(1);
        writer.name("states").beginArray();
        for (Block block : BuiltInRegistries.BLOCK) {
            ResourceLocation blockId = BuiltInRegistries.BLOCK.getKey(block);
            for (BlockState state : block.getStateDefinition().getPossibleStates()) {
                JsonObject exportedState = new JsonObject();
                exportedState.addProperty("name", blockId.toString());
                JsonObject properties = new JsonObject();
                for (Property<?> property : state.getProperties()) {
                    properties.addProperty(property.getName(), propertyValueName(state, property));
                }
                exportedState.add("properties", properties);
                JsonArray quads = new JsonArray();
                for (Direction direction : Direction.values()) {
                    appendQuads(minecraft, state, direction, RandomSource.create(42L), quads, sprites);
                }
                appendQuads(minecraft, state, null, RandomSource.create(42L), quads, sprites);
                exportedState.add("quads", quads);
                GSON.toJson(exportedState, writer);
            }
        }
        writer.endArray();
        writer.endObject();
        writer.flush();
        zip.closeEntry();
    }

    private static void appendQuads(Minecraft minecraft, BlockState state, Direction direction, RandomSource random, JsonArray output, Map<ResourceLocation, TextureAtlasSprite> sprites) {
        List<BakedQuad> quads = new ArrayList<>();
        for (RenderType renderType : minecraft.getBlockRenderer().getBlockModel(state).getRenderTypes(state, random, ModelData.EMPTY)) {
            quads.addAll(minecraft.getBlockRenderer().getBlockModel(state).getQuads(state, direction, random, ModelData.EMPTY, renderType));
        }
        if (quads.isEmpty()) quads.addAll(minecraft.getBlockRenderer().getBlockModel(state).getQuads(state, direction, random));
        for (BakedQuad quad : quads) {
            TextureAtlasSprite sprite = quad.getSprite();
            ResourceLocation texture = sprite.contents().name();
            sprites.put(texture, sprite);
            JsonObject exported = new JsonObject();
            exported.addProperty("texture", texture.toString());
            if (direction != null) exported.addProperty("cullface", direction.getName());
            if (quad.isTinted()) {
                int tint = minecraft.getBlockColors().getColor(state, null, null, quad.getTintIndex());
                JsonArray color = new JsonArray();
                color.add(((tint >> 16) & 255) / 255.0);
                color.add(((tint >> 8) & 255) / 255.0);
                color.add((tint & 255) / 255.0);
                exported.add("color", color);
            }
            JsonArray vertices = new JsonArray();
            int[] data = quad.getVertices();
            int stride = data.length / 4;
            for (int vertex = 0; vertex < 4; vertex++) {
                int offset = vertex * stride;
                JsonArray values = new JsonArray();
                values.add(Float.intBitsToFloat(data[offset]));
                values.add(Float.intBitsToFloat(data[offset + 1]));
                values.add(Float.intBitsToFloat(data[offset + 2]));
                float u = Float.intBitsToFloat(data[offset + 4]);
                float v = Float.intBitsToFloat(data[offset + 5]);
                values.add((u - sprite.getU0()) / (sprite.getU1() - sprite.getU0()));
                values.add((v - sprite.getV0()) / (sprite.getV1() - sprite.getV0()));
                vertices.add(values);
            }
            exported.add("vertices", vertices);
            output.add(exported);
        }
    }

    private static <T extends Comparable<T>> String propertyValueName(BlockState state, Property<T> property) {
        return property.getName(state.getValue(property));
    }

    private static void writeJson(ZipOutputStream zip, String name, JsonObject value) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        try (OutputStreamWriter writer = new OutputStreamWriter(new NonClosingOutputStream(zip), StandardCharsets.UTF_8)) {
            GSON.toJson(value, writer);
            writer.flush();
        }
        zip.closeEntry();
    }

    private static void writeTexture(ZipOutputStream zip, ResourceLocation id, TextureAtlasSprite sprite) throws IOException {
        zip.putNextEntry(new ZipEntry("assets/" + id.getNamespace() + "/textures/" + id.getPath() + ".png"));
        NativeImage image = sprite.contents().getOriginalImage();
        zip.write(image.asByteArray());
        zip.closeEntry();
    }

    private static final class NonClosingOutputStream extends java.io.FilterOutputStream {
        private NonClosingOutputStream(java.io.OutputStream output) { super(output); }
        @Override public void close() throws IOException { flush(); }
    }
}
