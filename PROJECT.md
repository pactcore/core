# PROJECT.md

## Project

ERC-8183 alignment for `pact-network-core-bun`.

This repo is the core service/application layer that must catch up to the already-advanced contracts layer. The work should follow the whitepaper and the established layering:

1. contracts
2. core
3. sdk

Contracts already moved ahead with committee evaluation, human jury resolution, dispute liveness, settlement split semantics, and validator reputation/stake handling. Core now needs equivalent domain/application support so the rest of the stack can converge.

## Immediate Goal

Finish the current in-progress core slice without backing out the stricter ERC-8183 rules:

- disputes can only be opened from terminal mission states
- dispute lifecycle includes evidence/voting expiry
- committee review is a first-class validation layer between AutoAI and HumanJury

## Current Status

The repo already contains in-progress local work toward this goal. Do not throw it away unless it is clearly wrong.

Current modified files include:

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

Recent local validation reached 441/443 passing tests. The remaining failures are concentrated in dispute/jury expiry behavior in `tests/integration-sweep.test.ts`.

## Success Criteria

- `bun test` passes fully
- the new ERC-8183 constraints remain enforced
- tests are updated to match the stricter domain rules instead of weakening the domain model
- code remains Bun-first, TypeScript-only, and consistent with existing repo style
- once core is green and committed, the next handoff is SDK alignment in `pact-sdk`
