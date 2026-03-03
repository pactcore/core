import { describe, expect, it } from "bun:test";
import { PaymentSplitService } from "../src/domain/payment-split";

describe("PaymentSplitService", () => {
  it("keeps 85/5/5/5 distribution and preserves total", () => {
    const splitter = new PaymentSplitService();
    const distribution = splitter.split(10000, ["v1", "v2"]);

    expect(distribution.workerCents).toBe(8500);
    expect(distribution.validatorsPoolCents).toBe(500);
    expect(distribution.treasuryCents).toBe(500);
    expect(distribution.issuerCents).toBe(500);

    const validatorSum = Object.values(distribution.validatorPayouts).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(validatorSum).toBe(500);

    const total =
      distribution.workerCents +
      distribution.treasuryCents +
      distribution.issuerCents +
      validatorSum;

    expect(total).toBe(10000);
  });
});
