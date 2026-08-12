# 0003 — One shared internet-facing ALB per stage, host-based routing per service

- **Status:** Accepted — _`SharedAlbStack` implemented_ (`packages/infra/global/lib/platform/shared-alb-stack.ts`, wired into `GlobalStack` as `kitchensink-alb-{stage}`). Identity and food refactored to import the shared HTTPS listener and add host-based rules (priorities 100 / 200) instead of owning an ALB.
- **Date:** 2026-06-20
- **Area:** AWS edge topology · CDK global infra · ELBv2 (ALB) · cross-stack exports · Route53
- **Related:** `packages/infra/global/lib/platform/shared-alb-stack.ts`, `packages/infra/global/lib/platform/global-stack.ts`, `packages/services/identity/infra/lib/identity-service-stack.ts`, `packages/services/food-service/infra/lib/food-service-stack.ts`, `docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md` (shared VPC/SGs this builds on), `specs/003-usda-food-data/plan.md`

## ⚠️ Before you change this — the trap

If you are about to give a service "its own" ALB, reuse a listener-rule priority, or `cdk deploy` a service stack against a stage that has no shared ALB yet — **stop and read this first.**

- **Services do NOT own an ALB.** The single `SharedAlbStack` (`kitchensink-alb-{stage}`) owns the only ALB per stage; each service `Fn.importValue`s the `SharedAlbHttpsListenerArn` and adds an `ApplicationListenerRule` with a host-header condition. Re-adding a per-service `ApplicationLoadBalancer` defeats the cost decision and double-bills the ~$16/mo base.
- **Listener-rule priorities must be globally unique on the shared listener.** Allocation: identity = **100**, food = **200**, recipe = **300**; future services pick **400, 500, …**. Two rules with the same priority on one listener is a synth/deploy error. Keep the allocation comment in each service stack in sync.
- **Ephemeral (`pr-{N}` / named) stages allocate from per-service bands, and the space is now FULL.** A feature service's previews cannot reuse its base priority, so each owns two disjoint 10000-wide bands: food takes 10000–19999 (per-PR) + 20000–29999 (named), recipe takes 30000–39999 + 40000–49999. ALB rule priorities max out at **50000**, so those two services exhaust the range — a **third** feature service has no band to claim and needs a different scheme (one shared ephemeral band hashed over service _and_ stage, or a registry-derived priority). A band overlap does not fail synth; it fails the per-PR deploy with `Priority 'NNNNN' is currently in use`.
- **The shared ALB must deploy before any service stack.** Service stacks import the shared listener ARN; CloudFormation cannot resolve that import until `kitchensink-alb-{stage}` exists. Deploy order is global (network → data → domain → **alb**) then the services. A fresh stage with services-first deploy fails on an unresolved export.
- **The shared ALB security group lives in `NetworkStack`.** `AlbSecurityGroup` is owned by the network stack and the shared `serviceSecurityGroup` already allows ALB ingress on :3000 — adding a service needs **no** SG change. Do not create a new ALB SG per service.

## Context

- Each backend service (identity, then the new food service) originally created its **own** internet-facing ALB + HTTPS/HTTP listeners + A-record. An idle ALB costs ~$16/mo base per stage (plus LCU), so N services × M stages multiplies a fixed cost while traffic is still negligible.
- The platform already has the shared building blocks: one VPC per stage with a shared public subnet set, a shared `AlbSecurityGroup`, a shared `serviceSecurityGroup` that already permits ALB→task ingress on :3000, and a wildcard ACM certificate (`*.{domain}` + `*.sandbox.{domain}`) — so a single ALB can terminate TLS for every service subdomain in the stage.
- Services are addressed by distinct host names (`identity[.stage].{domain}`, `food[.stage].{domain}`), which is exactly what ALB host-based listener rules route on.

## Decision

1. **One shared internet-facing ALB per stage**, provisioned by `SharedAlbStack` in `packages/infra/global` (`kitchensink-alb-{stage}`), in the shared VPC's public subnets using the shared `AlbSecurityGroup`.
2. **Host-based routing per service.** The HTTPS listener (443, wildcard cert) has a **default fixed-response 404** (unmatched hosts are not silently routed anywhere). Each service imports the listener and adds an `ApplicationListenerRule` matching its host header → its own target group. The HTTP listener (80) redirects to HTTPS.
3. **Per-service priority allocation:** identity = 100, food = 200, recipe = 300, next = 400, … — unique across the shared listener, documented at each rule.
4. **A-records alias the shared ALB.** Each service still owns its Route53 A-record (`identity[.stage]`, `food[.stage]`) but aliases it to the imported shared ALB (ARN / DNS / canonical hosted-zone id exported by `SharedAlbStack`).
5. **Per-service 5xx alarms use the target-group metric, not the ALB metric.** The ALB-level 5xx now aggregates all services, so the identity 5xx alarm scopes to `targetGroup.metrics.httpCodeTarget(TARGET_5XX_COUNT)`.

## Consequences

**Positive**

- One ALB base charge per stage instead of one per service — the cost reason this exists.
- New services add a rule + target group + A-record (no new edge resource, no new SG).
- TLS, WAF-attachment point, and access logging are configured once per stage.

**Negative / costs**

- **Cross-stack dependency:** the global ALB must deploy before services (listener-ARN import); a stage teardown must drop service rules before the ALB.
- **Unique-priority discipline:** priorities are a shared namespace across service stacks; collisions are a deploy-time failure.
- **Shared blast radius:** a misconfigured listener/cert/SG on the shared ALB can affect every service in the stage; per-service isolation is traded for cost.
- Per-service observability requires target-group-scoped metrics (the ALB-level metric is now multi-tenant).

## Alternatives considered

- **One ALB per service (the prior state)** — rejected on cost while traffic is small; it is exactly what we revisit to (see trigger below) when isolation or LCU warrants.
- **Path-based routing on one listener** — rejected; services are naturally addressed by distinct subdomains, and host-based rules keep each service's routing self-contained and collision-resistant.
- **API Gateway / CloudFront in front of the services** — rejected as an extra edge layer for no gain at this scale; the Clerk bearer token verifies networklessly in-process (see `specs/003-usda-food-data/plan.md`), so no edge auth layer is needed.

## Revisit trigger

Move a service back to its **own** ALB when any of: sustained LCU/traffic makes per-service ALB cost marginal anyway; a service needs ALB-level isolation (independent WAF rules, access-log stream, or deploy/blast-radius separation); or the shared-listener priority/space or shared-SG coupling becomes an operational drag. The refactor is local — re-add an `ApplicationLoadBalancer` in that service stack, move its rule's target group onto the new listener, and re-point its A-record.

## Implementation guards

- `packages/infra/global/__tests__/shared-alb-stack.test.ts` asserts exactly 1 ALB, the HTTPS 404 default action, the HTTP→HTTPS redirect, and the 4 exports.
- `packages/services/identity/infra/__tests__/stacks.test.ts` and `packages/services/food-service/infra/__tests__/food-service-stack.test.ts` assert each service synthesizes **0** ALBs, **1** host-based `ListenerRule` (correct priority + host header), **1** target group, and the A-record — guarding against a regression that re-adds a per-service ALB.
