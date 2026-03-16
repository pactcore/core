---
phase: quick
plan: 260316-dop
subsystem: testing
tags: [dispute-resolution, jury-voting, integration-tests, clock, erc-8183]

requires: []
provides:
  - "Full green test suite: 443 pass / 0 fail"
  - "Clock-aware PactDisputes fixture in integration-sweep tests"
  - "Correct split verdict logic when jury votes are tied"
affects: [dispute-resolution, integration-testing]

tech-stack:
  added: []
  patterns:
    - "Controllable clock passed to PactDisputes via options.now to enable expiry-aware testing"
    - "Split verdict produced when upholdVotes === rejectVotes (tie)"

key-files:
  created: []
  modified:
    - "tests/integration-sweep.test.ts"
    - "src/application/modules/pact-disputes.ts"

key-decisions:
  - "Pass clock.now to PactDisputes in test fixture so domain expiry checks use controllable time"
  - "Use votingPeriodMs: 3_600_000 (1 hour) so votes always land inside the window when clock does not advance"
  - "Fix computeVerdict() to return 'split' on tied votes - DisputeVerdict type already declared it valid"

patterns-established:
  - "Always wire controllable clock to all time-sensitive modules in integration fixtures"

requirements-completed: [ERC-8183-CORE-ALIGNMENT]

duration: 8min
completed: 2026-03-16
---

# Quick Task 260316-dop: Finish ERC-8183 Core Alignment - Fix Failing Integration Tests

**Clock-aware PactDisputes fixture and split verdict implementation to achieve 443 pass / 0 fail**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-16T00:00:00Z
- **Completed:** 2026-03-16T00:08:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Wired controllable clock (`clock.now`) to PactDisputes constructor in `createFixture()` so voting expiry checks use test time rather than `Date.now`
- Changed `votingPeriodMs` from `0` to `3_600_000` giving jury votes a real 1-hour window without advancing the clock between operations
- Fixed `computeVerdict()` in `pact-disputes.ts` to return `"split"` when uphold and reject vote counts are equal (the domain type already declared `"split"` as valid but the implementation never produced it)
- Full test suite: 443 pass, 0 fail

## Task Commits

1. **Task 1: Fix PactDisputes fixture configuration and split verdict logic** - `a844f52` (fix)
2. **Task 2: Update STATE.md to reflect 443 pass / 0 fail** - `eff2d51` (chore)

## Files Created/Modified

- `tests/integration-sweep.test.ts` - Added `now: clock.now` to PactDisputes options; changed `votingPeriodMs` from 0 to 3_600_000
- `src/application/modules/pact-disputes.ts` - Fixed `computeVerdict()` to return `"split"` on tied votes
- `.planning/STATE.md` - Updated validation snapshot to 443 pass / 0 fail, marked slice complete

## Decisions Made

- Fixed the split verdict bug in domain application code rather than in test fixtures, because the `DisputeVerdict` type already declares `"split"` as valid and the test expectation is semantically correct (tied vote = split outcome). This is a bug fix, not a test weakening.
- Used `votingPeriodMs: 3_600_000` rather than a smaller value because the clock does not advance between test operations; any positive value would work, but 1 hour is semantically meaningful.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing "split" verdict in computeVerdict()**
- **Found during:** Task 1 (after initial fixture clock fix, 1 test still failing)
- **Issue:** `computeVerdict()` only produced "upheld" or "rejected". When uphold and reject vote counts were equal, it returned "rejected" instead of "split". The `DisputeVerdict` type at `src/domain/dispute-resolution.ts:119` declares `"upheld" | "rejected" | "split"` as valid outcomes.
- **Fix:** Added a ternary branch: `upholdVoters.length > rejectVoters.length ? "upheld" : upholdVoters.length < rejectVoters.length ? "rejected" : "split"`
- **Files modified:** `src/application/modules/pact-disputes.ts`
- **Verification:** `bun test tests/integration-sweep.test.ts` shows 10 pass / 0 fail
- **Committed in:** `a844f52` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** The fixture clock fix alone was insufficient; the split verdict bug was the root cause of the second failure. Auto-fix was necessary for domain correctness and did not weaken any domain rules.

## Issues Encountered

The plan anticipated only the fixture clock misconfiguration as the root cause. The second failing test ("keeps dispute reputation neutral on split jury outcomes") had an additional cause: `computeVerdict()` never produced `"split"`. After the clock fix, 9/10 tests passed; the split verdict fix resolved the final failure.

## Next Phase Readiness

- ERC-8183 core alignment slice is fully complete
- All 443 tests green with domain rules intact (expiry enforcement, terminal-state gating, CommitteeReview)
- No further work required on this slice

---
*Phase: quick*
*Completed: 2026-03-16*
