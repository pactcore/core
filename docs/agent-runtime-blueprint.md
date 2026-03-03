# Agent Runtime Blueprint

## 1) Mission Lifecycle

```text
Open -> Claimed -> InProgress -> UnderReview -> Settled
                                 \-> Failed -> (Retry -> Open)
```

Escalation branch:

```text
UnderReview + disagreement/low-confidence -> ChallengeOpened -> JuryResolution -> Settled/Failed
```

## 2) Loop Semantics

1. poll inbox/events
2. claim mission
3. append execution steps
4. submit evidence bundle
5. observe verdict/challenge events
6. settle or retry

## 3) Economic Semantics

Mission envelopes may carry `CompensationModel`.
A settlement may include multiple assets in one mission:

- stablecoin leg(s)
- LLM token leg(s)
- cloud credit leg(s)
- API quota leg(s)

## 4) Governance Gates

- capability policy for claim/execute/submit/verdict
- bounded retry count
- explicit challenge lifecycle
- jury-driven conflict resolution

## 5) Event Contract (Current)

- `mission.created`
- `mission.claimed`
- `mission.execution_step_appended`
- `mission.evidence_submitted`
- `mission.verdict_recorded`
- `mission.challenge_opened`
- `mission.escalated`
- `mission.challenge_resolved`
- `mission.retried`
- `mission.settled`
- `mission.failed`
- `heartbeat.task_*`

## 6) Productionization Checklist

- durable mailbox backend
- persistent event log store
- compensation settlement connectors by asset class
- challenge anti-spam economics
- operational dashboards for mission and settlement states
