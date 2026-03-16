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

- `tests/dispute-resolution.test.ts` was repaired and passed in targeted validation
- `tests/analytics.test.ts` was repaired and passed in targeted validation
- full suite reached `441 pass / 2 fail`
- remaining failures are both in `tests/integration-sweep.test.ts`

## Next Step

Repair the remaining integration-sweep dispute/jury flows so they respect the new expiry-aware lifecycle, then rerun full `bun test` and commit.
