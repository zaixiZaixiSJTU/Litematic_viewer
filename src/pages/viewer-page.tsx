import type { ExtensionFactoryApi, InstanceSummary, LocalModInfo, ResourcePackInfo, SchematicInfo } from "../types/host";
import { viewerWindowRoute } from "../navigation/viewer-route";
import { parseLitematic, type LitematicPreview } from "../litematic/parser";
import { mountScene } from "../viewer/scene";
import { ClientResources } from "../viewer/resource-pack";
import { mountResourceScene } from "../viewer/resource-scene";
import { modArchiveFileName, modNamespaces, selectRelevantMods } from "../viewer/mod-resources";
import { archiveBaseName, selectEnabledResourcePacks } from "../viewer/instance-resources";
import { assetUrlToFilePath, BAKED_EXPORT_PATH, detectRenderEnvironment, selectBakedExporter } from "../viewer/baked-export";

function formatCount(value: number) { return new Intl.NumberFormat("zh-CN").format(value); }

interface InvokeResponse<T> { status?: string; data?: T; raw_error?: string; details?: string; message?: string; }
interface ResourceSummary { loadedMods: number; scannedMods: number; loadedResourcePacks: number; bakedBlocks: number; customNamespaces: number; approximatedBlocks: number; placeholderBlocks: number; }

