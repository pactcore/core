import type {
  SettlementConnectorTransport,
  SettlementConnectorTransportRequest,
  SettlementConnectorTransportResponse,
} from "../../application/settlement-connectors";

export class FetchSettlementConnectorTransport implements SettlementConnectorTransport {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseHeaders: Record<string, string> = {},
  ) {}

  async send(
    request: SettlementConnectorTransportRequest,
  ): Promise<SettlementConnectorTransportResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: {
          ...this.baseHeaders,
          ...request.headers,
        },
        body: request.body,
        signal: controller.signal,
      });

      return {
        status: response.status,
        body: await parseResponseBody(response),
        headers: Object.fromEntries(response.headers.entries()),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`settlement connector transport timed out after ${request.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  const body = await response.text();
  return body.length > 0 ? body : undefined;
}
