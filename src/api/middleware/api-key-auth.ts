import type { MiddlewareHandler } from "hono";

export interface ApiKeyInfo {
  id: string;
  ownerId: string;
  permissions: string[];
  rateLimit?: number;
}

export interface ApiKeyValidator {
  validateKey(key: string): Promise<ApiKeyInfo | null>;
}

export interface ApiKeyConfig {
  headerName?: string;
  validator: (key: string) => Promise<ApiKeyInfo | null>;
}

declare module "hono" {
  interface ContextVariableMap {
    apiKeyInfo?: ApiKeyInfo;
  }
}

export function createApiKeyAuth(config: ApiKeyConfig): MiddlewareHandler {
  const headerName = (config.headerName ?? "x-api-key").toLowerCase();

  return async (c, next) => {
    const rawApiKey = c.req.header(headerName);
    const apiKey = rawApiKey?.trim();

    if (!apiKey) {
      return c.json(
        {
          error: "missing_api_key",
          message: `Missing API key in ${headerName} header`,
        },
        401,
      );
    }

    const apiKeyInfo = await config.validator(apiKey);
    if (!apiKeyInfo) {
      return c.json(
        {
          error: "invalid_api_key",
          message: "Invalid API key",
        },
        403,
      );
    }

    c.set("apiKeyInfo", apiKeyInfo);
    await next();
  };
}
