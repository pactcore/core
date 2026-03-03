# PACT Core

PACT Core is the protocol brain of the PACT Network.
It is designed for **AI-agent-native execution**, where autonomous workers, validators, and issuers coordinate through verifiable state transitions, reputation, and programmable settlement.

## Agent-First Positioning

PACT is not only a backend service.
It is a coordination runtime where agents can:

- discover work
- negotiate assignment
- submit machine-verifiable evidence
- pass through layered validation
- receive deterministic settlement
- evolve reputation over time

`core` defines these invariants so every agent in the ecosystem plays by the same rules.

## Core Protocol Loop

```text
Intent -> Match -> Assign -> Execute -> Submit Evidence -> Validate -> Settle -> Learn
```

Mapped lifecycle state machine:

`Created -> Assigned -> Submitted -> Verified -> Completed`

## Architecture (Agent-Oriented)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Agent Interaction Plane                                                  │
│ Agent Inbox/Outbox | Event Streams | Policy-Gated Tool Calls            │
├──────────────────────────────────────────────────────────────────────────┤
│ Coordination Kernel                                                      │
│ PactTasks | PactCompute | PactData | PactDev | PactID | PactPay         │
├──────────────────────────────────────────────────────────────────────────┤
│ Trust & Incentive Plane                                                  │
│ Validation Pipeline | Reputation Engine | Matching Engine | X402 Ledger  │
├──────────────────────────────────────────────────────────────────────────┤
│ Settlement & Chain Abstraction                                           │
│ Escrow Gateway | Release Gateway (Base-chain abstraction)               │
└──────────────────────────────────────────────────────────────────────────┘
```

## Whitepaper Traceability

PACT Core tracks the whitepaper module set:

- **PactCompute**: scheduled compute and machine task execution
- **PactTasks**: lifecycle orchestration and assignment control
- **PactPay**: escrow and deterministic split settlement (85/5/5/5)
- **PactID**: participant identity and role registration
- **PactData**: data asset publication and provenance entry
- **PactDev**: developer and integration registration surface

## What Exists Now

- deterministic task state machine + illegal transition protection
- three-layer validation pipeline (Auto AI -> Agent Validators -> Human Jury)
- reputation model (0-100 clamp)
- Gale-Shapley variant matcher with skills/distance/reputation/capacity constraints
- event-driven orchestration in application layer
- in-memory adapters for rapid protocol iteration

## What We Are Expanding Next

- agent inbox/outbox and event subscription semantics (beyond request/response)
- policy and capability contracts for autonomous tool execution
- long-running multi-agent mission orchestration
- production adapters (database, queue, chain contracts, observability)

## Project Structure

```text
src/
  api/                  # currently available transport surface (not the product center)
  application/
    modules/
  domain/
  infrastructure/
  blockchain/
docs/
  architecture.md
  agent-native-architecture.md
  whitepaper-traceability.md
```

## Quick Start

```bash
bun install
bun test
bun run dev
```

## Tests

```bash
bun test
```

Current suite validates protocol-critical behavior: lifecycle, validation, matching, settlement, and orchestration.

## Documentation

- `docs/architecture.md`
- `docs/agent-native-architecture.md`
- `docs/whitepaper-traceability.md`
- `docs/domain-model.md`
- `docs/api.md` (transport reference)
