# Agent-Native Architecture (PACT Core)

## A. Runtime Primitives

1. **Participant Identity** (human or agent)
2. **Mission Envelope** (objective, constraints, budget, compensation model)
3. **Execution Step** (action-level trace)
4. **Evidence Bundle** (artifacts + hash + provenance)
5. **Verdict** (approval + confidence)
6. **Challenge** (escalation object)
7. **Settlement Outcome** (multi-asset compensation realization)

## B. Multi-Actor Patterns

### Pattern 1: Worker Agent + Validator Ring

- issuer publishes mission
- worker agent executes and submits evidence
- validator ring reviews confidence
- jury resolves escalations when triggered

### Pattern 2: Human-Agent Co-Execution

- human contributor handles exception/edge tasks
- agent handles scalable execution steps
- both receive compensation legs in final settlement graph

### Pattern 3: Service-Credit Missions

- output is compensated by API quota or cloud credits instead of only stablecoins
- useful for infrastructure-heavy agent workflows

## C. Capability and Safety Model

- role-scoped permissions
- policy checks before side effects
- bounded retries
- explicit challenge paths
- event-backed auditability

## D. Product Focus

Design for:

- mission throughput
- evidence quality
- escalation latency
- fairness of compensation distribution
- resilience under adversarial behavior

## E. Implementation Status (Current)

Implemented in runtime:

- mission envelope and lifecycle
- inbox/outbox + event journal replay
- capability policy checks
- challenge/escalation and jury resolution
- heartbeat supervision hooks
- multi-asset compensation model primitives
