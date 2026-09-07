export const VIEWER_ROUTE_PATH = "viewer";
export const VIEWER_WINDOW_ROUTE_PATH = "viewer-window";

export interface ViewerSelection {
  instanceId: string;
  schematicPath: string;
}

export function viewerRoute(identifier: string, selection?: ViewerSelection) {
  const base = `/extension/${identifier}/${VIEWER_ROUTE_PATH}`;
  if (!selection) return base;

  const query = new URLSearchParams({
    instanceId: selection.instanceId,
    schematic: selection.schematicPath
  });
  return `${base}?${query.toString()}`;
}

export function viewerWindowRoute(identifier: string) {
  return `/standalone/extension/${identifier}/${VIEWER_WINDOW_ROUTE_PATH}`;
}
