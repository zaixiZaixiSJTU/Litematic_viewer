import type { ExtensionFactory, ExtensionFactoryApi } from "./types/host";
import { createViewerPage } from "./pages/viewer-page";
import { createHomeWidget } from "./widgets/home-widget";
import { VIEWER_ROUTE_PATH, VIEWER_WINDOW_ROUTE_PATH } from "./navigation/viewer-route";
import { createSchematicPreviewSlot, INSTANCE_SCHEMATIC_OPERATIONS_SLOT } from "./slots/schematic-preview-slot";

(function registerLitematicViewer(factory: ExtensionFactory) {
  const token = document.currentScript?.dataset?.extensionToken || "";
  if (!token) throw new Error("Missing extension activation token");
  if (typeof window.registerExtension !== "function") throw new Error("SJMCL host is unavailable");
  window.registerExtension(factory, token);
})(function createExtension(api: ExtensionFactoryApi) {
  return {
    homeWidget: {
      key: "litematic-viewer",
      title: "Litematic 三维预览",
      description: "本地加载并预览 Litematica 投影",
      defaultWidth: 380,
      minWidth: 320,
      Component: createHomeWidget(api)
    },
    pages: [
      { routePath: VIEWER_ROUTE_PATH, Component: createViewerPage(api, false) },
      { routePath: VIEWER_WINDOW_ROUTE_PATH, isStandAlone: true, Component: createViewerPage(api, true) }
    ],
    slots: {
      [INSTANCE_SCHEMATIC_OPERATIONS_SLOT]: createSchematicPreviewSlot(api)
    }
  };
});
