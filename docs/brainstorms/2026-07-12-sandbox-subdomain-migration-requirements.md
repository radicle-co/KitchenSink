---
date: 2026-07-12
topic: sandbox-subdomain-migration
---

# Sandbox previews → per-PR subdomains (Option B′ migration)

> Authored autonomously (owner asleep). Decisions I made are marked **[assumption]**; the shared-sandbox
> cutover steps are deliberately left as human-gated (see Cutover).

## Summary

Migrate sandbox web previews from path routing (`sandbox.commise.app/pr-{N}`) to per-PR **subdomains**
(`pr-{N}.sandbox.commise.app`), gated by the self-owned regex `azp` guard. This gives each preview an
isolated origin (separate cookies/session/storage) and removes the Next.js `basePath` fragility that has
repeatedly bitten preview auth — while keeping `azp` enforcement ON. The go/no-go spike returned **GO**
(ADR-0001 Update 2026-07-12): the dev Clerk instance accepts any origin, and the regex predicate bounds
acceptance to `pr-{N}.sandbox.commise.app`.

## Problem Frame

Path routing exists because of one now-corrected premise (exact-match `azp`). It carries a standing tax:
the `basePath` × Clerk-routing interaction (double-prefix, SSO-callback prefix drop) has caused repeated
preview auth bugs, and all previews share one origin so they share browser/session state. Subdomains fix
both — but the sandbox is **shared** (one identity env, one router, one Clerk instance serve every PR), so
the migration is a **cutover of shared infrastructure**, not a per-PR change. Done carelessly it breaks
every open preview at once. The design below is dominated by making the cutover safe and reversible.

## Key Decisions

- **Backend accepts BOTH origins during transition, tightens after.** The regex predicate must accept the
  base `sandbox.commise.app` (today's path-routed previews) AND `pr-{N}.sandbox.commise.app` (new) while
  both serving modes coexist, so flipping the backend to pattern mode never 401s an in-flight preview.
  After all previews serve on subdomains, tighten to `pr-{N}` only. This is the single change that
  de-risks ordering — implemented first (transition-mode pattern + tests).
- **Router flips from path-based to host-based, additively.** The singleton CloudFront + CFF + KVS router
  (`SandboxRouterStack`) host-swaps `/pr-{N}/*` today; it gains a host-based branch (`pr-{N}.sandbox…` →
  same KVS lookup) added **alongside** the path branch, and a `*.sandbox.commise.app` distribution alias
  (covered by the existing `*.commise.app` cert). Path routing stays live until cutover, so nothing breaks.
- **basePath becomes conditional, not removed.** The web build keeps `basePath` support but stops applying
  it when serving on a subdomain (a subdomain preview is at root). Gated on a build-time signal so both
  modes build. Removing `basePath` outright is deferred to after cutover. **[assumption]** we keep the
  ADR-0001 basePath machinery until the last preview leaves path routing.
- **Per-PR DNS is a single wildcard, not per-PR records.** `*.sandbox.commise.app` → the router
  distribution (one record), so a new PR needs no DNS write — the router's KVS lookup (already per-PR)
  selects the app by the `pr-{N}` host label. Cheaper + no per-PR provisioning race. **[assumption]**
- **Cutover is human-gated.** The steps that flip the _shared_ sandbox (enable host routing on the live
  router, point previews at subdomains, flip the backend to pattern mode, retire path routing) require the
  live `azp`-on-subdomain confirmation + a window, and are NOT done autonomously.

## Requirements

- R1. The `azp` predicate supports a transition mode accepting the base origin AND `pr-{N}` subdomains, and
  a strict mode accepting only `pr-{N}`. Both unit-tested (match, adversarial near-miss, base accept/reject
  per mode).
- R2. The deployed sandbox services can be configured (stage env) to pattern mode with the transition
  pattern, with prod unchanged (exact-match) — synth-verified, no prod diff.
- R3. `SandboxRouterStack` routes `pr-{N}.sandbox.commise.app` by Host to the PR's app via the existing KVS
  lookup, added ALONGSIDE the path route, with a `*.sandbox.commise.app` alias — synth + unit-tested.
- R4. The web app omits `basePath` when built for subdomain serving, retaining path-mode builds — build +
  typecheck verified.
- R5. Per-PR subdomain serving needs no per-PR DNS write (one wildcard record).
- R6. A documented, ordered, reversible **cutover runbook** with the live-signin confirmation gate.

## Scope Boundaries

**Deferred to after cutover**

- Removing `basePath` machinery and the path-routing branch from the router.
- Tightening the `azp` pattern to `pr-{N}`-only.

**Outside this migration**

- Prod (single origin, exact-match — untouched).
- Mobile (no browser `azp`).
- The manifest/static-resource mechanism (ADR-0001) — moot once each PR is its own origin.

## Cutover (human-gated, ordered, reversible)

1. Confirm `azp` on a live `pr-N.sandbox.commise.app` sign-in (the one remaining empirical nail).
2. Deploy the router's host-based branch + wildcard alias (additive; path routing still live).
3. Flip the sandbox services to **transition** pattern mode (accepts base AND `pr-{N}`) — path-routed
   previews keep working.
4. Point preview builds at their subdomain (drop basePath) for new deploys; validate a real preview.
5. Once all active previews serve on subdomains: tighten `azp` to `pr-{N}`, retire the path branch +
   basePath. Each step is independently revertible.

## Open Questions / Assumptions to confirm at wake

- **RESOLVED (verified live 2026-07-12).** The imported domain cert
  (`kitchensink-domain-sandbox:CertificateArn`) already carries the `*.sandbox.commise.app` SAN (SANs:
  `commise.app`, `*.commise.app`, `*.sandbox.commise.app`; status ISSUED). My earlier note that "the
  `*.commise.app` wildcard covers it" was imprecise — a single-label wildcard does not cover a two-label
  host — but the dedicated `*.sandbox` SAN does, so **no cert change is needed** and no ACM replacement is
  triggered. The router alias slice is therefore safe.
- **[assumption]** the sandbox web app is served via the CloudFront router in front of Vercel, so a
  `*.sandbox.commise.app` alias + host-based CFF is the right serving change (vs. Vercel-native domains).
- **[assumption]** `*.sandbox.commise.app` wildcard DNS + KVS host-label lookup is preferred over per-PR
  DNS records.
- Mobile `azp` decode (still needs a real `@clerk/expo` token) — orthogonal, tracked from the spike.
