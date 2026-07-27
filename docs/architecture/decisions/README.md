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
- [0002 — One VPC per stage with distinct CIDRs (prod 10.0.0.0/16, sandbox 10.1.0.0/16)](0002-vpc-consolidation-and-cidr-scheme.md)
- [0003 — One shared internet-facing ALB per stage, host-based routing per service](0003-shared-alb-per-stage.md)
- [0004 — Minimize NAT: one t4g.nano NAT instance, Fargate egress via the IGW](0004-minimize-nat-egress.md)
- [0005 — `Environment` tagging + tag/name-driven per-PR teardown](0005-environment-tagging-and-pr-cleanup.md)
- [0006 — Per-PR feature-service deploys: base-stage imports + per-PR logical database](0006-per-pr-feature-deploys-base-stage-and-logical-db.md)
- [0007 — Sandbox cost controls: right-sizing + scheduled nightly shutdown](0007-sandbox-cost-controls.md)
- [0008 — Additional cost levers: gp3 storage, Fargate Spot (non-prod), and budget guardrails](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md)
- [0009 — Sign-out goes through one command that verifies the session actually ended](0009-clerk-signout-load-gate.md)
