# 0002 — One VPC per stage with distinct CIDRs (prod 10.0.0.0/16, sandbox 10.1.0.0/16)

- **Status:** Accepted — _per-stage CIDR threading implemented_ (`NetworkStack` takes `stage`, `cidrForStage` assigns the range; prod unchanged, sandbox renumbered). The **sandbox VPC/RDS recreation** and **legacy `dev` retirement** are operational steps (see the runbook) and remain to be executed.
- **Date:** 2026-06-14
- **Area:** AWS network topology · CDK global infra · RDS · cross-stack exports
- **Related:** `docs/plans/2026-06-14-004-refactor-vpc-consolidation-plan.md`, `docs/runbooks/sandbox-vpc-recreation.md`, `docs/plans/2026-06-14-003-feat-tailscale-private-aws-access-plan.md` (depends on this), `packages/infra/global/lib/platform/network-stack.ts`, `.github/workflows/prod-deploy.yml`, `.github/workflows/sandbox-identity-deploy.yml`

## ⚠️ Before you change this — the trap

If you are about to change a stage's VPC CIDR in `cidrForStage`, or "just `cdk deploy`" a CIDR change — **stop and read this first.**

- **Changing the prod CIDR (or a construct ID that feeds the VPC) replaces the prod VPC, which replaces the prod RDS.** RDS is `removalPolicy: DESTROY`, `deletionProtection: false` — there is no safety snapshot. Prod data is gone. Prod is kept on `10.0.0.0/16` precisely so the explicit value equals the prior CDK default and produces **no diff**. The gate before any prod deploy is an **empty `cdk diff` for the whole prod network + data stacks**, not just "the VPC looks unchanged."
- **A CIDR change cannot be a one-shot `cdk deploy --all`.** CloudFormation refuses to change an export while another stack imports it, and the service/webhooks stacks import the network/data exports. The swap is an ordered teardown (see the runbook). A naive deploy deadlocks on export-in-use.
- **Never `cdk destroy` the global/data stack to recover from a wedged update.** Its buckets are `autoDeleteObjects: true` + `DESTROY`; destroy empties them and drops the DB. Fix forward only. `destroy` is the procedure for the service/webhooks stacks, not the data stack.

## Context

- Both prod and sandbox VPCs were created from one `network-stack.ts` with no explicit `ipAddresses`, so both defaulted to `10.0.0.0/16`. Identical CIDRs block VPC peering and forced the Tailscale router design into 4via6 site-ID gymnastics.
- A parentless `IdentityNetwork-dev` VPC + `kitchensink-data-dev` RDS linger from an earlier `STAGE=dev` deploy that no current workflow reproduces.
- The network/data/domain stacks were also duplicated (byte-identical in the service package; an older, SG-pairing-missing copy in the webhooks package), referenced only by tests — drift waiting to happen.
- The identity VPC is the only VPC-attached prod infrastructure (the web app's `SandboxRouterStack` is CloudFront-based and VPC-independent), so "one VPC per stage" was already nearly true.

## Decision

1. **One VPC per stage, distinct CIDRs.** `NetworkStack` takes `stage`; `cidrForStage` assigns prod `10.0.0.0/16` (unchanged — no replacement) and sandbox `10.1.0.0/16` (distinct, so the VPCs can be peered). Unknown/`dev`/`test` stages get a throwaway `10.2.0.0/16` rather than throwing, so local synth and tests keep working.
2. **Recreate sandbox fresh; do not migrate data.** Sandbox identity data is minimal; the sandbox RDS is rebuilt in the new VPC after a verified-empty check and a pre-destroy snapshot (insurance), via the ordered teardown in the runbook.
3. **Retire the legacy `dev` VPC/RDS** after a CFN **and** non-CFN dependency sweep, PII-aware row check, and staged disable-then-delete.
4. **Single authoritative stack set** in `packages/infra/global`; the service/webhooks duplicate definitions are deleted, with infra tests relocated to the global package.
5. **Cross-VPC router topology: Option A (peer the VPCs, one prod router).** The peering connection, routes, and cross-VPC DB SG rule are built with the Tailscale router (ADR 0003 / plan 003), not here; this ADR establishes the distinct-CIDR precondition that makes peering legal.

## Consequences

**Positive**

- Distinct CIDRs unblock VPC peering and remove 4via6 from the Tailscale design.
- Single authoritative stack set; no duplicate-definition drift.
- Prod is untouched at the VPC/RDS level (the change is a no-op there).

**Negative / costs**

- Landing the `packages/infra/global/**` change redeploys prod service + webhooks and re-runs prod migrations (idempotent) — a prod-touching merge, gated by a clean all-stacks `cdk diff`.
- Sandbox has a brief outage during recreation and its test data is discarded (snapshot taken first).
- **Option A couples prod↔sandbox at the routing layer** once peering lands — gated by route tables, the cross-VPC DB SG rule, and the tailnet ACL; reversible in ~5 minutes. The developer laptop bridges both VPCs regardless once the router exists, so the tailnet ACL is the load-bearing control either way.

## Alternatives considered

- **Renumber prod's CIDR** — rejected; replacing the prod VPC/RDS for no functional gain. (The global stacks were subsequently de-identified to `kitchensink-{network,data,domain,global}-{stage}` with `KitchenSink-{stage}` VPC names during the destroy/recreate — the replacement cost was already being paid, and the shared platform infra should not be Identity-branded.)
- **Snapshot/restore sandbox RDS** — rejected for recreate-fresh (negligible data), but a pre-destroy snapshot is still taken.
- **Two routers, one per VPC, no peering (router Option B)** — not chosen; keeps AWS-layer isolation but costs a second instance, and the laptop bridges both VPCs anyway. Reversible, so revisitable.
- **Transit Gateway** — rejected on cost (~$73/mo attachment fees for a 2-VPC same-region setup) with no benefit at this scale.

## Implementation guards

- `packages/infra/global/lib/platform/network-stack.ts` — `cidrForStage` carries the prod-stays-10.0.0.0/16 rationale; the prod-CIDR and SG-pairing assertions in `packages/infra/global/__tests__/network-stack.test.ts` guard against accidental prod renumbering and the `ENI_SG_RULES_MISMATCH` regression.
- The ordered-teardown sequence, CI suppression, verified-empty check, and fix-forward recovery live in `docs/runbooks/sandbox-vpc-recreation.md`.
