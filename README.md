# PACT Core

PACT Core is the protocol engine of the PACT Network.
It implements the execution model from the whitepaper: task lifecycle orchestration, multi-layer validation, reputation, matching, escrow settlement, and event-driven application services.

## Repository Positioning

PACT is split into two repositories:

- **`core`** (this repo): protocol logic and service runtime
- **`sdk`**: developer-facing TypeScript SDK for app and agent integration

This separation keeps protocol invariants stable while enabling fast SDK iteration.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                      Application Layer                                   │
│  PactCompute | PactTasks | PactPay | PactID | PactData | PactDev        │
├──────────────────────────────────────────────────────────────────────────┤
│                    Infrastructure Layer                                  │
│ Task Manager | Validator Consensus | Reputation | Scheduler              │
│ X402 Payment Adapter | Event Bus                                         │
├──────────────────────────────────────────────────────────────────────────┤
│                    Blockchain Abstraction Layer                          │
│ Escrow Gateway | Settlement Gateway (Base-chain abstraction)             │
└──────────────────────────────────────────────────────────────────────────┘
```

## Core Features

- Task lifecycle state machine: `Created → Assigned → Submitted → Verified → Completed`
- Illegal transition protection via `IllegalStateTransitionError`
- Three-stage validation pipeline:
  - Auto AI
  - Agent Validators
  - Human Jury
- Reputation model with clamped score range `0-100`
- Constraint-aware matching (Gale-Shapley variant)
- Deterministic payment split: `85/5/5/5`
- Hono REST API + event-driven orchestration
- In-memory adapters (easy to replace with production backends)

## Project Structure

```text
src/
  api/
  application/
    modules/
  domain/
  infrastructure/
  blockchain/
tests/
docs/
```

## Quick Start

```bash
bun install
bun test
bun run dev
```

Default server: `http://localhost:3000`

## API Summary

- `POST /id/participants`
- `GET /id/workers`
- `POST /tasks`
- `POST /tasks/:id/assign`
- `POST /tasks/:id/submit`
- `GET /tasks`
- `GET /tasks/:id`
- `GET /payments/ledger`
- `POST /compute/jobs`
- `POST /data/assets`
- `POST /dev/integrations`

## Tests

```bash
bun test
```

Current test suite covers domain rules, validation flow, matching, settlement split, and API orchestration.

## Docs

- `docs/architecture.md`
- `docs/domain-model.md`
- `docs/api.md`
