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

## Lifecycle State Machine

Fixed ordered states:

`Created -> Assigned -> Submitted -> Verified -> Completed`

Skipping, rolling back, or repeating invalid transitions throws `IllegalStateTransitionError`.

## Validation Pipeline

Three sequential layers:

1. Auto AI
2. Agent Validators
3. Human Jury

Config fields:

- `enabled`
- `passThreshold`
- `requiredParticipants` (for validator and jury layers)

## Matching Model

Constraints:

- Skill fit: `requiredSkills ⊆ worker.skills`
- Distance bound: `distance <= maxDistanceKm`
- Reputation bound: `worker.reputation >= minReputation`
- Capacity bound: `activeTaskIds < capacity`

After filtering, a Gale-Shapley variant computes stable assignments.

## Payment Split

On successful task completion:

- 85% to Worker
- 5% to Validators
- 5% to Treasury
- 5% to Issuer

Total amount is preserved; rounding dust is allocated to Treasury.
