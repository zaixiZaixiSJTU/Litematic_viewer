import type { ExtensionFactory, ExtensionFactoryApi } from "./types/host";
import { createViewerPage } from "./pages/viewer-page";
import { createHomeWidget } from "./widgets/home-widget";

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
      { routePath: "viewer", Component: createViewerPage(api, false) },
      { routePath: "viewer-window", isStandAlone: true, Component: createViewerPage(api, true) }
    ]
  };
});
