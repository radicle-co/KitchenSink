# Architecture Decision Records (ADRs)

Durable records of significant, hard-to-reverse, or counter-intuitive decisions — the kind where the "why" must outlive the people and agents who made it.

**An ADR is the _destination_, not the trigger.** Agents and humans don't browse this directory unprompted. So every ADR that governs a piece of code must be paired with:

1. A short **(enforced)** pointer in `CLAUDE.md` (and the `AGENTS.md` manual-additions block) — the always-in-context tripwire.
2. **Co-located guard comments** at the exact code sites an agent would touch when undoing the decision (`// ⚠️ DELIBERATE — see docs/architecture/decisions/NNNN-…`).

Without those two layers the ADR is invisible at the moment it matters.

## What belongs in one, and what does not

An ADR records a DECISION, at a moment, with the reasoning that justified it. It is not the operational
memory of the system, and the difference is one line:

> A **consequence** is what follows from the decision and stays true while it stands.
> A **status** is what happens to be true today.
> ADRs record the first. The second belongs where it is CHECKED — CI, a guard test, or the code.

Three rules follow, and `packages/infra/global/__tests__/adrHygiene.test.ts` enforces them over every file
here, with no allowlist:

- **`Status` is one of `Proposed` / `Accepted` / `Deprecated` / `Superseded by NNNN`, and nothing else.**
  `Accepted` says the decision stands. It says nothing about whether the code exists — that is a question
  for the code.
- **A decision that changed is a NEW ADR that supersedes this one.** Striking a sentence out and writing the
  replacement beside it leaves a document stating both, and a reader who stops early reads the reversed one
  as current. ADR-0001's TITLE asserted the opposite of the decision in force for eight weeks that way.
- **No dated audit stamps** (`STALE (2026-09-04)`, `⛔ FALSE (…)`). A dated MEASUREMENT is fine and often
  necessary — "verified against primary AWS documentation on 2026-08-20" is provenance. What rots is the
  verdict stamped on the document by a later reading of reality.

⚠️ **Do not restate a number another authority owns.** Counts, priorities, rosters and derived figures have
gone stale in this corpus more often than prose claims have — an ALB priority table was wrong in both
directions at once, and a NAT consumer count was corrected three times, twice wrongly. Name the guard or the
generated table instead.

## Conventions

- Filename: `NNNN-kebab-title.md`, zero-padded, monotonically increasing.
- Keep the rationale and the **failure it prevents** explicit — an agent must be able to tell _why_ the obvious-looking alternative is wrong.

## Index

