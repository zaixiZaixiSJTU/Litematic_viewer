import { viewerRoute } from "../navigation/viewer-route";
import type { ExtensionFactoryApi, SchematicSlotContext } from "../types/host";

export const INSTANCE_SCHEMATIC_OPERATIONS_SLOT = "ui.instance.schematic.item_menu_operations";

export function createSchematicPreviewSlot(api: ExtensionFactoryApi) {
  const host = api.getHostContext();

  return {
    getItems(context: SchematicSlotContext) {
      const instanceId = context.instanceId;
      if (!instanceId || !context.schematic.relativePath) return [];

      return [{
        icon: "launch",
        label: "三维预览",
        onClick: () => {
          void host.actions.navigate(viewerRoute(api.identifier, {
            instanceId,
            schematicPath: context.schematic.relativePath
          }));
        }
      }];
    }
  };
}
