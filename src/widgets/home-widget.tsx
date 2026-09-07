import type { ExtensionFactoryApi } from "../types/host";
import { viewerRoute, viewerWindowRoute } from "../navigation/viewer-route";

export function createHomeWidget(api: ExtensionFactoryApi) {
  const React = api.React;
  const { Badge, Button, HStack, Text, VStack } = api.ChakraUI;
  return function HomeWidget() {
    const host = api.getHostContext();
    return (
      <VStack align="stretch" spacing={3}>
        <HStack justify="space-between"><Text fontWeight="bold">投影快速预览</Text><Badge colorScheme="purple">3D</Badge></HStack>
        <Text fontSize="sm" color="gray.500">无需进入游戏，直接查看 Litematica 投影的结构、尺寸和方块分布。</Text>
        <HStack>
          <Button size="sm" colorScheme="blue" onClick={() => host.actions.navigate(viewerRoute(api.identifier))}>打开预览器</Button>
          <Button size="sm" variant="outline" onClick={() => host.actions.openWindow(viewerWindowRoute(api.identifier), "Litematic 三维预览")}>独立窗口</Button>
        </HStack>
      </VStack>
    );
  };
}
