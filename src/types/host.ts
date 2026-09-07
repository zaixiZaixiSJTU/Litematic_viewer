export type ExtensionComponent<TProps = Record<string, never>> = (props: TProps) => unknown;

export interface InstanceSummary {
  id?: string;
  name?: string;
  versionPath?: string;
  isVersionIsolated?: boolean;
  [key: string]: unknown;
}

export interface SchematicInfo {
  name: string;
  filePath: string;
  relativePath: string;
}

export interface SchematicSlotContext {
  instanceId?: string;
  summary?: InstanceSummary;
  schematic: SchematicInfo;
}

export interface ExtensionSlotItem {
  icon: string;
  label?: string;
  onClick?: (...args: any[]) => void;
  danger?: boolean;
}

export interface ExtensionFactoryApi {
  React: Record<string, any>;
  ChakraUI: Record<string, any>;
  Components: Record<string, ExtensionComponent<any>>;
  identifier: string;
  resolveAssetUrl(path: string): string;
  useHostData(): {
    selectedInstance?: InstanceSummary;
    instanceList: InstanceSummary[];
    routeQuery: Record<string, string | string[] | undefined>;
    [key: string]: unknown;
  };
  getHostContext(): {
    actions: {
      navigate(route: string): Promise<void>;
      navBack(): void;
      openWindow(route: string, title: string): void;
      invoke<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<T>;
      logger: Record<string, (...args: any[]) => void>;
    };
    state: {
      useExtensionState<T>(key: string, initialValue: T): [T, (value: T | ((current: T) => T)) => void];
    };
  };
}

export interface ExtensionRegistration {
  homeWidget?: {
    key?: string;
    title: string;
    description?: string;
    defaultWidth?: number;
    minWidth?: number;
    Component: ExtensionComponent<any>;
  };
  pages?: Array<{
    routePath: string;
    isStandAlone?: boolean;
    Component: ExtensionComponent<any>;
  }>;
  slots?: {
    "ui.instance.schematic.item_menu_operations"?: {
      getItems(context: SchematicSlotContext): ExtensionSlotItem[];
    };
  };
}

export type ExtensionFactory = (api: ExtensionFactoryApi) => ExtensionRegistration | void;

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elementName: string]: any;
    }
  }
  interface Window {
    registerExtension?: (factory: ExtensionFactory, token: string) => void;
  }
}
