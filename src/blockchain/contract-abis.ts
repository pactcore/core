export const PACT_ESCROW_ABI = [
  "function WORKER_BPS() view returns (uint16)",
  "function VALIDATORS_BPS() view returns (uint16)",
  "function TREASURY_BPS() view returns (uint16)",
  "function ISSUER_BPS() view returns (uint16)",
  "function usdc() view returns (address)",
  "function createEscrow(uint256 taskId, address payer, uint256 amount)",
  "function releaseEscrow(uint256 taskId, (address worker, address validators, address treasury, address issuer) payouts)",
  "function refundEscrow(uint256 taskId)",
  "function getEscrow(uint256 taskId) view returns (address payer, uint256 amount, bool released, bool refunded)",
] as const;

export const PACT_IDENTITY_SBT_ABI = [
  "function UPGRADER_ROLE() view returns (bytes32)",
  "function mint(address to, uint256 participantId, string role, uint8 level) returns (uint256 tokenId)",
  "function upgradeLevel(uint256 tokenId, uint8 newLevel)",
  "function getIdentity(uint256 tokenId) view returns (string role, uint8 level, uint256 registeredAt)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
] as const;

export const PACT_STAKING_ABI = [
  "function usdc() view returns (address)",
  "function juryTreasury() view returns (address)",
  "function protocolTreasury() view returns (address)",
  "function upheldPenaltyBps() view returns (uint16)",
  "function postStake(uint256 challengeId, uint256 amount)",
  "function resolveStake(uint256 challengeId, bool upheld)",
  "function getStake(uint256 challengeId) view returns (address challenger, uint256 amount, bool resolved, bool upheld)",
] as const;

export const PACT_PAY_ROUTER_ABI = [
  "function usdc() view returns (address)",
  "function transfer(address from, address to, uint256 amount, bytes32 ref)",
  "function batchTransfer((address from, address to, uint256 amount, bytes32 ref)[] transfers)",
  "function getLedger(address participant) view returns ((address from, address to, uint256 amount, bytes32 ref, uint64 timestamp)[] entries)",
] as const;

export interface ContractAddresses {
  escrow: string;
  identitySBT: string;
  staking: string;
  payRouter: string;
}
