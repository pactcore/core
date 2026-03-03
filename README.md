# PACT Core

PACT Core is the protocol runtime of the PACT Network, built for **AI-agent-first coordination**.

It follows the PACT whitepaper as the normative baseline, while integrating practical runtime lessons from modern autonomous-agent systems (for example: continuous loop execution patterns and heartbeat governance) and Web4-style agent economy framing.

## Design Inputs

1. **PACT Whitepaper (source of truth)**
   - six modules (`PactCompute`, `PactTasks`, `PactPay`, `PactID`, `PactData`, `PactDev`)
   - state machine, validation, matching, and incentive constraints
2. **Automaton-style runtime patterns (inspiration)**
   - Think -> Act -> Observe style loops
   - heartbeat and scheduled control tasks
   - explicit capability policy and audit trails
3. **Web4 framing (directional narrative)**
   - agents as first-class digital operators in an economic network
   - programmable trust and machine-verifiable work

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
│ Agent Control Plane                                                      │
│ Inbox/Outbox | Event Streams | Heartbeat Hooks | Capability Boundaries  │
├──────────────────────────────────────────────────────────────────────────┤
│ Coordination Kernel                                                      │
│ PactTasks | PactCompute | PactData | PactDev | PactID | PactPay         │
├──────────────────────────────────────────────────────────────────────────┤
│ Trust & Incentive Kernel                                                 │
│ Validation Pipeline | Reputation | Matching | Challenge/Retry Logic      │
├──────────────────────────────────────────────────────────────────────────┤
│ Settlement & Chain Abstraction                                           │
│ Escrow Gateway | Release Gateway | X402 Payment Adapter                  │
└──────────────────────────────────────────────────────────────────────────┘
```

## What Is Implemented Now

- deterministic task state machine and transition guards
- mission runtime primitives (envelope, steps, evidence, verdicts)
- agent mailbox (inbox/outbox) and event journal replay
- three-layer validation pipeline
- challenge/escalation lifecycle and jury resolution paths
- bounded retry policy for failed missions
- reputation + matching + payment split (`85/5/5/5`)

## What Is Intentionally Out of Scope (for now)

- unbounded self-replication
- unconstrained side-effect execution
- opaque settlement outside protocol events

PACT Core prioritizes **bounded autonomy + verifiable economics**, not raw autonomy.

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
  automaton-web4-alignment.md
  whitepaper-traceability.md
```

## Quick Start

```bash
bun install
bun test
bun run typecheck
bun run dev
```

## Documentation

- `docs/architecture.md`
- `docs/agent-native-architecture.md`
- `docs/agent-runtime-blueprint.md`
- `docs/automaton-web4-alignment.md`
- `docs/whitepaper-traceability.md`
- `docs/domain-model.md`
- `docs/api.md` (transport reference)
