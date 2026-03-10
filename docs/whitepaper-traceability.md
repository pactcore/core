# Whitepaper Traceability Matrix

This document maps whitepaper concepts to current `core` implementation and next expansion path.

## Module Coverage

| Whitepaper Module | Current Status | Implemented Elements | Next Expansion |
|---|---|---|---|
| PactTasks | Partial+ | lifecycle state machine, assignment flow, evidence submission | mission decomposition and dependency graphs |
| PactCompute | Partial | compute queue + scheduler hooks | distributed execution adapters, resource accounting |
| PactPay | Partial+ | escrow abstraction, deterministic split logic, settlement triggers | multi-asset settlement execution and reconciliation |
| PactID | Partial | participant registration + role model | DID/attestation and stronger identity proofs |
| PactData | Early | data publication interface | provenance graph and integrity proofs |
| PactDev | Early | integration registration | policy bundles and ecosystem package governance |

## Mission Runtime Coverage

- mission envelope model: implemented
- execution step records: implemented
- evidence bundle model: implemented
- verdict recording: implemented
- challenge/escalation lifecycle: implemented
- bounded retry flow: implemented

## Supervisory Runtime Coverage

- heartbeat task registration: implemented
- periodic execution (`tick`): implemented
- enable/disable controls: implemented
- heartbeat event logging: implemented

## Economic Runtime Coverage

- compensation model primitives: implemented
- multi-asset compensation validation: implemented
- grouped compensation quote by asset: implemented
- asset registry abstraction: implemented
- valuation registry and reference-asset quoting: implemented (v0.2.x)
- settlement routing plan by asset rail: implemented (v0.2.x)

Compensation classes modeled:

- stablecoins (e.g., USDC)
- LLM token budgets
- cloud compute credits
- API quota units (search/social/data providers)

## Priority Gaps

1. durable mission/economic state stores beyond in-memory adapters
2. production event backends and long-horizon replay tooling
3. settlement connectors for non-crypto assets (credits/quotas)
4. anti-spam economics for challenge market behavior
5. policy simulation and risk analysis tooling

## Appendix C Coverage

- external prover/verifier bridge skeleton: implemented
- artifact manifest version and integrity validation: implemented
- verification receipt traceability for bridge-backed proofs: implemented
