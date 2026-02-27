/**
 * Minimal type stub for openclaw/plugin-sdk.
 * The real types come from the openclaw installation at runtime.
 */
declare module "openclaw/plugin-sdk" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  export interface OpenClawPluginLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  }

  export interface OpenClawPluginService {
    id: string;
    start(): Promise<void>;
    stop(): Promise<void>;
  }

  export interface OpenClawPluginApi {
    readonly config: unknown;
    readonly pluginConfig: unknown;
    readonly logger: OpenClawPluginLogger;
    registerService(service: OpenClawPluginService): void;
    registerHttpHandler(
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
    ): void;
  }
}
