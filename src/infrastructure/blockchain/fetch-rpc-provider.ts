import type { RpcProvider } from "./mock-rpc-provider";

export interface FetchRpcProviderOptions {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export class FetchRpcProvider implements RpcProvider {
  private nextId = 1;
  private readonly rpcUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: FetchRpcProviderOptions) {
    this.rpcUrl = options.rpcUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    };
  }

  async request(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId,
        method,
        params,
      }),
    });
    this.nextId += 1;

    if (!response.ok) {
      throw new Error(`RPC request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      result?: unknown;
      error?: {
        code?: number;
        message?: string;
      };
    };

    if (payload.error) {
      throw new Error(`RPC error ${payload.error.code ?? "unknown"}: ${payload.error.message ?? "unknown"}`);
    }

    return payload.result;
  }
}
