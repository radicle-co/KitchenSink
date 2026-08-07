# 0013 — cdk-nag on every CDK app, ADVISORY (warnings only), with a byte-identical-template guarantee

- **Status:** Accepted — implemented. `attachSecurityChecks(app)` is called from all seven CDK app entrypoints; findings are reported as CDK warnings and burn-down has not started.
- **Date:** 2026-08-07
- **Area:** IaC security · CDK Aspects · prod-template stability
- **Related:** `docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md` (no-prod-diff), `0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md` (no-prod-diff), `packages/infra/security/**`, `packages/infra/global/__tests__/cdk-nag-{attachment,template-parity,synth.integration}.test.ts`

## ⚠️ Before you change this — the two traps

- **Do NOT "simplify" `AdvisoryAwsSolutionsChecks` to a bare `new AwsSolutionsChecks(...)`.** Most `AwsSolutions` rules are ERROR level, cdk-nag reports them via `Annotations.addError`, and the CDK CLI **exits 1** when any error annotation is present. Measured: a bare `AwsSolutionsChecks` over one default S3 bucket makes `cdk synth` exit 1. Attaching the stock pack would therefore not "report" a 115-finding backlog — it would **block every `cdk synth` and `cdk deploy`** on live infrastructure. The subclass exists solely to downgrade ERROR→WARN, and removing it is an outage, not a cleanup.
- **Do NOT add a `NagSuppressions` entry casually.** A suppression is **not** annotation-only: it writes `Metadata.cdk_nag.rules_to_suppress` **into the CloudFormation resource** (verified by diffing synth output with and without one). That is a real template diff, and prod template stability is what ADR-0002 and ADR-0008 both stake data safety on. Every suppression must be its own reviewed change with its own diff.

## Context

