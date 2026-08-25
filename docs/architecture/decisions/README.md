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
- [0010 — Every PR preview is a complete ecosystem: the ensure-exists deploy gate](0010-ensure-exists-per-pr-deploy-gate.md)
- [0011 — Canonical `/api/{version}/*` endpoints, bare `/{version}/*` kept as a deprecated alias](0011-api-version-prefix.md)
- [0012 — MCP agent credential bridge: Clerk proves identity, we own the grant](0012-mcp-agent-credential-bridge.md)
- [0013 — cdk-nag on every CDK app, ADVISORY, with a byte-identical-template guarantee](0013-cdk-nag-advisory-iac-security-linting.md)
- [0014 — The service authors its wire contract in zod; clients import only `packages/schemas/<service>`](0014-service-owned-api-contracts.md)
- [0015 — Input is parsed once at the boundary against the service's own zod; the DB schema is the floor; response validation deferred](0015-input-validation-at-every-boundary.md)
- [0016 — A notification is retained until acked or 3 days, deduplicated by canonical payload while pending, in ElastiCache Serverless for Valkey](0016-notification-retention-payload-dedup-and-valkey.md)
- [0017 — Features 006/007/009 land in the recipe service, 010 in the identity service; no new deployable](0017-service-ownership-for-features-006-007-009-010.md)
- [0018 — Webhook delivery dedup is one table per sender: Stripe gets `stripe_webhook_events`, Clerk keeps `webhook_events`](0018-per-sender-webhook-dedup-tables.md)
- [0019 — The recipe import spine: one bulk processor, source-typed channels, and status-shell placeholders](0019-recipe-import-spine.md)
- [0020 — Every production service sits behind CloudFront, and the ALB moves to an internal origin name](0020-cloudfront-edge-and-internal-alb-hostnames.md)
- [0021 — Recipe calories are fetched after the card, and a skeleton can never be permanent](0021-deferred-recipe-nutrition.md)
- [0022 — The schema migration runs inside the deploy, ordered by a Trigger in every stack that touches the database](0022-in-stack-migration-trigger.md)
- [0023 — A granted curator declares `imported_public`; the public-domain corpus is fetched out of band](0023-curator-declared-provenance.md)
- [0024 — The LLM spend ceiling is enforced by a reserve-then-settle counter in our own code; no AWS mechanism can gate it](0024-llm-spend-ceiling-reserve-then-settle.md)
- [0025 — The CRF ingredient parser is a Python deployable of its own, with a second runtime pin and its own packaging guard](0025-ingredient-parser-python-deployable.md)
- [0026 — An ingredient line is parsed by two engines that cannot see each other, and a comparator adjudicates](0026-two-engine-ingredient-parse-pipeline.md)
