export interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}

export interface RpcProvider {
  request(method: string, params?: unknown[]): Promise<unknown>;
}

interface RpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

type RpcResponseFactory = (request: RpcRequest) => unknown | Promise<unknown>;

type RpcConfiguredResponse =
  | { result: unknown }
  | { error: RpcErrorPayload }
  | RpcResponseFactory
  | unknown;

export class MockRpcProvider implements RpcProvider {
  private readonly exactResponses = new Map<string, RpcConfiguredResponse>();
  private readonly methodResponses = new Map<string, RpcConfiguredResponse>();
  private readonly callHistory: RpcRequest[] = [];
  private nextId = 1;

  setResponse(method: string, params: unknown[] | undefined, response: RpcConfiguredResponse): this {
    const key = this.exactKey(method, params ?? []);
    this.exactResponses.set(key, response);
    return this;
  }

  setMethodResponse(method: string, response: RpcConfiguredResponse): this {
    this.methodResponses.set(method, response);
    return this;
  }

  getCalls(method?: string): RpcRequest[] {
    if (!method) {
      return [...this.callHistory];
    }
    return this.callHistory.filter((call) => call.method === method);
  }

  clear(): void {
    this.exactResponses.clear();
    this.methodResponses.clear();
    this.callHistory.length = 0;
    this.nextId = 1;
  }

  async request(method: string, params: unknown[] = []): Promise<unknown> {
    const request: RpcRequest = {
      jsonrpc: "2.0",
      id: this.nextId,
      method,
      params,
    };
    this.nextId += 1;
    this.callHistory.push(request);

    const exact = this.exactResponses.get(this.exactKey(method, params));
    const fallback = this.methodResponses.get(method);
    const configured = exact ?? fallback;

    if (configured === undefined) {
      throw new Error(`No mock response configured for ${method}`);
    }

    const resolved = typeof configured === "function" ? await configured(request) : configured;

    if (isRpcErrorResult(resolved)) {
      throw new Error(`RPC error ${resolved.error.code}: ${resolved.error.message}`);
    }
    if (isRpcResultWrapper(resolved)) {
      return resolved.result;
    }
    return resolved;
  }

  private exactKey(method: string, params: unknown[]): string {
    return `${method}:${stableStringify(params)}`;
  }
}

function isRpcResultWrapper(
  value: unknown,
): value is {
  result: unknown;
} {
  return Boolean(value) && typeof value === "object" && "result" in value;
}

function isRpcErrorResult(
  value: unknown,
): value is {
  error: RpcErrorPayload;
} {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return false;
  }
  const errorValue = (value as { error?: unknown }).error;
  return Boolean(errorValue) && typeof errorValue === "object";
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "__undefined__";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const objectEntries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const normalizedEntries = objectEntries.map(
    ([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`,
  );
  return `{${normalizedEntries.join(",")}}`;
}
