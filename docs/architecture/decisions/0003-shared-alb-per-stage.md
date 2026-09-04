# 0003 — One shared internet-facing ALB per stage, host-based routing per service

- **Status:** Accepted — _`SharedAlbStack` implemented_ (`packages/infra/global/lib/platform/SharedAlbStack.ts`, wired into `GlobalStack` as `kitchensink-alb-{stage}`). Identity, food and recipe import the shared HTTPS listener and add host-based rules (priorities 100 / 200 / 300) instead of owning an ALB. **Amended 2026-08-12:** priority allocation moved out of the service stacks into the single authority `@kitchensink/infra-alb` — see _Update (2026-08-12)_.
- **Date:** 2026-06-20 (amended 2026-08-12)
- **Area:** AWS edge topology · CDK global infra · ELBv2 (ALB) · cross-stack exports · Route53
- **Related:** `packages/infra/alb/src/listenerPriority.ts` (**the** priority allocator), `packages/infra/global/lib/platform/SharedAlbStack.ts`, `packages/infra/global/lib/platform/GlobalStack.ts`, `packages/services/identity/infra/lib/IdentityServiceStack.ts`, `packages/services/food-service/infra/lib/FoodServiceStack.ts`, `packages/services/recipe-service/infra/lib/RecipeServiceStack.ts`, `docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md` (shared VPC/SGs this builds on), `docs/architecture/decisions/0013-cdk-nag-advisory-iac-security-linting.md` (why the allocator ships built JS), `specs/003-usda-food-data/plan.md`

## ⚠️ Before you change this — the trap

If you are about to give a service "its own" ALB, reuse a listener-rule priority, or `cdk deploy` a service stack against a stage that has no shared ALB yet — **stop and read this first.**

- **Services do NOT own an ALB.** The single `SharedAlbStack` (`kitchensink-alb-{stage}`) owns the only ALB per stage; each service `Fn.importValue`s the `SharedAlbHttpsListenerArn` and adds an `ApplicationListenerRule` with a host-header condition. Re-adding a per-service `ApplicationLoadBalancer` defeats the cost decision and double-bills the ~$16/mo base.
- **⛔ NEVER write a listener priority into a service stack. There is ONE allocator: `@kitchensink/infra-alb`.** A stack calls `listenerPriorityForStage({ service, stage, baseStage })` (or reads `BASE_LISTENER_PRIORITY` for a base-only service) and states no numbers of its own. The previous design copy-pasted two constants and a resolver into each service stack, and it drifted exactly as duplicated knowledge does — see **Update (2026-08-12)** below. Adding a service means appending one name to `EPHEMERAL_SLOT_ORDER` and one base priority; it does **not** mean writing arithmetic.
- **Priorities are ONE namespace shared across independently-deployed stacks, and nothing in AWS arbitrates it.** A collision does **not** fail synth. It fails the deploy with `Priority 'NNNNN' is currently in use`, which does not name the other claimant. Note also that `aws-cdk-lib` validates only `priority >= 1` — it does **not** check the **50000** ceiling, so an overflow reaches CloudFormation unless the allocator catches it (it does).
- **The shared ALB must deploy before any service stack.** Service stacks import the shared listener ARN; CloudFormation cannot resolve that import until `kitchensink-alb-{stage}` exists. Deploy order is global (network → data → domain → **alb**) then the services. A fresh stage with services-first deploy fails on an unresolved export.
- **The shared ALB security group lives in `NetworkStack`.** `AlbSecurityGroup` is owned by the network stack and the shared `serviceSecurityGroup` already allows ALB ingress on :3000 — adding a service needs **no** SG change. Do not create a new ALB SG per service.

## Context

