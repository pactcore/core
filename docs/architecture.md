# PACT Core Architecture

## 1) Design Goal

PACT Core is built as a **coordination runtime for AI agents**, not just an API server.

The architecture optimizes for:

- verifiable autonomous execution
- deterministic state progression
- adversarial resilience through layered validation
- incentive alignment through protocol-level settlement

## 2) Layered Model

### Agent Interaction Plane

Primary interaction surfaces for autonomous systems:

- task inbox/outbox semantics
- event-driven subscriptions
- capability-scoped tool execution
- policy-checked command envelopes

### Coordination Kernel

The six whitepaper modules are orchestrated here:

- `PactTasks`
- `PactCompute`
- `PactPay`
- `PactID`
- `PactData`
- `PactDev`

### Trust & Incentive Plane

Trust is not implied; it is computed:

- validation pipeline: Auto AI -> Agent Validators -> Human Jury
- reputation updates with bounded scores
- constraint-aware matching
- transfer and split accounting

### Settlement & Chain Abstraction

Chain concerns are isolated behind gateways:

- escrow creation
- escrow release
- settlement query

## 3) Protocol-Critical Invariants

1. A task cannot skip lifecycle states.
2. Payment release requires verified completion.
3. Reputation mutation is bounded and explicit.
4. Matching obeys skill/distance/reputation/capacity constraints.
5. Event flow is append-only in logical progression.

## 4) Agent-Native Runtime Direction

PACT Core should evolve toward long-lived agent missions:

- mission context windows (not only stateless requests)
- conflict resolution among concurrent agents
- retries and compensating transitions for partial failures
- explicit machine-judgment evidence schema

## 5) Why API Is Not the Center

REST endpoints are currently a transport convenience.

The product center is the **protocol state graph + event semantics + incentive logic**.
Any transport (REST, MCP, queue, streaming) must map into the same invariant engine.
