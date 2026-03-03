# PACT Core Architecture

## 1) Goal

PACT Core is designed as a **verifiable coordination runtime for AI agents**.
It is not centered on endpoint count; it is centered on protocol invariants, event semantics, and economic correctness.

## 2) Layered Runtime Model

### A. Agent Control Plane

Responsibilities:

- inbox/outbox message delivery for agents
- event subscription and replay cursor support
- heartbeat-compatible scheduled control hooks
- capability policy enforcement before sensitive actions

Primary artifacts:

- `AgentMailbox`
- `EventJournal`
- `CapabilityPolicyEngine`

### B. Coordination Kernel

Whitepaper module orchestration:

- `PactTasks`
- `PactCompute`
- `PactPay`
- `PactID`
- `PactData`
- `PactDev`
- `PactMissions` (agent-native mission flow)

### C. Trust & Incentive Kernel

Trust is computed, not assumed:

- three-layer validation (`Auto AI -> Agent Validators -> Human Jury`)
- reputation updates with bounded score semantics
- constrained matching engine
- challenge and escalation workflow
- bounded mission retry workflow

### D. Settlement & Chain Abstraction

Economic side effects are isolated and auditable:

- escrow creation/release
- X402 transfer logging
- future on-chain reconciliation adapters

## 3) Critical Invariants

1. State transitions are explicit and guarded.
2. Settlement is tied to protocol-approved progress.
3. Escalations are evented, not implicit.
4. Retry is bounded by policy (`maxRetries`).
5. Every runtime-critical event is replayable via journal.

## 4) Runtime Patterns Adopted

Borrowed patterns from modern autonomous-agent runtimes:

- continuous loop semantics (claim -> execute -> observe)
- heartbeat-like supervisory scheduling
- capability boundaries and policy checks
- persistent audit trails for post-hoc review

In PACT, these are adapted into a **governed protocol model** rather than unrestricted autonomy.

## 5) Why API Is Secondary

Transport (REST/MCP/queue/stream) is interchangeable.
The real product is the invariant engine:

- state graph
- event graph
- validation economics
- settlement logic

Any transport adapter must preserve these semantics.
