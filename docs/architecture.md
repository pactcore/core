# Architecture Design

## Layer Model

PACT Core follows a layered design:

1. **Application Layer**
2. **Infrastructure Layer**
3. **Blockchain Abstraction Layer**

Application services depend on contracts (interfaces), not concrete implementations.

## Event-Driven Orchestration

Core domain events:

- `task.created`
- `task.assigned`
- `task.submitted`
- `task.verified`
- `task.completed`
- `task.validation_failed`

Execution flow:

1. `task.submitted` triggers three-layer validation (`ValidatorConsensus`).
2. If validation passes, state moves to `Verified` and emits `task.verified`.
3. `task.verified` triggers payout settlement (`PactPay`) and escrow release.
4. After settlement, state moves to `Completed`.

## Blockchain Abstraction

`BlockchainGateway` abstracts chain interaction:

- `createEscrow(taskId, payerId, amountCents)`
- `releaseEscrow(taskId, payouts)`
- `getEscrow(taskId)`

Current adapter is `InMemoryBaseChainGateway`. It can be replaced by a real Base-chain contract gateway later.

## Infrastructure Components

- **Task Manager**: lifecycle state transitions and persistence orchestration
- **Validator Consensus**: three-layer validation decision engine
- **Reputation Service**: score query and mutation (0-100)
- **Scheduler**: compute job scheduling and due execution
- **X402 Payment Adapter**: transfer recording and payment abstraction
- **Event Bus**: in-process pub/sub for orchestration
