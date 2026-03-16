---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tests/integration-sweep.test.ts
autonomous: true
requirements: [ERC-8183-CORE-ALIGNMENT]

must_haves:
  truths:
    - "All 10 integration-sweep tests pass"
    - "Dispute jury voting succeeds within a controllable clock window"
    - "Domain rules (expiry enforcement, terminal-state gating) remain unchanged"
  artifacts:
    - path: "tests/integration-sweep.test.ts"
      provides: "Fixed createFixture with clock-aware PactDisputes and realistic voting period"
      contains: "now: clock.now"
  key_links:
    - from: "tests/integration-sweep.test.ts (createFixture)"
      to: "PactDisputes constructor options"
      via: "now: clock.now passed in options object"
      pattern: "now:\\s*clock\\.now"
---

<objective>
Fix the 2 remaining failing tests in tests/integration-sweep.test.ts by correcting the test fixture's PactDisputes configuration.

Purpose: The dispute/jury integration tests fail because PactDisputes is constructed with votingPeriodMs: 0 and no controllable clock, causing votes to expire instantly. The fixture already creates a controllable clock but only passes it to pactAntiSpam. This plan passes the clock to PactDisputes and sets a realistic voting period so castJuryVote succeeds within the test's time window. No domain code changes -- only fixture configuration.

Output: Full green test suite (441 pass + the 2 previously failing = 443 pass, 0 fail)
</objective>

<execution_context>
@/root/.openclaw/workspace/pact-network-core-bun/.claude/get-shit-done/workflows/execute-plan.md
@/root/.openclaw/workspace/pact-network-core-bun/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@tests/integration-sweep.test.ts
@src/application/modules/pact-disputes.ts
@.planning/STATE.md

<interfaces>
<!-- From src/application/modules/pact-disputes.ts -->
```typescript
export interface PactDisputesOptions {
  config?: Partial<DisputeConfig>;
  now?: () => number;
}

export class PactDisputes {
  constructor(
    disputeRepository: DisputeRepository,
    missionRepository: MissionRepository,
    participantRepository: ParticipantRepository,
    reputationRepository: ReputationRepository,
    eventBus: EventBus,
    options: PactDisputesOptions = {},
  )
}
```

<!-- PactDisputesOptions already supports `now?: () => number` -->
<!-- The fixture's `createClock()` returns an object with `.now` method matching this signature -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix PactDisputes fixture configuration in integration-sweep tests</name>
  <files>tests/integration-sweep.test.ts</files>
  <action>
In the `createFixture()` function (around line 207-221), make two changes to the PactDisputes constructor call:

1. Pass the controllable clock: Add `now: clock.now` to the options object. The clock is already created at line 136 (`const clock = createClock()`) and used by pactAntiSpam. PactDisputesOptions already accepts `now?: () => number`.

2. Set a realistic voting period: Change `votingPeriodMs: 0` to `votingPeriodMs: 3_600_000` (1 hour). This gives the test's controllable clock a real window for jury voting. The clock does not advance between operations so votes always land within the window.

The `evidencePeriodMs: 0` can remain as-is because `closeEvidencePeriod()` is called explicitly in tests without checking period expiry.

The resulting options block should look like:
```typescript
{
  config: {
    jurySize: 3,
    votingPeriodMs: 3_600_000,
    evidencePeriodMs: 0,
    minJuryReputation: 60,
  },
  now: clock.now,
}
```

IMPORTANT: Do NOT modify any domain code in src/. Only the test fixture in tests/integration-sweep.test.ts changes. Per CLAUDE.md: "Do not fix tests by weakening the domain rules."
  </action>
  <verify>
    <automated>cd /root/.openclaw/workspace/pact-network-core-bun && bun test tests/integration-sweep.test.ts</automated>
  </verify>
  <done>All 10 tests in integration-sweep.test.ts pass (0 fail). The two dispute/jury tests ("applies positive/negative reputation impact after an upheld dispute" and "keeps dispute reputation neutral on split jury outcomes") no longer throw "expired due to jury inactivity".</done>
</task>

<task type="auto">
  <name>Task 2: Validate full test suite passes</name>
  <files>tests/integration-sweep.test.ts</files>
  <action>
Run the complete test suite with `bun test` to confirm:
- All previously passing 441 tests still pass
- The 2 previously failing tests now pass
- Total: 443 pass, 0 fail

If any unrelated test regresses, investigate but do NOT modify domain code. The fixture change is scoped to createFixture() which is only used within integration-sweep.test.ts, so regressions are not expected.

After confirming green suite, update .planning/STATE.md:
- Change "Latest Validation Snapshot" to reflect 443 pass / 0 fail
- Change "Next Step" to indicate the ERC-8183 core alignment slice is complete
  </action>
  <verify>
    <automated>cd /root/.openclaw/workspace/pact-network-core-bun && bun test 2>&1 | tail -5</automated>
  </verify>
  <done>Full test suite is green (0 failures). STATE.md updated to reflect completion.</done>
</task>

</tasks>

<verification>
- `bun test tests/integration-sweep.test.ts` shows 10 pass, 0 fail
- `bun test` shows 0 fail across all test files
- No changes to any file under `src/` (domain code untouched)
- The fix only adds `now: clock.now` and changes `votingPeriodMs` from 0 to 3_600_000
</verification>

<success_criteria>
- Full test suite passes with 0 failures
- Domain rules (expiry enforcement, terminal-state gating, committee review) remain intact
- STATE.md reflects the completed status
</success_criteria>

<output>
After completion, create `.planning/quick/260316-dop-finish-erc-8183-core-alignment-fix-faili/260316-dop-SUMMARY.md`
</output>
