import { describe, expect, test } from "bun:test";
import type { ExternalZKProveRequest, ExternalZKVerifyRequest, ZKArtifactDescriptor } from "../src/domain/zk-bridge";
import { createDefaultZKArtifactManifest } from "../src/infrastructure/zk/default-zk-artifact-manifest-factory";
import { RemoteHttpZKProverAdapter } from "../src/infrastructure/zk/remote-http-zk-prover-adapter";

describe("RemoteHttpZKProverAdapter", () => {
  test("sends prove and verify requests with provider auth and digest validation", async () => {
    const requests: RecordedRequest[] = [];
    const adapter = new RemoteHttpZKProverAdapter({
      endpoint: "https://zk.example.test/prover",
      providerId: "appendix-c-provider",
      credentialType: "bearer",
      credentials: {
        token: "remote-zk-token",
      },
      fetchImpl: createFetchStub(async (request) => {
        requests.push(request);
        if (request.operation === "prove") {
          return jsonResponse({
            commitment: "0xremote-commitment",
            proof: "0xremote-proof",
            traceId: "trace-remote-prove",
            adapterReceiptId: "receipt-remote-prove",
          }, request);
        }

        return jsonResponse({
          verified: true,
          traceId: "trace-remote-verify",
          adapterReceiptId: "receipt-remote-verify",
          details: {
            provider: "appendix-c-provider",
            retries: 1,
            cached: false,
          },
        }, request);
      }),
    });
    const manifest = createDefaultZKArtifactManifest("identity");

    const prove = await adapter.prove(buildProveRequest(manifest));
    const verify = await adapter.verify(buildVerifyRequest(manifest));

    expect(prove.commitment).toBe("0xremote-commitment");
    expect(prove.traceId).toBe("trace-remote-prove");
    expect(verify.verified).toBe(true);
    expect(verify.details).toEqual({
      provider: "appendix-c-provider",
      retries: "1",
      cached: "false",
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://zk.example.test/prover");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer remote-zk-token");
    expect(requests[0]?.headers.get("x-pact-zk-provider-id")).toBe("appendix-c-provider");
    expect(requests[0]?.headers.get("x-pact-zk-request-digest")?.startsWith("sha256:")).toBe(true);
    expect(requests[1]?.operation).toBe("verify");
    expect(requests[1]?.headers.get("authorization")).toBe("Bearer remote-zk-token");
  });

  test("loads remote artifacts from the artifact URI and validates response digests", async () => {
    const requests: RecordedRequest[] = [];
    const adapter = new RemoteHttpZKProverAdapter({
      endpoint: "https://zk.example.test/prover",
      providerId: "appendix-c-provider",
      credentialType: "api_key",
      credentials: {
        apiKey: "remote-zk-key",
      },
      fetchImpl: createFetchStub(async (request) => {
        requests.push(request);
        const payload = "remote-artifact-binary";
        return textResponse(payload, request, {
          "content-type": "application/wasm",
        });
      }),
    });
    const artifact: ZKArtifactDescriptor = {
      role: "wasm",
      uri: "https://cdn.example.test/identity/circuit.wasm",
      version: "1.0.0",
      integrity: "sha256:unused-for-adapter-test",
    };

    const loaded = await adapter.loadArtifact(artifact);

    expect(typeof loaded).not.toBe("string");
    expect(new TextDecoder().decode(loaded as Uint8Array)).toBe("remote-artifact-binary");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://cdn.example.test/identity/circuit.wasm");
    expect(requests[0]?.operation).toBe("load_artifact");
    expect(requests[0]?.headers.get("x-api-key")).toBe("remote-zk-key");
  });

  test("rejects mismatched remote response digest headers", async () => {
    const adapter = new RemoteHttpZKProverAdapter({
      endpoint: "https://zk.example.test/prover",
      providerId: "appendix-c-provider",
      credentialType: "bearer",
      credentials: {
        token: "remote-zk-token",
      },
      fetchImpl: createFetchStub(async (request) => {
        const body = JSON.stringify({
          commitment: "0xremote-commitment",
          proof: "0xremote-proof",
        });
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-pact-zk-request-digest": request.headers.get("x-pact-zk-request-digest") ?? "",
            "x-pact-zk-response-digest": "sha256:bad-response-digest",
          },
        });
      }),
    });

    await expect(adapter.prove(buildProveRequest(createDefaultZKArtifactManifest("completion")))).rejects.toThrow(
      "Remote ZK prove response digest mismatch",
    );
  });
});

interface RecordedRequest {
  url: string;
  operation: string;
  headers: Headers;
  body?: string;
}

function createFetchStub(
  handler: (request: RecordedRequest) => Promise<Response>,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    return handler({
      url: typeof input === "string" ? input : input.toString(),
      operation: headers.get("x-pact-zk-operation") ?? "unknown",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
  }) as typeof fetch;
}

async function jsonResponse(body: Record<string, unknown>, request: RecordedRequest): Promise<Response> {
  const payload = JSON.stringify(body);
  return new Response(payload, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-pact-zk-request-digest": request.headers.get("x-pact-zk-request-digest") ?? "",
      "x-pact-zk-response-digest": await createDigest(payload),
    },
  });
}

async function textResponse(
  body: string,
  request: RecordedRequest,
  headers: Record<string, string>,
): Promise<Response> {
  return new Response(body, {
    status: 200,
    headers: {
      ...headers,
      "x-pact-zk-request-digest": request.headers.get("x-pact-zk-request-digest") ?? "",
      "x-pact-zk-response-digest": await createDigest(body),
    },
  });
}

function buildProveRequest(manifest = createDefaultZKArtifactManifest("identity")): ExternalZKProveRequest {
  return {
    requestId: "zk-req-1",
    traceId: "zk-trace-1",
    proofType: manifest.proofType,
    proverId: "participant-1",
    challenge: "challenge-1",
    publicInputs: {
      participantId: "participant-1",
      isHuman: true,
    },
    witness: {
      witness: true,
    },
    createdAt: 1_710_000_000_000,
    manifest,
  };
}

function buildVerifyRequest(manifest = createDefaultZKArtifactManifest("identity")): ExternalZKVerifyRequest {
  return {
    traceId: "zk-trace-verify-1",
    proofId: "zk-proof-1",
    proofType: manifest.proofType,
    proverId: "participant-1",
    commitment: "0xremote-commitment",
    proof: "0xremote-proof",
    publicInputs: {
      participantId: "participant-1",
      isHuman: true,
    },
    createdAt: 1_710_000_000_000,
    manifest,
  };
}

async function createDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