- The repo owns a VPC, IAM roles, RDS, S3, SQS, SNS, an internet-facing shared ALB, API Gateway, CloudFront and ~20 Lambdas across seven CDK apps, and had **no IaC security scanning of any kind** — no cdk-nag, no Checkov, no `Aspects` at all (verified by grep before the change).
- Two ADRs make prod template stability load-bearing rather than cosmetic. ADR-0002 keeps prod on `10.0.0.0/16` precisely so the explicit value produces **no diff**, because replacing the prod VPC replaces the prod RDS (`removalPolicy: DESTROY`, `deletionProtection: false`, no snapshot). ADR-0008 makes the same promise for the gp3/Spot/budget levers. An Aspect runs over **every** construct in the tree, so an output-mutating one would breach that line everywhere at once — and invisibly.
- There is an existing backlog: 115 non-compliant findings across the seven prod apps at the time of adoption (112 at cdk-nag's ERROR level, 3 at WARN). Gating deploys on it was never an option.

## Decision

1. **`cdk-nag`'s `AwsSolutionsChecks` is attached to every CDK app**, at the app root, via one shared helper — `attachSecurityChecks(app)` from `@kitchensink/infra-security`. The pack is not subsetted: review breadth is whatever cdk-nag ships.
2. **Advisory mode, via a logger Decorator.** `AdvisoryAnnotationLogger` extends cdk-nag's `AnnotationLogger` and rewrites ERROR-level findings to WARN, passing WARN and INFO through unchanged. `AdvisoryAwsSolutionsChecks` filters the stock annotation logger out of the pack's logger list and prepends the advisory one, so exactly one annotation logger survives and it cannot raise errors. Findings are visible on every synth; nothing fails.
3. **One wiring point, discovery-enforced.** The posture lives in one function, and `cdk-nag-attachment.test.ts` walks the workspace for CDK apps (parsing each entrypoint with the TypeScript compiler, not regex) and fails if any discovered app does not call it, attaches a raw `AwsSolutionsChecks`, or omits the dependency. A new CDK app cannot ship unreviewed.
4. **Zero suppressions at adoption.** Because a suppression mutates the template, the advisory-first change carries none; the byte-identical guarantee and a suppression are mutually exclusive in one commit. cdk-nag itself rejects a `reason` under 10 characters at the call site, so a suppression can never be added without a stated justification.
5. **Compliance reports stay on** (cdk-nag's default): one `AwsSolutions-{stack}-NagReport.csv` per stack in `cdk.out`, which is the burn-down inventory for free.

## Consequences

**Positive**

- Every stack in every app is now security-reviewed on every synth, including per-PR previews, with no deploy risk.
- The no-prod-diff line is now *asserted*, not merely intended: `cdk-nag-template-parity.test.ts` compares full template JSON per stack, with and without the Aspect, for prod and sandbox — and includes a negative control proving the comparison detects a mutating Aspect.
- Proven byte-identical at adoption: all **12** synthesized prod templates across the 7 apps had identical checksums before and after. Only `*.metadata.json` (the cloud-assembly annotation sidecar, which CloudFormation never sees) changed, plus 11 added NagReport CSVs.

**Negative / costs**

- Every `cdk synth`/`cdk deploy` log now carries ~3–30 nag warnings per app (115 total at adoption). That is deliberate pressure, but it does add noise and can bury unrelated CDK warnings until the backlog shrinks.
- Synth walks the tree an extra time (~200 rules per resource). Measured as sub-second per app; no meaningful deploy-time cost.
- `AwsSolutions-L1` ("not the latest Lambda runtime") re-fires on every `aws-cdk-lib` bump that adds a runtime, so it is a recurring, low-value 19-finding block of noise. Expect to suppress or fix it early in the burn-down.
- Advisory mode reports but does not enforce. Promoting a rule to blocking is a separate decision; the intended path is to swap the logger for one that keeps ERROR level once a rule's findings are at zero, **not** to gate on the whole pack.

## Alternatives considered

- **Attach the stock `AwsSolutionsChecks` and fix the findings first** — rejected: it makes `cdk synth` exit 1 immediately, so the repo could not deploy until a 115-finding backlog was cleared. Advisory-first is what makes adoption possible at all.
- **Gate the Aspect behind a context flag / a separate `npm run infra:nag` audit command** — rejected: a review that only runs when someone remembers to ask for it is not a control. Attaching unconditionally, at zero deploy risk, is strictly better.
- **Checkov / tfsec-style external scanners over `cdk.out`** — rejected for now: they scan the emitted template, so findings point at synthesized logical IDs rather than the construct that produced them, and they need a separate synth+scan pipeline stage. cdk-nag reports at the construct path, which is where the fix goes.
- **Suppress the known-deliberate findings in the same change** (ALB `0.0.0.0/0`, the intentionally unauthenticated Clerk webhook route, RDS deletion protection) — rejected: each suppression writes template metadata, which would have made the prod diff non-empty and broken the acceptance criterion of this very change.
- **Bump `aws-cdk-lib` to satisfy `cdk-nag@3`'s peer range** — rejected: a CDK bump can itself move synthesized output, which is precisely the risk being controlled. `cdk-nag@2.38.2` peers on `aws-cdk-lib ^2.176.0` and works against the pinned 2.254.0.

## Implementation guards

- `packages/infra/security/src/attach-security-checks.ts` carries the "annotation-only, and a suppression is NOT" rationale at the wiring point.
- `packages/infra/global/__tests__/cdk-nag-template-parity.test.ts` — byte-identical prod + sandbox templates, per stack, plus "a suppression would show up here" (`no cdk_nag metadata`) and a mutating-Aspect negative control.
- `packages/infra/global/__tests__/cdk-nag-synth.integration.test.ts` — a real `cdk synth` at prod and sandbox: exit 0, warnings present, no CLI error line. This is the only tier that can catch the ERROR→exit-1 regression, because it is a property of the CLI, not of in-process synthesis.
- `packages/infra/global/__tests__/cdk-nag-attachment.test.ts` — discovery-based; also pins the known entrypoint set so a broken walk cannot pass silently.
