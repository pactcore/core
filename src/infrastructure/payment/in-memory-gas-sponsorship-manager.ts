import type { GasSponsorshipManager } from "../../application/contracts";
import { generateId } from "../../application/utils";
import type { GasSponsorshipGrant } from "../../domain/payment-routing";

export class InMemoryGasSponsorshipManager implements GasSponsorshipManager {
  private readonly grants = new Map<string, GasSponsorshipGrant>();

  async grant(
    sponsorId: string,
    beneficiaryId: string,
    maxGasCents: number,
  ): Promise<GasSponsorshipGrant> {
    if (!sponsorId.trim()) {
      throw new Error("sponsorId is required");
    }
    if (!beneficiaryId.trim()) {
      throw new Error("beneficiaryId is required");
    }
    if (!Number.isInteger(maxGasCents) || maxGasCents <= 0) {
      throw new Error("maxGasCents must be a positive integer");
    }

    const grant: GasSponsorshipGrant = {
      id: generateId("gas_grant"),
      sponsorId,
      beneficiaryId,
      maxGasCents,
      usedGasCents: 0,
      createdAt: Date.now(),
    };
    this.grants.set(grant.id, grant);
    return { ...grant };
  }

  async useGas(grantId: string, gasCents: number): Promise<GasSponsorshipGrant> {
    const grant = this.getGrantOrThrow(grantId);
    if (!Number.isInteger(gasCents) || gasCents <= 0) {
      throw new Error("gasCents must be a positive integer");
    }

    const nextUsed = grant.usedGasCents + gasCents;
    if (nextUsed > grant.maxGasCents) {
      throw new Error(`Gas sponsorship grant ${grantId} exhausted`);
    }

    const updated: GasSponsorshipGrant = {
      ...grant,
      usedGasCents: nextUsed,
    };
    this.grants.set(grantId, updated);
    return { ...updated };
  }

  async getGrant(grantId: string): Promise<GasSponsorshipGrant | undefined> {
    const grant = this.grants.get(grantId);
    if (!grant) {
      return undefined;
    }
    return { ...grant };
  }

  private getGrantOrThrow(grantId: string): GasSponsorshipGrant {
    const grant = this.grants.get(grantId);
    if (!grant) {
      throw new Error(`Gas sponsorship grant ${grantId} not found`);
    }
    return grant;
  }
}
