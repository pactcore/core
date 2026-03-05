export type DataCategory =
  | "geolocation"
  | "image_video"
  | "survey"
  | "sensor"
  | "labeled"
  | "other";

export interface DataListing {
  id: string;
  assetId: string;
  sellerId: string;
  priceCents: number;
  currency: "USDC";
  category: DataCategory;
  listedAt: number;
  active: boolean;
}

export interface RevenueDistribution {
  producerCents: number;
  validatorCents: number;
  protocolCents: number;
}

export interface DataPurchase {
  id: string;
  listingId: string;
  assetId: string;
  buyerId: string;
  priceCents: number;
  revenueDistribution: RevenueDistribution;
  purchasedAt: number;
}

export interface DataMarketplaceStats {
  totalListings: number;
  totalPurchases: number;
  totalRevenueCents: number;
}

export function calculateRevenueDistribution(priceCents: number): RevenueDistribution {
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    throw new Error("Price must be a positive integer number of cents");
  }

  const producerCents = Math.floor((priceCents * 70) / 100);
  const validatorCents = Math.floor((priceCents * 10) / 100);
  const protocolCents = priceCents - producerCents - validatorCents;

  return {
    producerCents,
    validatorCents,
    protocolCents,
  };
}
