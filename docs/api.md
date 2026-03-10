# REST API

## Health

`GET /health`

## Identity

`POST /id/participants`

Example payload:

```json
{
  "id": "worker-1",
  "role": "worker",
  "displayName": "Alice",
  "skills": ["photo", "gps"],
  "capacity": 2,
  "initialReputation": 90,
  "location": { "latitude": 37.77, "longitude": -122.41 }
}
```

`GET /id/workers`

## Tasks

`POST /tasks`

`POST /tasks/:id/assign`

- With `workerId`: explicit assignment
- Without `workerId`: automatic matching

`POST /tasks/:id/submit`

Submitting evidence triggers validation + settlement orchestration.

`GET /tasks`

`GET /tasks/:id`

## Payments

`GET /payments/ledger`

## Heartbeat Supervision

`POST /heartbeat/tasks`

Registers a heartbeat control task.

Example payload:

```json
{
  "name": "mission-health-check",
  "intervalMs": 60000,
  "payload": { "kind": "health" }
}
```

`GET /heartbeat/tasks`

Lists registered heartbeat tasks.

`POST /heartbeat/tasks/:id/enable`

`POST /heartbeat/tasks/:id/disable`

`POST /heartbeat/tick`

Executes due heartbeat tasks (optional body `{ "now": <timestamp> }`).

## Economics

`POST /economics/assets`

Registers a compensation asset type inside the protocol runtime (for example: USDC, LLM tokens, cloud credits, API quota units).

Example payload:

```json
{
  "id": "usdc-mainnet",
  "kind": "usdc",
  "symbol": "USDC",
  "network": "base"
}
```

`GET /economics/assets`

Lists known compensation assets.

`POST /economics/quote`

Returns grouped totals by asset for a compensation model.

`POST /economics/valuations`

Registers an asset valuation against a reference asset (for example: LLM token -> USDC).

Example payload:

```json
{
  "assetId": "llm-gpt5",
  "referenceAssetId": "usdc-mainnet",
  "rate": 0.0001,
  "source": "internal-pricing-v1"
}
```

`GET /economics/valuations?referenceAssetId=usdc-mainnet`

Lists valuation records (optionally filtered by reference asset).

`POST /economics/quote-reference`

Converts a multi-asset compensation model into a single reference asset quote.

`POST /economics/settlement-plan`

Builds a settlement routing plan by asset class/rail (onchain stablecoin, llm metering, cloud billing, api quota, custom).

`GET /economics/reconciliation/summary`

Returns pending/failed reconciliation counts plus connector health.

`GET /economics/reconciliation/queue?state=pending&connector=cloud_credit_billing&settlementId=settlement-1`

Returns the reconciliation queue with optional filters for state, connector, settlement id, and failed idempotency key.

## Onchain Finality

`GET /onchain/finality/summary`

Returns the tracked onchain transaction counts by submitted/confirmed/finalized/reorged state.

`GET /onchain/finality/transactions?status=finalized&operation=governance_proposal_create&proposalId=proposal-1`

Lists tracked onchain writes with optional filters for status, operation, proposal, participant, epoch, and cursor pagination.

`GET /onchain/finality/transactions/:txId`

Returns the current finality snapshot for a specific tracked transaction.

## Other Modules

- `POST /compute/jobs`
- `POST /data/assets`
- `POST /dev/integrations`