- Each backend service (identity, then the new food service) originally created its **own** internet-facing ALB + HTTPS/HTTP listeners + A-record. An idle ALB costs ~$16/mo base per stage (plus LCU), so N services × M stages multiplies a fixed cost while traffic is still negligible.
- The platform already has the shared building blocks: one VPC per stage with a shared public subnet set, a shared `AlbSecurityGroup`, a shared `serviceSecurityGroup` that already permits ALB→task ingress on :3000, and a wildcard ACM certificate (`*.{domain}` + `*.sandbox.{domain}`) — so a single ALB can terminate TLS for every service subdomain in the stage.
- Services are addressed by distinct host names (~~`identity[.stage].{domain}`, `food[.stage].{domain}`~~), which is exactly what ALB host-based listener rules route on.
    - ⛔ FALSE (2026-09-04): the **dot** form was never legal and is now unrepresentable. The shared ALB's
      certificate is `{domain}` + `*.{domain}` + `*.sandbox.{domain}`
      (`packages/infra/global/lib/platform/DomainStack.ts:39-42`) — all single-label wildcards — so
      `food.pr-7.commise.app` matches nothing and fails the TLS handshake. The one authority is
      `publicSubdomainForStage` (`packages/infra/alb/src/publicOriginHost.ts:29`): prod → the bare label
      (`identity.{domain}`), every other stage → the **dash** form (`food-pr-7.{domain}`). ADR-0006's
      _Amendment (2026-07-29)_ is where this was settled; the dot form cannot be constructed at all.

## Decision

1. **One shared internet-facing ALB per stage**, provisioned by `SharedAlbStack` in `packages/infra/global` (`kitchensink-alb-{stage}`), in the shared VPC's public subnets using the shared `AlbSecurityGroup`.
2. **Host-based routing per service.** The HTTPS listener (443, wildcard cert — ⚠️ STALE (2026-09-04): **two** certificates on prod since ADR-0020, `certificates: [domain.certificate, ...(domain.internalCertificate ? [domain.internalCertificate] : [])]` at `packages/infra/global/lib/platform/SharedAlbStack.ts:51`; the additive `*.internal.{apex}` cert is prod-only) has a **default fixed-response 404** (unmatched hosts are not silently routed anywhere). Each service imports the listener and adds an `ApplicationListenerRule` matching its host header → its own target group. The HTTP listener (80) redirects to HTTPS.
3. **Per-service priority allocation:** identity = 100, food = 200, recipe = 300, next = 400, … — unique across the shared listener. **Superseded in mechanism by Update (2026-08-12):** these base numbers are unchanged, but they and the ephemeral bands are now owned by one module rather than restated per stack.
4. **A-records alias the shared ALB.** Each service still owns its Route53 A-record (~~`identity[.stage]`, `food[.stage]`~~ — see the _Context_ correction above: the label is `{service}` on prod and `{service}-{stage}` everywhere else) but aliases it to the imported shared ALB (ARN / DNS / canonical hosted-zone id exported by `SharedAlbStack`). ⚠️ STALE (2026-09-04): on **prod** a service now emits **two** A-records, the public one and ADR-0020's `{service}.internal.{apex}` origin — asserted at `packages/services/identity/infra/__tests__/stacks.test.ts:551` (`resourceCountIs('AWS::Route53::RecordSet', 2)`) against `:570` (count 1) off prod.
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

## Update (2026-08-12) — ONE allocator, registry-driven bands (the priority space was exhausted at two feature services)

### What was wrong

Two defects, and the capacity one was the less serious.

