# Domain Model

## Entities

### Task

- `id`
- `issuerId`
- `assigneeId`
- `paymentCents`
- `constraints`
- `status`
- `evidence`
- `validatorIds`

### MissionEnvelope

- `id`
- `issuerId`
- `claimedBy`
- `status`
- `context`
- `executionSteps`
- `evidenceBundles`
- `verdicts`
- `challenges`
- `retryCount` / `maxRetries`
- `compensationModel` (optional multi-asset settlement graph)

### WorkerProfile

- `skills`
- `location`
- `reputation`
- `capacity`
- `activeTaskIds`

### ReputationRecord

- `participantId`
- `role`
- `score` (0-100)

### CompensationModel

- `mode`: `single_asset` or `multi_asset`
- `legs[]`: payer/payee/asset/amount/unit
- supports assets like stablecoin, LLM tokens, cloud credits, API quotas

## Lifecycle State Machines

### Task

`Created -> Assigned -> Submitted -> Verified -> Completed`

### Mission

`Open -> Claimed -> InProgress -> UnderReview -> Settled/Failed`

Retry path:

`Failed -> Open` (bounded by `maxRetries`)

Escalation path:

`UnderReview + challenge -> Jury resolution -> Settled/Failed`

## Validation Pipeline

Three sequential layers:

1. Auto AI
2. Agent Validators
3. Human Jury

Config fields:

- `enabled`
- `passThreshold`
- `requiredParticipants`

## Matching Model

Constraints:

- skill fit
- distance bound
- reputation bound
- capacity bound

After filtering, a Gale-Shapley variant computes stable assignments.

## Settlement Semantics

Task-level split (current default):

- 85% Worker
- 5% Validators
- 5% Treasury
- 5% Issuer

Mission-level settlement can additionally use multi-asset compensation legs.
