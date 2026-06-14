# Architecture Decision Records (ADRs)

Durable records of significant, hard-to-reverse, or counter-intuitive decisions — the kind where the "why" must outlive the people and agents who made it.

**An ADR is the _destination_, not the trigger.** Agents and humans don't browse this directory unprompted. So every ADR that governs a piece of code must be paired with:

1. A short **(enforced)** pointer in `CLAUDE.md` (and the `AGENTS.md` manual-additions block) — the always-in-context tripwire.
2. **Co-located guard comments** at the exact code sites an agent would touch when undoing the decision (`// ⚠️ DELIBERATE — see docs/architecture/decisions/NNNN-…`).

Without those two layers the ADR is invisible at the moment it matters.

## Conventions

- Filename: `NNNN-kebab-title.md`, zero-padded, monotonically increasing.
- Status: `Proposed` → `Accepted` → (`Superseded by NNNN` | `Deprecated`).
- Keep the rationale and the **failure it prevents** explicit — an agent must be able to tell _why_ the obvious-looking alternative is wrong.

## Index

- [0001 — Sandbox front-end addressing (path routing + Clerk azp)](0001-sandbox-front-end-addressing.md)
