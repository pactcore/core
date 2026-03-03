export interface PaymentDistribution {
  workerCents: number;
  validatorsPoolCents: number;
  treasuryCents: number;
  issuerCents: number;
  validatorPayouts: Record<string, number>;
  totalCents: number;
}

export class PaymentSplitService {
  split(paymentCents: number, validatorIds: string[]): PaymentDistribution {
    if (paymentCents <= 0) {
      throw new Error("Payment must be positive");
    }

    const workerCents = Math.floor((paymentCents * 85) / 100);
    const validatorsPoolCents = Math.floor((paymentCents * 5) / 100);
    const treasuryCents = Math.floor((paymentCents * 5) / 100);
    const issuerCents = Math.floor((paymentCents * 5) / 100);

    const validatorPayouts: Record<string, number> = {};
    if (validatorIds.length > 0) {
      const base = Math.floor(validatorsPoolCents / validatorIds.length);
      let remainder = validatorsPoolCents - base * validatorIds.length;
      for (const validatorId of validatorIds) {
        const extra = remainder > 0 ? 1 : 0;
        validatorPayouts[validatorId] = base + extra;
        remainder = Math.max(0, remainder - 1);
      }
    }

    const allocated =
      workerCents + validatorsPoolCents + treasuryCents + issuerCents;
    const dust = paymentCents - allocated;

    return {
      workerCents,
      validatorsPoolCents,
      treasuryCents: treasuryCents + dust,
      issuerCents,
      validatorPayouts,
      totalCents: paymentCents,
    };
  }
}
