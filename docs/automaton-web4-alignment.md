# Automaton + Web4 Alignment (PACT Perspective)

This note clarifies what PACT adopts from external autonomous-agent narratives and what remains constrained by protocol governance.

## Adopted Patterns

### 1) Continuous Agent Loop

Inspired by Think/Act/Observe loops in autonomous runtimes.
PACT interpretation:

- mission claim/execution/evidence/verdict loops
- explicit event boundaries
- replayable traces

### 2) Heartbeat/Supervisor Model

Inspired by always-on runtime supervision.
PACT interpretation:

- scheduler + heartbeat hooks for periodic checks
- health and policy checks separated from mission execution

### 3) Agent-Native Economic Framing (Web4 Direction)

Inspired by Web4 framing of machine actors participating in digital economies.
PACT interpretation:

- machine-verifiable work
- programmable settlement
- protocol-level trust constraints

## Explicit Non-Goals

PACT does **not** assume unrestricted autonomy.
Current architectural stance excludes:

- unbounded self-replication
- unrestricted external side effects
- opaque off-protocol economic decisions

## Governance-First Principle

External inspiration informs runtime ergonomics.
The whitepaper and protocol invariants remain the source of truth.

In short:

- inspiration source: agent systems and Web4 narratives
- execution standard: PACT whitepaper + protocol governance