function unwrapInvoke<T>(response: T | InvokeResponse<T>): T {
  if (response && typeof response === "object" && !Array.isArray(response) && "status" in response) {
    const wrapped = response as InvokeResponse<T>;
    if (wrapped.status === "error") throw new Error(wrapped.raw_error || wrapped.details || wrapped.message || "启动器命令执行失败");
    return wrapped.data as T;
  }
  return response as T;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fileNameFromPath(file: SchematicInfo) {
  return file.filePath.split(/[\\/]/).pop() || `${file.name}.litematic`;
}

function schematicRelativePath(file: SchematicInfo) {
  return file.relativePath || fileNameFromPath(file);
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function clientJarPath(instance: { versionPath?: string; isVersionIsolated?: boolean }) {
  const folder = (instance.versionPath || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  if (!folder) throw new Error("启动器未提供当前实例的版本目录");
  return instance.isVersionIsolated ? `${folder}.jar` : `versions/${folder}/${folder}.jar`;
}

export function createViewerPage(api: ExtensionFactoryApi, standalone: boolean) {
  const React = api.React;
  const { Alert, AlertIcon, Badge, Box, Button, Divider, Grid, HStack, Input, Spinner, Stat, StatLabel, StatNumber, Text, VStack } = api.ChakraUI;

  return function ViewerPage() {
    const host = api.getHostContext();
    const hostData = api.useHostData();
    const requestedInstanceId = firstQueryValue(hostData.routeQuery.instanceId);
    const requestedSchematicPath = firstQueryValue(hostData.routeQuery.schematic);
    const selectedInstance = hostData.selectedInstance;
    const instance = (requestedInstanceId
      ? hostData.instanceList.find((candidate: InstanceSummary) => candidate.id === requestedInstanceId)
        || (selectedInstance?.id === requestedInstanceId ? selectedInstance : undefined)
      : selectedInstance) as InstanceSummary | undefined;
    const [model, setModel] = React.useState(null as LitematicPreview | null);
    const [error, setError] = React.useState("");
    const [renderError, setRenderError] = React.useState("");
    const [resourceError, setResourceError] = React.useState("");
    const [resources, setResources] = React.useState(null as ClientResources | null);
    const [resourceSummary, setResourceSummary] = React.useState(null as ResourceSummary | null);
    const [resourceProgress, setResourceProgress] = React.useState("");
    const [bakedSetupNotice, setBakedSetupNotice] = React.useState("");
    const [loadingResources, setLoadingResources] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [loadingList, setLoadingList] = React.useState(false);
    const [schematics, setSchematics] = React.useState([] as SchematicInfo[]);
    const [activePath, setActivePath] = React.useState("");
    const sceneRef = React.useRef(null as HTMLDivElement | null);
    const requestIdRef = React.useRef(0);
    const modelResourceKey = model?.blockNames.slice().sort().join("|") || "";

    React.useEffect(() => {
      if (!model || !sceneRef.current) return;
      setRenderError("");
      try {
        return resources ? mountResourceScene(sceneRef.current, model, resources) : mountScene(sceneRef.current, model);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setRenderError(message);
        host.actions.logger.error?.("Litematic WebGL render failed", reason);
      }
    }, [model, resources]);

    React.useEffect(() => {
      let cancelled = false;
      setResources(null); setResourceError(""); setResourceSummary(null); setResourceProgress(""); setBakedSetupNotice("");
      if (!instance?.id || !model) return;
      setLoadingResources(true);
      void (async () => {
        try {
          setResourceProgress("正在加载原版资源…");
          const response = await host.actions.invoke<string | InvokeResponse<string>>("read_instance_file", {
            instanceId: instance.id, dirType: "Root", path: clientJarPath(instance), mode: "base64"
          });
          const loaded = new ClientResources();
          loaded.loadArchive(decodeBase64(unwrapInvoke<string>(response)), new Set(["minecraft"]));

          const requiredNamespaces = modNamespaces(model);
          const renderEnvironment = detectRenderEnvironment(instance);
          let candidates: LocalModInfo[] = [], allMods: LocalModInfo[] = [], loadedMods = 0, scannedMods = 0;
          const discoveredNamespaces = new Set<string>();
          const failedMods: string[] = [];
          const failedResourcePacks: string[] = [];
          if (requiredNamespaces.size) {
            setResourceProgress("正在匹配整合包模组…");
            const modResponse = await host.actions.invoke<LocalModInfo[] | InvokeResponse<LocalModInfo[]>>(
              "retrieve_local_mod_list", { instanceId: instance.id }
            );
            allMods = unwrapInvoke<LocalModInfo[]>(modResponse).filter((mod) => mod.enabled && modArchiveFileName(mod));
            const primaryMods = selectRelevantMods(allMods, requiredNamespaces);
            const primaryFiles = new Set(primaryMods.map((mod) => mod.fileName));
            candidates = [...primaryMods, ...allMods.filter((mod) => !primaryFiles.has(mod.fileName))];
            for (let index = 0; index < candidates.length; index++) {
              if (cancelled) return;
              const unresolvedNamespaces = loaded.unresolvedBlockNamespaces(model.blocks);
              unresolvedNamespaces.delete("minecraft");
              for (const namespace of discoveredNamespaces) unresolvedNamespaces.delete(namespace);
              if (index >= primaryMods.length && !unresolvedNamespaces.size) break;
              const mod = candidates[index];
              const archiveName = modArchiveFileName(mod);
              if (!archiveName) continue;
              scannedMods++;
              setResourceProgress(`正在查找模组资源 ${index + 1}/${candidates.length}：${mod.name || mod.modId}`);
              try {
                const modResponse = await host.actions.invoke<string | InvokeResponse<string>>("read_instance_file", {
                  instanceId: instance.id, dirType: "Mods", path: archiveName, mode: "base64"
                });
                const result = loaded.loadArchive(
                  decodeBase64(unwrapInvoke<string>(modResponse)),
                  index < primaryMods.length ? undefined : unresolvedNamespaces,
                  true
                );
                for (const namespace of result.namespaces) discoveredNamespaces.add(namespace);
                if (result.definitions || result.models || result.textures) loadedMods++;
              } catch (reason) {
                failedMods.push(mod.name || mod.modId);
                host.actions.logger.warn?.(`Mod resources load failed: ${archiveName}`, reason);
              }
            }
          }

          let loadedResourcePacks = 0;
          try {
            setResourceProgress("正在加载实例资源包…");
            const [packResponse, optionsResponse] = await Promise.all([
              host.actions.invoke<ResourcePackInfo[] | InvokeResponse<ResourcePackInfo[]>>(
                "retrieve_resource_pack_list", { instanceId: instance.id }
              ),
              host.actions.invoke<string | InvokeResponse<string>>("read_instance_file", {
                instanceId: instance.id, dirType: "Root", path: "options.txt", mode: "string"
              })
            ]);
            const enabledPacks = selectEnabledResourcePacks(
              unwrapInvoke<ResourcePackInfo[]>(packResponse), unwrapInvoke<string>(optionsResponse)
            );
            for (let index = 0; index < enabledPacks.length; index++) {
              if (cancelled) return;
              const pack = enabledPacks[index], archiveName = archiveBaseName(pack.filePath);
              if (!archiveName) continue;
              setResourceProgress(`正在加载资源包 ${index + 1}/${enabledPacks.length}：${pack.name}`);
              try {
                const packFile = await host.actions.invoke<string | InvokeResponse<string>>("read_instance_file", {
                  instanceId: instance.id, dirType: "ResourcePacks", path: archiveName, mode: "base64"
                });
                loaded.loadArchive(decodeBase64(unwrapInvoke<string>(packFile)), undefined, true);
                loadedResourcePacks++;
              } catch (reason) {
                failedResourcePacks.push(pack.name);
                host.actions.logger.warn?.(`Resource pack load failed: ${archiveName}`, reason);
              }
            }
          } catch (reason) {
            host.actions.logger.warn?.("Enabled resource pack discovery failed", reason);
          }

          let bakedBlocks = 0;
          try {
            setResourceProgress(`正在查找 ${renderEnvironment.minecraftVersion} ${renderEnvironment.loader} 烘焙模型…`);
            const bakedResponse = await host.actions.invoke<string | InvokeResponse<string>>("read_instance_file", {
              instanceId: instance.id, dirType: "Root", path: BAKED_EXPORT_PATH, mode: "base64"
            });
            bakedBlocks = loaded.loadBakedArchive(decodeBase64(unwrapInvoke<string>(bakedResponse)), renderEnvironment).definitions;
          } catch (reason) {
            host.actions.logger.info?.("No compatible baked model cache found", reason);
            const exporter = selectBakedExporter(renderEnvironment);
            if (exporter) {
              const exporterInstalled = allMods.some((mod) =>
                mod.modId === "litematic_viewer_exporter" || modArchiveFileName(mod) === exporter.fileName
              );
              if (exporterInstalled) {
                if (!cancelled) setBakedSetupNotice("游戏模型导出器已安装。请启动并进入一次游戏主界面，生成烘焙模型后再刷新预览。");
              } else {
                try {
                  setResourceProgress("正在自动安装游戏模型导出器…");
                  const sourcePath = assetUrlToFilePath(api.resolveAssetUrl(exporter.assetPath));
                  const installResponse = await host.actions.invoke<void | InvokeResponse<void>>("copy_resources_to_instances", {
                    srcFilePaths: [sourcePath], tgtInstIds: [instance.id], tgtDirType: "Mods", decompress: false
                  });
                  unwrapInvoke<void>(installResponse);
                  if (!cancelled) setBakedSetupNotice("已自动安装游戏模型导出器。请启动并进入一次游戏主界面；模型缓存生成后，刷新预览即可使用游戏实际模型。");
                } catch (installReason) {
                  host.actions.logger.warn?.("Baked model exporter installation failed", installReason);
                  if (!cancelled) setBakedSetupNotice("已识别当前游戏环境，但模型导出器自动安装失败；当前继续使用静态资源近似渲染。");
                }
              }
            } else if (!cancelled) {
              setBakedSetupNotice(`已自动识别 ${renderEnvironment.minecraftVersion} ${renderEnvironment.loader}，当前尚无对应的游戏模型导出器。`);
            }
          }

          setResourceProgress("正在生成方块纹理图集…");
          const fallback = loaded.ensureRenderableBlocks(model.blocks);
          await loaded.finalize();
          if (!cancelled) {
            setResources(loaded);
            setResourceSummary({
              loadedMods,
              scannedMods,
              loadedResourcePacks,
              bakedBlocks,
              customNamespaces: requiredNamespaces.size,
              approximatedBlocks: fallback.approximated.length,
              placeholderBlocks: fallback.placeholders.length
            });
            const notices: string[] = [];
            if (failedMods.length) notices.push(`${failedMods.length} 个模组资源读取失败`);
            if (failedResourcePacks.length) notices.push(`${failedResourcePacks.length} 个启用资源包读取失败`);
            const approximatedCustom = fallback.approximated.filter((name) => !name.startsWith("minecraft:")).length;
            const placeholderCustom = fallback.placeholders.filter((name) => !name.startsWith("minecraft:")).length;
            if (approximatedCustom) notices.push(`${approximatedCustom} 种动态方块已用模组纹理生成静态近似模型`);
            if (placeholderCustom) notices.push(`${placeholderCustom} 种方块未提供可用模型或纹理，已显示为占位方块`);
            if (notices.length) setResourceError(notices.join("；"));
          }
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (!cancelled) setResourceError(`无法加载方块资源，已使用兼容预览：${message}`);
          host.actions.logger.warn?.("Minecraft and mod resources load failed", reason);
        } finally { if (!cancelled) { setLoadingResources(false); setResourceProgress(""); } }
      })();
      return () => { cancelled = true; };
    }, [host, instance?.id, instance?.versionPath, instance?.isVersionIsolated, instance?.version, instance?.majorVersion, instance?.modLoader?.loaderType, instance?.modLoader?.version, modelResourceKey]);

    const loadSchematic = React.useCallback(async (schematic: SchematicInfo) => {
      const requestId = ++requestIdRef.current;
      setLoading(true); setError(""); setActivePath(schematic.filePath);
      try {
        if (!instance?.id) throw new Error("当前没有选中的实例");
        const response = await host.actions.invoke<string | InvokeResponse<string>>("read_instance_file", {
          instanceId: instance.id,
          dirType: "Schematics",
          path: schematicRelativePath(schematic),
          mode: "base64"
        });
        const encoded = unwrapInvoke<string>(response);
        const parsed = parseLitematic(decodeBase64(encoded), fileNameFromPath(schematic));
        if (requestId === requestIdRef.current) setModel(parsed);
      } catch (reason) {
        if (requestId !== requestIdRef.current) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setModel(null); setError(`无法读取实例原理图：${message}`);
        host.actions.logger.error?.("Instance litematic load failed", reason);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, [host, instance?.id]);

    const refreshSchematics = React.useCallback(async () => {
      const instanceId = instance?.id;
      if (!instanceId) {
        setSchematics([]); setActivePath(""); setModel(null);
        return;
      }
      setLoadingList(true); setError("");
      try {
        const response = await host.actions.invoke<SchematicInfo[] | InvokeResponse<SchematicInfo[]>>(
          "retrieve_schematic_list", { instanceId }
        );
        const files = unwrapInvoke<SchematicInfo[]>(response)
          .filter((file) => /\.litematic$/i.test(file.filePath))
          .sort((a, b) => fileNameFromPath(a).localeCompare(fileNameFromPath(b), "zh-CN"));
        setSchematics(files);
        const requestedFile = requestedSchematicPath
          ? files.find((file) => schematicRelativePath(file) === requestedSchematicPath)
          : undefined;
        if (files.length) await loadSchematic(requestedFile || files[0]);
        else { setActivePath(""); setModel(null); }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setSchematics([]); setModel(null); setError(`无法获取实例原理图列表：${message}`);
      } finally { setLoadingList(false); }
    }, [instance?.id, loadSchematic, requestedSchematicPath]);

    React.useEffect(() => { void refreshSchematics(); }, [refreshSchematics]);

    async function loadFile(event: Event) {
      const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
      if (!file) return;
      setLoading(true); setError("");
      try {
        if (!/\.litematic$/i.test(file.name)) throw new Error("请选择扩展名为 .litematic 的文件");
        const parsed = parseLitematic(new Uint8Array(await file.arrayBuffer()), file.name);
        setModel(parsed); setActivePath("");
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setModel(null); setError(message); host.actions.logger.error?.("Litematic parse failed", reason);
      } finally { setLoading(false); input.value = ""; }
    }

    const activeSchematic = schematics.find((file: SchematicInfo) => file.filePath === activePath);
    const dimensions = model ? [
      model.bounds.max[0] - model.bounds.min[0] + 1,
      model.bounds.max[1] - model.bounds.min[1] + 1,
      model.bounds.max[2] - model.bounds.min[2] + 1
    ] : null;
    const isBusy = loading || loadingList;

    return (
      <VStack align="stretch" spacing={3} height="100%" minH={standalone ? "100vh" : "640px"} p={standalone ? 4 : 0}>
        <Box borderWidth="1px" borderRadius="xl" px={{ base: 3, md: 4 }} py={3} bg="blackAlpha.50">
          <HStack justify="space-between" flexWrap="wrap" gap={3}>
            <HStack spacing={3} minW={0}>
              {!standalone && <Button size="sm" variant="ghost" px={2} onClick={() => host.actions.navBack()}>← 返回</Button>}
              <Box minW={0}>
                <Text fontSize="lg" fontWeight="bold" lineHeight="short">Litematic 三维预览</Text>
                <Text fontSize="xs" color="gray.500" noOfLines={1}>{activeSchematic ? schematicRelativePath(activeSchematic) : "本地、安全地查看 Minecraft 原理图"}</Text>
              </Box>
            </HStack>
            <HStack spacing={2} flexWrap="wrap">
              <Badge colorScheme="green" variant="subtle">本地解析</Badge>
              <Badge colorScheme={resources ? "purple" : loadingResources ? "blue" : "gray"} variant="subtle">
                {resources ? resourceSummary?.customNamespaces ? `整合包模型 · ${resourceSummary.loadedMods} 模组` : "原版模型" : loadingResources ? "模型加载中" : "兼容模型"}
              </Badge>
              {instance?.name && <Badge variant="outline" maxW="180px" noOfLines={1}>{instance.name}</Badge>}
              <Button as="label" htmlFor="litematic-file" colorScheme="blue" size="sm" cursor="pointer" isLoading={loading}>选择文件</Button>
              <Input id="litematic-file" type="file" accept=".litematic,application/octet-stream" display="none" onChange={loadFile} />
              {!standalone && <Button size="sm" variant="outline" onClick={() => host.actions.openWindow(viewerWindowRoute(api.identifier), "Litematic 三维预览")}>独立窗口</Button>}
            </HStack>
          </HStack>
        </Box>

        {error && <Alert status="error" borderRadius="md"><AlertIcon /><Text fontSize="sm">{error}</Text></Alert>}
        {renderError && <Alert status="error" borderRadius="md"><AlertIcon /><Text fontSize="sm">三维渲染失败：{renderError}</Text></Alert>}
        {resourceError && <Alert status="warning" borderRadius="md"><AlertIcon /><Text fontSize="sm">{resourceError}</Text></Alert>}
        {bakedSetupNotice && <Alert status="info" borderRadius="md"><AlertIcon /><Text fontSize="sm">{bakedSetupNotice}</Text></Alert>}
        {!instance?.id && !loading && !model && (
          <Alert status="info" borderRadius="md"><AlertIcon /><Text fontSize="sm">请先在启动器中选择一个游戏实例，或使用右上角“选择文件”。</Text></Alert>
        )}
        {!loading && !model && instance?.id && !loadingList && (
          <Box borderWidth="1px" borderStyle="dashed" borderRadius="xl" p={{ base: 8, md: 12 }} textAlign="center" flex="1" bg="blackAlpha.50">
            <VStack spacing={3}><Text fontSize="4xl">◇</Text><Text fontWeight="bold">这个实例还没有 Litematic 原理图</Text><Text fontSize="sm" color="gray.500">将文件放入实例的 schematics 文件夹，或直接选择其他位置的文件。</Text><HStack><Button size="sm" onClick={() => void refreshSchematics()}>刷新列表</Button><Button as="label" htmlFor="litematic-file" size="sm" colorScheme="blue" cursor="pointer">选择文件</Button></HStack></VStack>
          </Box>
        )}
        {(model || isBusy || schematics.length > 0) && (
          <Grid templateColumns={{ base: "1fr", xl: "240px minmax(360px, 1fr) 270px" }} gap={3} flex="1" minH={0}>
            <VStack align="stretch" spacing={2} borderWidth="1px" borderRadius="xl" p={3} overflowY="auto" maxH={{ base: "220px", xl: "none" }} bg="blackAlpha.50">
              <HStack justify="space-between"><Box minW={0}><Text fontWeight="bold" fontSize="sm">实例原理图</Text><Text fontSize="xs" color="gray.500" noOfLines={1}>{instance?.name || "未选择实例"} · {schematics.length} 个</Text></Box><Button size="xs" variant="ghost" isLoading={loadingList} onClick={() => void refreshSchematics()}>刷新</Button></HStack>
              <Divider />
              {!schematics.length && !loadingList && <Text fontSize="xs" color="gray.500">没有找到 .litematic 文件</Text>}
              {schematics.map((file: SchematicInfo) => (
                <Button key={file.filePath} size="sm" height="auto" minH="38px" py={2} px={3} justifyContent="flex-start" textAlign="left" whiteSpace="normal" variant={activePath === file.filePath ? "solid" : "ghost"} colorScheme={activePath === file.filePath ? "blue" : undefined} onClick={() => void loadSchematic(file)}>
                  <Box minW={0}><Text fontSize="xs" fontWeight="semibold" noOfLines={1}>{fileNameFromPath(file)}</Text>{schematicRelativePath(file) !== fileNameFromPath(file) && <Text fontSize="10px" opacity={0.72} noOfLines={1}>{schematicRelativePath(file)}</Text>}</Box>
                </Button>
              ))}
            </VStack>
            <Box position="relative" minH={{ base: "420px", xl: "560px" }} height="100%" borderRadius="xl" overflow="hidden" borderWidth="1px" borderColor="whiteAlpha.300" bg="#10151d" boxShadow="md">
              {model && <Box ref={sceneRef} position="absolute" inset={0} />}
              {model && <HStack position="absolute" left={3} bottom={3} zIndex={1} spacing={2} px={3} py={1.5} borderRadius="full" bg="rgba(8,12,18,.72)" color="whiteAlpha.800" pointerEvents="none"><Text fontSize="xs">拖动旋转</Text><Text fontSize="xs" opacity={0.5}>·</Text><Text fontSize="xs">滚轮缩放</Text><Text fontSize="xs" opacity={0.5}>·</Text><Text fontSize="xs" color="green.300">Y ↑</Text></HStack>}
              {(isBusy || (loadingResources && !resources)) && <VStack position="absolute" inset={0} justify="center" bg="rgba(16,21,29,.88)" color="white" zIndex={2}><Spinner thickness="3px" speed="0.7s" /><Text fontSize="sm" fontWeight="medium">{loadingList ? "正在读取原理图列表…" : loading ? "正在解压并解析原理图…" : resourceProgress || "正在加载方块资源…"}</Text></VStack>}
            </Box>
            {model ? (
            <VStack align="stretch" spacing={4} overflowY="auto" borderWidth="1px" borderRadius="xl" p={4} bg="blackAlpha.50">
              <Box><Text fontSize="xs" color="gray.500" mb={1}>当前原理图</Text><Text fontSize="lg" fontWeight="bold" noOfLines={2}>{model.name}</Text>{model.author && <Text fontSize="sm" color="gray.500" mt={1}>作者：{model.author}</Text>}{model.description && <Text mt={3} fontSize="sm" color="gray.600">{model.description}</Text>}</Box>
              <Divider />
              <Grid templateColumns="1fr 1fr" gap={3}>
                <Stat size="sm" borderWidth="1px" borderRadius="lg" p={2.5}><StatLabel fontSize="xs">区域</StatLabel><StatNumber fontSize="lg">{model.regionCount}</StatNumber></Stat>
                <Stat size="sm" borderWidth="1px" borderRadius="lg" p={2.5}><StatLabel fontSize="xs">方块</StatLabel><StatNumber fontSize="lg">{formatCount(model.visibleBlocks)}</StatNumber></Stat>
                <Stat size="sm" borderWidth="1px" borderRadius="lg" p={2.5}><StatLabel fontSize="xs">总体积</StatLabel><StatNumber fontSize="lg">{formatCount(model.totalVolume)}</StatNumber></Stat>
                <Stat size="sm" borderWidth="1px" borderRadius="lg" p={2.5}><StatLabel fontSize="xs">数据版本</StatLabel><StatNumber fontSize="lg">{model.minecraftDataVersion ?? "未知"}</StatNumber></Stat>
              </Grid>
              {model.skippedBlocks > 0 && <Alert status="warning" borderRadius="md"><AlertIcon /><Text fontSize="xs">投影较大，为保证流畅度已抽样显示 {formatCount(model.blocks.length)} 个方块；统计值仍保持完整。</Text></Alert>}
              {resourceSummary?.customNamespaces > 0 && <Box borderWidth="1px" borderRadius="lg" p={3}><Text fontSize="xs" color="gray.500">整合包资源</Text><Text fontSize="sm" fontWeight="semibold" mt={1}>已扫描 {resourceSummary.scannedMods} 个模组，{resourceSummary.loadedMods} 个包含所需资源</Text><Text fontSize="xs" color="gray.500" mt={1}>已叠加 {resourceSummary.loadedResourcePacks} 个启用资源包 · {resourceSummary.bakedBlocks} 种游戏烘焙模型</Text><Text fontSize="xs" color="gray.500" mt={1}>{resourceSummary.customNamespaces} 个自定义命名空间 · {resourceSummary.placeholderBlocks ? `${resourceSummary.placeholderBlocks} 种方块使用占位模型` : resourceSummary.approximatedBlocks ? `${resourceSummary.approximatedBlocks} 种方块使用静态近似模型` : "模型完整"}</Text></Box>}
              <Box><Text fontSize="xs" color="gray.500" mb={2}>边界与尺寸</Text><Text fontSize="sm" fontWeight="semibold" mb={2}>{dimensions?.[0]} × {dimensions?.[1]} × {dimensions?.[2]}</Text><Grid templateColumns="28px 1fr" gap={1} fontSize="xs" color="gray.500"><Text fontWeight="bold">X</Text><Text>{model.bounds.min[0]} ～ {model.bounds.max[0]}</Text><Text fontWeight="bold">Y</Text><Text>{model.bounds.min[1]} ～ {model.bounds.max[1]}</Text><Text fontWeight="bold">Z</Text><Text>{model.bounds.min[2]} ～ {model.bounds.max[2]}</Text></Grid></Box>
            </VStack>) : <Box />}
          </Grid>
        )}
      </VStack>
    );
  };
}