1. **Capacity.** Each feature service owned **two 10000-wide bands** — food 10000–19999 (per-PR) + 20000–29999 (named), recipe 30000–39999 + 40000–49999. AWS admits **1–50000** (confirmed against AWS's listener-rule documentation), so **two** feature services exhausted the range and a third had nowhere to go. With the owner's near-term roster of **5 services**, 4 feature services × 2 bands × 10000 = **80000 > 50000**: it cannot fit. (Identity needs no ephemeral band — confirmed: it is the one shared persistent service every preview signs in against, its stack imports `kitchensink-alb-${stage}` rather than `${baseStage}`, and it has no per-PR deploy.)
2. **Duplication — and it had already fired.** The scheme was copy-pasted per service: two constants plus one resolver in each stack. Recipe's resolver docstring carried **food's** band values (`10000+N` / `20000+hash`); following the prose instead of the constants puts `recipe-pr-{N}` on `food-pr-{N}` and produces the exact `Priority '10073' is currently in use` failure the disjoint bands exist to prevent. Five services meant five copies. Fixing only capacity would have left the mechanism that produced the drift.

### Decision

`packages/infra/alb` (`@kitchensink/infra-alb`) is the **single allocation authority**. It owns the range constants, the service registry, and the resolver; identity, food and recipe import it and restate nothing. It exports built JS (like `@kitchensink/infra-security`) because both deploy pipelines run service CDK entrypoints as compiled `node .../infra/dist/bin/app.js` (ADR-0013).

Geometry — three adjacent spans, each ephemeral span cut into one fixed-width band per **reserved service slot** (8 reserved; a service's slot is its index in `EPHEMERAL_SLOT_ORDER`, so two services sharing a slot is structurally impossible rather than merely tested against):

| Span   | Range        | Allocated by   | Per slot         |
| ------ | ------------ | -------------- | ---------------- |
| base   | 1 – 999      | explicit value | one fixed number |
| named  | 1000 – 1999  | registry index | 125              |
| per-PR | 2000 – 49999 | the PR number  | 6000             |

Per-PR bands: `2000 + slot × 6000`. So identity 2000–7999 (reserved, unused), food 8000–13999, recipe 14000–19999, then 20000–25999, 26000–31999, 32000–37999, 38000–43999, 44000–49999. **The 5-service roster tops out at 31999; the full 8-service roster lands exactly on 49999.** Slots 3–7 are free, and a new service takes the next one **renumbering nothing already allocated**.

### Alternatives considered

- **Interleave by stride** (`PR_FLOOR + N × STRIDE + slot`) — the arithmetic **dual** of bands, with identical total capacity. Rejected on **failure mode**: at `slot === STRIDE` a stride scheme silently **aliases** onto slot 0 of the next PR (`floor + N×8 + 8 ≡ floor + (N+1)×8 + 0`) — a real, live priority belonging to another service — whereas a 9th band computes **past 50000**, which is out of range and therefore detectable absolutely (and is asserted at synth, since CDK does not check the ceiling). Given the standing rule that silent-at-synth/cryptic-at-deploy is the worst outcome, the scheme whose overflow is a range violation beats the one whose overflow is a collision. Secondary: bands make a failed deploy's opaque number decodable by range (`8073` → food's band → `food-pr-73`) instead of by modular arithmetic, and they carry marginally more capacity (a 6000-wide band admits PRs to 5999; stride-8 over the same span admits ~4875). The argument that _"bands force a renumber every time the roster grows"_ does not hold: a right-sized band is taken from free space, changing nothing. The old design's flaw was the band **width** (10000), not the band **shape**.
- **Modulo the PR number instead of throwing** — rejected. It removes the ceiling but reintroduces a silent collision (two open PRs congruent mod the span), which is the failure this update is eliminating elsewhere.
- **Allocate from live ALB state at synth** — rejected. Non-deterministic templates, and a race between concurrent per-PR deploys.

### Named ephemeral stages: collisions are now IMPOSSIBLE, not merely unlikely

The old named band was **hash-derived with an acknowledged, silent residual** — food's own docstring admitted "two _distinct, concurrently deployed_ named stages could still collide" — and narrowing any span raises that probability. A hash collision is also **undetectable at synth**: each stack synthesizes alone and cannot know what other stages exist, so it could only ever surface as an opaque deploy failure.

So named stages are allocated from a **registry** (`NAMED_EPHEMERAL_STAGES = ['dev', 'test', 'local']`), index → slot. Two concurrently deployed named stages cannot share a priority, and an **unregistered** name **throws at synth** with a message saying to register it. `dev` is load-bearing: it is the `?? 'dev'` fallback in every service's `infra/bin/app.ts`, so a bare local `cdk synth` lands on it. Accepted cost: a genuinely new named stage is a one-line edit, and an ad-hoc local stage name fails loudly instead of silently taking a hash slot.

### Consequences, stated honestly

- **The PR-number ceiling drops from 9999 to 5999.** At PR ~91 that is ~65× headroom, but it **is** a reduction — the price of fitting more than two feature services at all. Past it, allocation **throws**; it never wraps. It already bit one caller: a parity test synthesized `pr-9999` and now uses `pr-5999` (the last admitted number, so it doubles as the boundary probe).
- **Ephemeral priorities MOVED** (e.g. `food-pr-7` 10007 → 8007). This is deliberate and cheap: per-PR rules are created and destroyed with their PR, so they are replaced on the next deploy. **Prod's synthesized template is unchanged** — verified by diffing the full synthesized templates for identity, food and recipe at `stage=prod` before and after: byte-identical, base priorities still 100/200/300.
- **A 9th service** needs the geometry re-cut (narrower bands ⇒ lower PR ceiling, or a second listener). It fails at synth, loudly.
- **Identity's slot 0 is reserved and unused**, costing one of eight slots, to keep the registry uniform (no "base-only service" special case) and to avoid a renumber if identity ever gains a per-PR deploy.
- **Duplicate base priorities remain possible in the registry** (the slot cannot be duplicated, but two services could be given the same base number). That is caught by a test, not by construction, because base priorities are written explicitly rather than derived from slot order — deliberately, so that reordering the registry cannot silently move a **prod** rule.
- **The per-ALB rule COUNT, not the priority range, is the real capacity limit.** AWS's default quota is **100 rules per Application Load Balancer** (adjustable). 8 services × concurrent open PRs reaches 100 long before it reaches priority 50000, so that quota — not this geometry — is what to watch as the roster and PR concurrency grow.

## Implementation guards

- `packages/infra/alb/src/__tests__/listenerPriority.test.ts` proves the property the scheme exists for, **exhaustively**: it enumerates every priority every one of the 8 reserved slots could ever be handed (all 48000 per-PR + 1000 named values) plus the registered base priorities into one Set and asserts the cardinality, asserting the enumerated size **first** so the property cannot pass vacuously. It also pins `{ identity: 100, food: 200, recipe: 300 }` as the prod-diff guard. Mutation-verified: a band width off by one either way, an overlapping span, a duplicate base priority, a duplicated registry entry, a lenient `pr-{N}` parse (which would alias `pr-007` onto `pr-7`), and dropping the unregistered-named-stage throw each turn it red.
- Each service's own infra suite asserts the **wiring** rather than re-deriving the arithmetic: that its rule lands in **its own** band and not another service's (`service: 'recipe'` in food's stack, or vice versa, reds) — the drift that actually fired.
- `packages/infra/global/__tests__/SharedAlbStack.test.ts` asserts exactly 1 ALB, the HTTPS 404 default action, the HTTP→HTTPS redirect, and the 4 exports.
- `packages/services/identity/infra/__tests__/stacks.test.ts` and `packages/services/food-service/infra/__tests__/FoodServiceStack.test.ts` assert each service synthesizes **0** ALBs, **1** host-based `ListenerRule` (correct priority + host header), **1** target group, and the A-record — guarding against a regression that re-adds a per-service ALB. (⚠️ STALE (2026-09-04): still **1** `ListenerRule`, but on prod it now carries TWO host headers and an origin-header condition, and **2** A-records — see decision 4's note. Verified: `stacks.test.ts:189` count 0 ALBs, `:219` count 1 rule, `:234` count 1 target group.)
