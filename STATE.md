# STATE.md

## Repo

- Repository: `pact-network-core-bun`
- Current branch: `main`
- Baseline head before finishing this slice: `66a01df`

## In-Progress Files

- `src/api/app.ts`
- `src/application/container.ts`
- `src/application/modules/pact-disputes.ts`
- `src/application/modules/pact-missions.ts`
- `src/application/modules/pact-committee.ts`
- `src/domain/dispute-resolution.ts`
- `src/domain/types.ts`
- `src/domain/validation-pipeline.ts`
- `src/index.ts`
- `tests/analytics.test.ts`
- `tests/dispute-resolution.test.ts`
- `tests/integration-sweep.test.ts`
- `tests/validation-pipeline.test.ts`

## What Already Changed

- disputes now require terminal mission states before opening
- dispute records carry richer metadata and bond/expiry fields
- validation pipeline now includes `CommitteeReview`
- a new committee module exists but still needs final stabilization through test coverage
- some tests were already updated to move missions into valid terminal states before disputes

## Latest Validation Snapshot

- Full suite: **461 pass / 0 fail** (branch: feat/whitepaper-review-selection-sync, head: 865ca18)
- New test files: `tests/committee-weights.test.ts` (12 tests), `tests/validation-escalation.test.ts` (8 tests)

## What Changed in This Slice

1. **Committee selection audit snapshots** — `CommitteeSelectionAudit` + `CommitteeSelectionAuditEntry` types; `selectionAudit` field on `CommitteeReview` populated at configure time with per-validator state snapshot and `candidateCount`.

2. **Appeal/no-show weighting** — `ValidatorAccount` gains `appealOutcomes` and `noShowCount`; `computeValidatorWeight` applies `max(0.1, 1 - appeals*0.1 - noShows*0.05)` multiplier; `finalizeCommittee` increments `noShowCount` on deadline path; `recordAppealOutcome(missionId)` increments `appealOutcomes` for validators on overturned side.

3. **Layered escalation metadata** — `ValidationOutcome` gains `escalations: EscalationMetadata[]`; `ValidationStepResult` gains `escalatedFrom?`; pipeline populates these on every AutoAI→Committee and Committee→HumanJury transition.

4. **Committee API routes** — 8 new routes in `app.ts`; `getRequiredStringField` helper added.

## Next Step

Phase 3: SDK sync — propagate the stabilized committee/dispute/validation surface into `pact-sdk`.
