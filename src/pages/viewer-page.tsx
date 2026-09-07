import type { ExtensionFactoryApi, InstanceSummary, SchematicInfo } from "../types/host";
import { viewerWindowRoute } from "../navigation/viewer-route";
import { parseLitematic, type LitematicPreview } from "../litematic/parser";
import { mountScene } from "../viewer/scene";
import { ClientResources } from "../viewer/resource-pack";
import { mountResourceScene } from "../viewer/resource-scene";

function formatCount(value: number) { return new Intl.NumberFormat("zh-CN").format(value); }

interface InvokeResponse<T> { status?: string; data?: T; raw_error?: string; details?: string; message?: string; }

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
    const [loadingResources, setLoadingResources] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [loadingList, setLoadingList] = React.useState(false);
    const [schematics, setSchematics] = React.useState([] as SchematicInfo[]);
    const [activePath, setActivePath] = React.useState("");
    const sceneRef = React.useRef(null as HTMLDivElement | null);
    const requestIdRef = React.useRef(0);

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
      setResources(null); setResourceError("");
      if (!instance?.id) return;
      setLoadingResources(true);
      void (async () => {
        try {
          const response = await host.actions.invoke<string | InvokeResponse<string>>("read_instance_file", {
            instanceId: instance.id, dirType: "Root", path: clientJarPath(instance), mode: "base64"
          });
          const loaded = new ClientResources();
          await loaded.loadJar(decodeBase64(unwrapInvoke<string>(response)));
          if (!cancelled) setResources(loaded);
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (!cancelled) setResourceError(`无法加载原版方块模型，已使用兼容预览：${message}`);
          host.actions.logger.warn?.("Minecraft client resources load failed", reason);
        } finally { if (!cancelled) setLoadingResources(false); }
      })();
      return () => { cancelled = true; };
    }, [host, instance?.id, instance?.versionPath, instance?.isVersionIsolated]);

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
                {resources ? "原版模型" : loadingResources ? "模型加载中" : "兼容模型"}
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
              {isBusy && <VStack position="absolute" inset={0} justify="center" bg="rgba(16,21,29,.88)" color="white" zIndex={2}><Spinner thickness="3px" speed="0.7s" /><Text fontSize="sm" fontWeight="medium">{loadingList ? "正在读取原理图列表…" : "正在解压并解析原理图…"}</Text></VStack>}
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
              <Box><Text fontSize="xs" color="gray.500" mb={2}>边界与尺寸</Text><Text fontSize="sm" fontWeight="semibold" mb={2}>{dimensions?.[0]} × {dimensions?.[1]} × {dimensions?.[2]}</Text><Grid templateColumns="28px 1fr" gap={1} fontSize="xs" color="gray.500"><Text fontWeight="bold">X</Text><Text>{model.bounds.min[0]} ～ {model.bounds.max[0]}</Text><Text fontWeight="bold">Y</Text><Text>{model.bounds.min[1]} ～ {model.bounds.max[1]}</Text><Text fontWeight="bold">Z</Text><Text>{model.bounds.min[2]} ～ {model.bounds.max[2]}</Text></Grid></Box>
            </VStack>) : <Box />}
          </Grid>
        )}
      </VStack>
    );
  };
}
