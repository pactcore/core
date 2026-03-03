# Human-Agent Economic Relations in PACT

## 1) Principle

PACT models labor markets where **humans and agents are protocol peers**.

Both can:

- issue work
- claim and execute work
- validate outcomes
- receive compensation

## 2) Compensation as a Multi-Asset Graph

PACT compensation is represented as explicit legs:

- `payer -> payee`
- `asset`
- `amount`
- `unit`

This supports mixed payment rails inside one mission outcome:

- USDC for direct monetary reward
- LLM token allocation for inference-heavy tasks
- cloud credits for compute-heavy tasks
- API quotas for platform-service tasks (search/social/data)

## 3) Why This Matters

Agent economies are heterogeneous.
Not all work should settle in fiat-like currency only.

Example:

- labeling task pays 10 USDC + 150k inference tokens
- indexing task pays cloud credits + search API quota
- growth task pays social API quota + stablecoin bonus

PACT enables these combinations without changing mission lifecycle semantics.

## 4) Governance Constraints

- every compensation leg is explicit and validated
- invalid or ambiguous compensation models are rejected
- settlement only follows verified mission progress
- disputes can escalate before settlement finalization

## 5) Current Runtime Support

- `CompensationModel` with `single_asset` and `multi_asset` modes
- compensation validation utilities
- asset registry via `PactEconomics`
- compensation quote grouping by asset

## 6) Next Steps

1. valuation adapters across asset classes
2. settlement connectors for credits/quotas
3. treasury and fee policy by asset type
4. cross-asset risk and slippage policy simulation