| ADR                                                                       | Decision                                                                                                                                                  | Status             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| [0001](0001-sandbox-front-end-addressing.md)                              | Sandbox front-end addressing: path-based PR routing, not per-PR subdomains                                                                                | Superseded by 0033 |
| [0002](0002-vpc-consolidation-and-cidr-scheme.md)                         | One VPC per stage with distinct CIDRs (prod 10.0.0.0/16, sandbox 10.1.0.0/16)                                                                             | Accepted           |
| [0003](0003-shared-alb-per-stage.md)                                      | One shared internet-facing ALB per stage, host-based routing per service                                                                                  | Accepted           |
| [0004](0004-minimize-nat-egress.md)                                       | Minimize NAT: one t4g.nano NAT instance, Fargate egress via the IGW                                                                                       | Accepted           |
| [0005](0005-environment-tagging-and-pr-cleanup.md)                        | `Environment` tagging + tag/name-driven per-PR teardown                                                                                                   | Accepted           |
| [0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md)          | Per-PR feature-service deploys: base-stage imports + per-PR logical database                                                                              | Accepted           |
| [0007](0007-sandbox-cost-controls.md)                                     | Sandbox cost controls: right-sizing + scheduled nightly shutdown                                                                                          | Accepted           |
| [0008](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md) | Additional cost levers: gp3 storage, Fargate Spot (non-prod), and budget guardrails                                                                       | Accepted           |
| [0009](0009-clerk-signout-load-gate.md)                                   | Sign-out goes through one command that verifies the session actually ended                                                                                | Accepted           |
| [0010](0010-ensure-exists-per-pr-deploy-gate.md)                          | Every PR preview is a COMPLETE ecosystem: the ensure-exists deploy gate                                                                                   | Accepted           |
| [0011](0011-api-version-prefix.md)                                        | Every HTTP endpoint is canonically `/api/{version}/*`, with the bare `/{version}/*` kept as a deprecated alias                                            | Accepted           |
| [0012](0012-mcp-agent-credential-bridge.md)                               | MCP agent credential bridge: Clerk proves identity, we own the grant                                                                                      | Accepted           |
| [0013](0013-cdk-nag-advisory-iac-security-linting.md)                     | cdk-nag on every CDK app, ADVISORY (warnings only), with a byte-identical-template guarantee                                                              | Accepted           |
| [0014](0014-service-owned-api-contracts.md)                               | The service authors its wire contract in zod; a generated `packages/schemas/<service>` package is the only thing clients import                           | Accepted           |
| [0015](0015-input-validation-at-every-boundary.md)                        | Input is parsed once at the boundary against the service's own zod; the database schema is the floor; response validation is deferred                     | Accepted           |
| [0016](0016-notification-retention-payload-dedup-and-valkey.md)           | A notification is retained until the client acks it or 3 days pass, deduplicated by canonical payload while pending, in ElastiCache Serverless for Valkey | Accepted           |
| [0017](0017-service-ownership-for-features-006-007-009-010.md)            | 007 and 009 land in the recipe service, 010 in the identity service, 006 in its own deployable; a new deployable is the exception, not the default        | Accepted           |
| [0018](0018-per-sender-webhook-dedup-tables.md)                           | Webhook delivery dedup is ONE TABLE PER SENDER: Stripe gets `stripe_webhook_events`, Clerk keeps `webhook_events`                                         | Accepted           |
| [0019](0019-recipe-import-spine.md)                                       | The recipe import spine: one bulk processor, source-typed channels, and status-shell placeholders                                                         | Accepted           |
| [0020](0020-cloudfront-edge-and-internal-alb-hostnames.md)                | Every production service sits behind CloudFront, and the ALB moves to an internal origin name                                                             | Accepted           |
| [0021](0021-deferred-recipe-nutrition.md)                                 | Recipe calories are fetched after the card, and a skeleton can never be permanent                                                                         | Accepted           |
| [0022](0022-in-stack-migration-trigger.md)                                | The schema migration runs INSIDE the deploy, ordered by a Trigger in every stack that touches the database                                                | Accepted           |
| [0023](0023-curator-declared-provenance.md)                               | A granted curator DECLARES `imported_public`; the corpus is fetched OUT OF BAND, never at runtime                                                         | Accepted           |
| [0024](0024-llm-spend-ceiling-reserve-then-settle.md)                     | The LLM spend ceiling is enforced by a RESERVE-THEN-SETTLE counter in our own code; no AWS mechanism can gate it                                          | Accepted           |
| [0025](0025-ingredient-parser-python-deployable.md)                       | The CRF ingredient parser is a Python deployable of its own, with a second runtime pin and its own packaging guard                                        | Accepted           |
| [0026](0026-two-engine-ingredient-parse-pipeline.md)                      | An ingredient line is parsed by two engines that cannot see each other, and a comparator adjudicates                                                      | Accepted           |
| [0027](0027-ingredient-phrase-is-not-personal-data.md)                    | An ingredient phrase is NOT personal data; the user id beside it is a DISTINCT-USER COUNTER                                                               | Accepted           |
| [0028](0028-on-demand-sandbox.md)                                         | On-demand sandboxes: a button in GitHub, and midnight teardown                                                                                            | Accepted           |
| [0029](0029-authored-foods-substances-only.md)                            | Authored foods: the substances-only amendment to the single-writer rule                                                                                   | Accepted           |
| [0030](0030-first-party-analytics-events.md)                              | First-party analytics events: one store, two doors, lifetime counts                                                                                       | Accepted           |
| [0031](0031-sandbox-only-per-pr-database-reaper.md)                       | The per-PR database reaper is a sandbox-only capability that counts before it reclaims                                                                    | Accepted           |
| [0032](0032-deployed-ecosystem-test-tier.md)                              | A test that boots its own backend is not an end-to-end test: the deployed-ecosystem tier                                                                  | Accepted           |
| [0033](0033-sandbox-previews-on-per-pr-subdomains.md)                     | Sandbox previews are addressed by per-PR subdomain, resolved directly to Vercel                                                                           | Accepted           |
| [0034](0034-recipe-save-and-version-row-are-atomic.md)                    | A recipe save and its version row are one transaction                                                                                                     | Accepted           |
