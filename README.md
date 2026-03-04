# PACT Core

PACT Core is the protocol runtime of the PACT Network, built for **human + agent co-working economies**.

The architecture is derived from the PACT whitepaper as the normative baseline:

- six protocol modules (`PactCompute`, `PactTasks`, `PactPay`, `PactID`, `PactData`, `PactDev`)
- verifiable lifecycle transitions
- layered validation and dispute handling
- programmable settlement

## Human-Agent Economic Parity

PACT treats humans and agents as first-class participants:

- both can publish work
- both can complete work
- both can receive compensation based on protocol outcomes

Compensation is modeled as a **multi-asset settlement graph**, not a single payment rail.

Supported reward classes in current architecture:

- stablecoins (`USDC`, etc.)
- LLM token budgets/allowances
- cloud compute credits
- API quota credits (search, social, data APIs)

## Core Protocol Loop

```text
Intent -> Claim -> Execute -> Emit Evidence -> Validate -> Escalate(if needed) -> Settle -> Learn
```

State anchors in current implementation:

- task: `Created -> Assigned -> Submitted -> Verified -> Completed`
- mission: `Open -> Claimed -> InProgress -> UnderReview -> Settled/Failed`

## Architecture (Runtime-Centric)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Agent & Human Control Plane                                              │
│ Inbox/Outbox | Event Streams | Heartbeat Tasks | Capability Boundaries  │
├──────────────────────────────────────────────────────────────────────────┤
│ Coordination Kernel                                                      │
│ PactTasks | PactCompute | PactData | PactDev | PactID | PactPay         │
├──────────────────────────────────────────────────────────────────────────┤
│ Trust & Incentive Kernel                                                 │
│ Validation Pipeline | Reputation | Matching | Challenge/Retry Logic      │
├──────────────────────────────────────────────────────────────────────────┤
│ Economy & Settlement Kernel                                              │
│ Multi-Asset Compensation Model | Escrow | X402 | Settlement Gateways     │
└──────────────────────────────────────────────────────────────────────────┘
```

## What Is Implemented Now

- deterministic task state machine and transition guards
- mission runtime primitives (envelope, steps, evidence, verdicts)
- challenge/escalation lifecycle and jury resolution paths
- bounded retry policy for failed missions
- heartbeat supervision runtime
- event source + journal replay primitives
- compensation model primitives for multi-asset settlement planning

## Product Principle

PACT is not API-centric infrastructure.
PACT is **protocol-centric labor coordination** where trust, evidence, and payout semantics are machine-verifiable.

## Project Structure

```text
src/
  api/                  # transport surface (not product center)
  application/
    modules/
  domain/
  infrastructure/
  blockchain/
docs/
  architecture.md
  agent-native-architecture.md
  agent-runtime-blueprint.md
  economic-relations.md
  whitepaper-traceability.md
```

## Quick Start

```bash
bun install
bun test
bun run typecheck
bun run dev
```

### Optional Durable Storage

By default, settlement audit records and event journal streams are kept in-memory.
Set either (or both) env vars to persist them to disk.

```bash
PACT_SETTLEMENT_RECORD_STORE_FILE=.data/settlement-records.json \
PACT_EVENT_JOURNAL_STORE_FILE=.data/event-journal.json \
bun run dev
```

## Documentation

- `docs/architecture.md`
- `docs/agent-native-architecture.md`
- `docs/agent-runtime-blueprint.md`
- `docs/economic-relations.md`
- `docs/whitepaper-traceability.md`
- `docs/domain-model.md`
- `docs/api.md` (transport reference)
