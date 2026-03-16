# REQUIREMENTS.md

## Non-Negotiable Product Rules

- Follow the whitepaper direction already expressed in contracts.
- Keep the layering order: contracts -> core -> sdk.
- Do not regress core back to the older looser dispute model just to make tests pass.
- Treat committee review as a distinct layer, not just a rename of generic validators.
- Disputes should open only from terminal mission states.
- Preserve dispute bond, metadata, expiry, and explicit status handling.
- Preserve support for HumanJury as a later/final review layer.

## Engineering Rules

- Use Bun, not npm/yarn/pnpm.
- Validate with `bun test`; use `bun run typecheck` only if needed after tests are green.
- Prefer targeted, minimal fixes over broad rewrites.
- Update tests to reflect valid mission/dispute lifecycle transitions.
- Keep public/API naming aligned with ERC-8183 concepts where practical.
- Keep comments/docstrings short and only where they clarify non-obvious logic.

## Current Known Failing Area

The remaining failures are integration-sweep dispute tests that still assume the pre-ERC behavior. The code now includes:

- terminal-only dispute opening
- evidence/voting deadlines
- expiry for inactive jury flows

The tests should drive a mission into a valid terminal state before opening a dispute, and any jury-vote flow must respect the updated lifecycle.

## Done Definition

- `bun test` = fully green
- no accidental rollback of ERC-8183 rules
- clean, reviewable commit(s)
- clear state note for the next repo (SDK)
