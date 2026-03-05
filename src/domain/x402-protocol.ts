export interface MetaTransaction {
  from: string;
  to: string;
  value: number;
  data: string;
  nonce: number;
  gasPrice: number;
  gasLimit: number;
  relayerSignature: string;
}

export interface X402PaymentRequest {
  from: string;
  to: string;
  amountCents: number;
  reference: string;
  beneficiaryId?: string;
  gasSponsored?: boolean;
  data?: string;
}

export interface X402PaymentReceipt extends X402PaymentRequest {
  txId: string;
  paymentTxId: string;
  beneficiaryId: string;
  gasSponsored: boolean;
  gasUsed: number;
  gasCostCents: number;
  relayedAt: number;
  metaTransaction: MetaTransaction;
}

export interface RelayerConfig {
  relayerId: string;
  defaultGasPrice: number;
  baseGasLimit: number;
  gasPerDataByte: number;
  sponsorshipEnabled: boolean;
  maxSponsoredGasPerBeneficiary: number;
}

export interface SponsoredGasStats {
  beneficiaryId: string;
  sponsoredGasUsed: number;
  sponsoredTxCount: number;
  lastSponsoredAt?: number;
}

export interface GasSponsorshipOutcome {
  gasSponsored: boolean;
  gasUsed: number;
  gasCostCents: number;
  totalSponsoredGas: number;
}

export const DEFAULT_RELAYER_CONFIG: RelayerConfig = {
  relayerId: "x402-relayer",
  defaultGasPrice: 1,
  baseGasLimit: 21_000,
  gasPerDataByte: 16,
  sponsorshipEnabled: true,
  maxSponsoredGasPerBeneficiary: 200_000,
};

export function normalizeRelayerConfig(config: Partial<RelayerConfig> = {}): RelayerConfig {
  return {
    relayerId: config.relayerId ?? DEFAULT_RELAYER_CONFIG.relayerId,
    defaultGasPrice:
      config.defaultGasPrice ?? DEFAULT_RELAYER_CONFIG.defaultGasPrice,
    baseGasLimit: config.baseGasLimit ?? DEFAULT_RELAYER_CONFIG.baseGasLimit,
    gasPerDataByte:
      config.gasPerDataByte ?? DEFAULT_RELAYER_CONFIG.gasPerDataByte,
    sponsorshipEnabled:
      config.sponsorshipEnabled ?? DEFAULT_RELAYER_CONFIG.sponsorshipEnabled,
    maxSponsoredGasPerBeneficiary:
      config.maxSponsoredGasPerBeneficiary ??
      DEFAULT_RELAYER_CONFIG.maxSponsoredGasPerBeneficiary,
  };
}

export function validateX402PaymentRequest(request: X402PaymentRequest): void {
  if (!request.from.trim()) {
    throw new Error("from is required");
  }
  if (!request.to.trim()) {
    throw new Error("to is required");
  }
  if (!request.reference.trim()) {
    throw new Error("reference is required");
  }
  if (!Number.isInteger(request.amountCents) || request.amountCents <= 0) {
    throw new Error("amountCents must be a positive integer");
  }
}

export function estimateMetaTransactionGas(
  request: Pick<X402PaymentRequest, "data">,
  config: RelayerConfig,
): number {
  const dataBytes = Math.max(0, request.data?.trim().length ?? 0);
  return config.baseGasLimit + dataBytes * config.gasPerDataByte;
}

export function buildMetaTransaction(
  request: X402PaymentRequest,
  nonce: number,
  gasLimit: number,
  config: RelayerConfig,
): MetaTransaction {
  validateX402PaymentRequest(request);
  if (!Number.isInteger(nonce) || nonce < 0) {
    throw new Error("nonce must be a non-negative integer");
  }
  if (!Number.isInteger(gasLimit) || gasLimit <= 0) {
    throw new Error("gasLimit must be a positive integer");
  }

  const data = request.data?.trim()
    ? request.data
    : `x402:${request.reference}:${request.from}->${request.to}`;

  return {
    from: request.from,
    to: request.to,
    value: request.amountCents,
    data,
    nonce,
    gasPrice: config.defaultGasPrice,
    gasLimit,
    relayerSignature: createRelayerSignature(request, nonce, config.relayerId),
  };
}

export function applyGasSponsorship(
  beneficiaryId: string,
  gasUsed: number,
  currentSponsoredGas: number,
  gasSponsoredRequested: boolean,
  config: RelayerConfig,
): GasSponsorshipOutcome {
  if (!beneficiaryId.trim()) {
    throw new Error("beneficiaryId is required");
  }
  if (!Number.isInteger(gasUsed) || gasUsed <= 0) {
    throw new Error("gasUsed must be a positive integer");
  }
  if (!Number.isInteger(currentSponsoredGas) || currentSponsoredGas < 0) {
    throw new Error("currentSponsoredGas must be a non-negative integer");
  }

  const gasCostCents = gasUsed * config.defaultGasPrice;
  if (!gasSponsoredRequested || !config.sponsorshipEnabled) {
    return {
      gasSponsored: false,
      gasUsed,
      gasCostCents,
      totalSponsoredGas: currentSponsoredGas,
    };
  }

  const nextSponsoredGas = currentSponsoredGas + gasUsed;
  if (nextSponsoredGas > config.maxSponsoredGasPerBeneficiary) {
    throw new Error(`Gas sponsorship limit exceeded for ${beneficiaryId}`);
  }

  return {
    gasSponsored: true,
    gasUsed,
    gasCostCents,
    totalSponsoredGas: nextSponsoredGas,
  };
}

function createRelayerSignature(
  request: X402PaymentRequest,
  nonce: number,
  relayerId: string,
): string {
  return `relayer_sig_${relayerId}_${request.from}_${request.to}_${request.amountCents}_${nonce}`;
}
