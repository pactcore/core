# Domain Model

## Entities

## Task
- id
- issuerId
- assigneeId
- paymentCents
- constraints
- status
- evidence
- validatorIds

## WorkerProfile
- skills
- location
- reputation
- capacity
- activeTaskIds

## ReputationRecord
- participantId
- role
- score (0-100)

## Lifecycle State Machine

固定有序状态：

`Created -> Assigned -> Submitted -> Verified -> Completed`

任意跳跃、回退、重复推进都会抛出 `IllegalStateTransitionError`。

## Validation Pipeline

三层顺序：

1. Auto AI
2. Agent Validators
3. Human Jury

配置项：

- `enabled`
- `passThreshold`
- `requiredParticipants`（后两层）

## Matching Model

约束过滤条件：

- 技能匹配：`requiredSkills ⊆ worker.skills`
- 距离约束：`distance <= maxDistanceKm`
- 信誉约束：`worker.reputation >= minReputation`
- 容量约束：`activeTaskIds < capacity`

通过过滤后采用 Gale-Shapley 变体稳定匹配。

## Payment Split

任务完成后固定分账：

- 85% Worker
- 5% Validators
- 5% Treasury
- 5% Issuer

总额守恒，余数 dust 自动并入 Treasury。
