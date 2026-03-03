# Architecture Design

## Layering

1. Application Layer
2. Infrastructure Layer
3. Blockchain Abstraction Layer

应用层通过服务接口依赖基础设施层，不直接依赖具体链实现。

## Event-Driven Orchestration

核心事件：

- `task.created`
- `task.assigned`
- `task.submitted`
- `task.verified`
- `task.completed`
- `task.validation_failed`

编排流：

1. `task.submitted` 触发 ValidatorConsensus 三层验证
2. 验证通过后转 `Verified` 并发出 `task.verified`
3. `task.verified` 触发 PactPay 分账与 escrow release
4. 完成结算后任务状态转为 `Completed`

## Blockchain Abstraction

`BlockchainGateway` 抽象链交互：

- `createEscrow(taskId, payerId, amountCents)`
- `releaseEscrow(taskId, payouts)`
- `getEscrow(taskId)`

当前实现为 `InMemoryBaseChainGateway`，后续可替换为 Base 链合约网关。

## Infrastructure Components

- Task Manager: 生命周期状态管理与存储编排
- Validator Consensus: 三层验证决策器
- Reputation: 0-100 评分与增减
- Scheduler: 计算任务调度
- X402 Adapter: 支付抽象与账本记录
- Event Bus: 进程内订阅/发布
