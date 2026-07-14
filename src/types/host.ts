export type ExtensionComponent<TProps = Record<string, never>> = (props: TProps) => unknown;

export interface ExtensionFactoryApi {
  React: Record<string, any>;
  ChakraUI: Record<string, any>;
  Components: Record<string, ExtensionComponent<any>>;
  identifier: string;
  resolveAssetUrl(path: string): string;
  useHostData(): {
    selectedInstance?: { id?: string; name?: string; versionPath?: string; isVersionIsolated?: boolean };
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
