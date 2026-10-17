---
applyTo: 'packages/infra/**,packages/services/*/infra/**'
---

# Reviewing infrastructure code (AWS CDK)

These paths own the VPC, IAM, RDS, S3, SQS, the shared ALB and NAT. Blast radius is the whole platform,
and several choices here look like bugs but are load-bearing. Copilot cannot follow links out of this
file, so the rulings are inlined; the authoritative reasoning is in `docs/architecture/decisions/`.

## Do not advise reverting these

- **One shared ALB per stage (ADR-0003).** Services do **not** own an ALB. Each imports the shared HTTPS
  listener and adds an `ApplicationListenerRule` — identity 100, food 200, recipe 300 — plus an A-record
  aliased to the shared ALB. Priorities must be unique across the listener. Unmatched hosts hit a default
  fixed-response 404. Do not suggest giving a service its own load balancer "for isolation", and do not
  reuse a priority. The global ALB stack must deploy before the services (cross-stack listener-ARN import).
- **NAT is a `t4g.nano` EC2 instance, not a managed NAT Gateway (ADR-0004).** This is deliberate and saves
  ~10×. Only the four DB-bound webhook Lambdas use it, and they are VPC-attached solely to reach the
  private RDS. Do not propose "upgrading" to a NAT Gateway, do not move those Lambdas out of the VPC, and
  do not claim `assignPublicIp` would give them egress — that works for Fargate only, not VPC Lambdas. The
  NAT instance SG is intentionally scoped to the VPC CIDR rather than `0.0.0.0/0`.
- **Per-stage VPC CIDRs; prod is 10.0.0.0/16 (ADR-0002).** Prod's explicit value equals the historical CDK
  default _on purpose_, so it synthesizes no diff. It is not redundant. Changing the prod CIDR — or any
  construct ID that feeds the VPC — replaces the prod VPC **and its RDS**, which carries
  `removalPolicy: DESTROY` and takes no snapshot.
- **Non-prod diverges from prod on cost levers (ADR-0008).** Non-prod RDS uses `gp3` while prod stays
  `gp2`; non-prod Fargate runs `FARGATE_SPOT` while prod runs on-demand `FARGATE`. Flagging this as an
  inconsistency to "align" is wrong in both directions: sandbox must not match prod, and prod must not be
  flipped without its own PR plus a no-diff proof. The account-scoped `kitchensink-cost-guardrails` stack
  is `Environment=global` and must never be tagged `pr-{N}`.
- **The `Environment` tag governs teardown (ADR-0005).** Persistent global infra is `Environment=global`
  and named `kitchensink-*`; an ephemeral per-PR deploy is `Environment=pr-{N}`. There is **no denylist** —
  safety depends entirely on never naming or tagging a global resource `pr-{N}`. Any new feature service
  must tag `Environment=pr-{N}` and prefix untaggable resources with `pr-{N}`.

## What to actually scrutinise here

- **A fallback that returns success.** This is the highest-value thing to catch in these paths. A CDK
  custom resource whose handler is missing must **fail**, not no-op — a stub that reports
  `CREATE_COMPLETE` for work it did not do ran production for four weeks with a missing database role
  behind entirely green deploys. Any `try`/`catch` that swallows, any default that substitutes for a
  required input, and any handler that can return without doing its job is a defect. Falling back without
  making the caller aware is hiding a problem, not handling it.
- **Custom resources re-run on PROPERTY change, not code change.** Changing only the bundled handler code
  will not re-invoke the resource. A property that encodes the code's identity is required.
- **The identity service and its webhooks are global, persistent, shared infrastructure.** They must never
  be torn down. Prod and the shared sandbox both serve real traffic.
- Missing removal policies, un-encrypted stores, over-broad IAM, and security-group rules opened to
  `0.0.0.0/0` are worth flagging — there is currently no automated IaC security scanning on these paths.
