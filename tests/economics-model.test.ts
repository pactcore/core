import { describe, expect, it } from "bun:test";
import {
  groupCompensationByAsset,
  validateCompensationModel,
  type CompensationModel,
} from "../src/domain/economics";

describe("Compensation model", () => {
  it("validates multi-asset compensation legs", () => {
    const model: CompensationModel = {
      mode: "multi_asset",
      legs: [
        {
          id: "leg-1",
          payerId: "issuer-1",
          payeeId: "agent-1",
          assetId: "usdc-mainnet",
          amount: 25,
          unit: "USDC",
        },
        {
          id: "leg-2",
          payerId: "issuer-1",
          payeeId: "agent-1",
          assetId: "llm-token-gpt5",
          amount: 120000,
          unit: "token",
        },
      ],
    };

    const validation = validateCompensationModel(model);
    expect(validation.valid).toBeTrue();

    const grouped = groupCompensationByAsset(model);
    expect(grouped["usdc-mainnet"]).toBe(25);
    expect(grouped["llm-token-gpt5"]).toBe(120000);
  });

  it("rejects invalid single-asset models with multiple assets", () => {
    const invalid: CompensationModel = {
      mode: "single_asset",
      legs: [
        {
          id: "leg-1",
          payerId: "issuer-1",
          payeeId: "agent-1",
          assetId: "usdc-mainnet",
          amount: 10,
          unit: "USDC",
        },
        {
          id: "leg-2",
          payerId: "issuer-1",
          payeeId: "agent-1",
          assetId: "cloud-credit",
          amount: 3,
          unit: "credit",
        },
      ],
    };

    const validation = validateCompensationModel(invalid);
    expect(validation.valid).toBeFalse();
    expect(validation.reasons.some((reason) => reason.includes("single_asset"))).toBeTrue();
  });
});
