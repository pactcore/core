# ROADMAP.md

## Phase 1 - Stabilize the Active Core Slice

Goal: get the current ERC-8183 core alignment work fully green.

Tasks:
- inspect the remaining failing integration-sweep dispute/jury tests
- fix tests and/or lifecycle wiring without weakening domain constraints
- run full `bun test`
- commit the finished core slice

## Phase 2 - Close Core/Contracts Gaps

Goal: make core semantics line up better with the now-advanced contracts layer.

Focus areas:
- committee evaluator semantics
- dispute liveness / expiry / resolution hooks
- settlement/accounting semantics where core mirrors contract outcomes
- API/container wiring and exports

## Phase 3 - SDK Sync

Goal: propagate the newly stabilized core surface into `pact-sdk`.

Focus areas:
- typed client surface for committee/jury/dispute APIs
- parity tests against core routes/types
- keep SDK Bun/TS test suite green

## Phase 4 - Final ERC-8183 Gap Review

Goal: identify what is still missing vs the whitepaper after contracts/core/sdk converge.

Focus areas:
- explicit traceability gaps
- production-hardening gaps
- any remaining committee/jury/slashing semantics not yet reflected outside contracts
