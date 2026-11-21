import { IPC_CHANNELS, type ElectronBridgeAPI, type IpcChannel, type IpcResult } from '../ipc/contracts.ts';

const ALLOWED_CHANNELS = new Set<string>(Object.values(IPC_CHANNELS));

export function isAllowedIpcChannel(channel: string): channel is IpcChannel {
  return ALLOWED_CHANNELS.has(channel);
}

/**
 * Builds the preload API exposed to the renderer via contextBridge.
 * Enforces strict channel allowlisting before invoking ipcRenderer.
 */
export function createPreloadBridge(
  invoker: (channel: string, payload?: unknown) => Promise<unknown>
): ElectronBridgeAPI {
  return {
    runtime: 'desktop',
    async invoke<TReq = unknown, TRes = unknown>(
      channel: IpcChannel,
      payload?: TReq
    ): Promise<IpcResult<TRes>> {
      if (!isAllowedIpcChannel(channel)) {
        return {
          ok: false,
          error: {
            code: 'FORBIDDEN',
            message: `Canal IPC non autorisé: ${String(channel)}`,
          },
        };
      }
      return (await invoker(channel, payload)) as IpcResult<TRes>;
    },
  };
}
