# Agent-Native Architecture (PACT Core)

## A. Runtime Primitives

PACT should expose these primitives as first-class protocol concepts:

1. **Agent Identity**
   - role, capabilities, trust level, operator metadata
2. **Mission**
   - objective, constraints, budget, deadline, escalation policy
3. **Execution Step**
   - tool call, artifact creation, evidence output
4. **Evidence Bundle**
   - hashes, provenance, signatures, validator annotations
5. **Verdict**
   - confidence, disagreement set, appeal route
6. **Settlement Outcome**
   - final payouts + reputation deltas

## B. Multi-Agent Patterns

### Pattern 1: Single Worker + Validator Ring

- Issuer creates mission
- Worker agent executes and submits evidence
- Validator ring scores confidence and detects anomalies
- Human jury only activates on disagreement threshold

### Pattern 2: Specialist Swarm

- Mission decomposes into subtasks (data, compute, verification)
- Different agents claim subtasks based on capability profile
- Aggregator agent composes final artifact
- Protocol validates composition integrity before settlement

### Pattern 3: Continuous Monitoring Agent

- Long-running agent audits previously completed missions
- Emits challenge events when drift/fraud signals emerge
- Triggers re-validation or slashing workflows (future phase)

## C. Capability and Safety Model

For agent-native software, capability control is mandatory:

- scoped permissions per role and mission
- policy checks before side-effectful actions
- immutable evidence trail for all state-affecting actions
- bounded autonomous retries to avoid runaway loops

## D. Product Focus Shift

Do not design around endpoint count.
Design around:

- mission throughput
- evidence quality
- dispute resolution latency
- economic fairness
- robustness under adversarial behavior

## E. Near-Term Implementation Targets

1. Agent mission envelope type in domain layer
2. Event contract for inbox/outbox and subscription cursors
3. Capability policy contract per role
4. Evidence schema normalization for machine validation
5. Replayable execution journal for audit and learning
