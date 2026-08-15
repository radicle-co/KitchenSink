# 0001 — Sandbox front-end addressing: path-based PR routing, not per-PR subdomains

- **Status:** Accepted, **with a reachability defect whose cure is now automated but not yet observed on a fresh PR** — see the _Update (2026-07-28)_ below: the router's Host swap makes every subdomain preview unreachable in a browser, and the fix is the addressing change (previews resolve to Vercel directly), which CI now performs per PR (`preview-domain` job, #94) after being executed by hand once on PR #73. Originally _path routing implemented_ (per-PR `basePath` builds + a singleton CloudFront + CloudFront Function (runtime 2.0) + KeyValueStore router that host-swaps `/pr-{N}/*` to each PR's app, with the project-wide Vercel bypass token injected at the edge). The **manifest/static-resource mechanism** and **native mobile** remain deferred. **Revisited 2026-07-12** — a feasibility spike found per-PR **subdomains are viable** after all (see the Update below); migration to subdomains is planned. Path routing stays in place until it lands.
- **Date:** 2026-06-14
- **Area:** sandbox deploy topology · web/mobile serving · Clerk session-token auth
- **Related:** service-side Clerk session-token verification (PR #39), `.github/workflows/sandbox-deploy.yml`, `.github/workflows/sandbox-identity-deploy.yml`, `packages/services/identity/src/auth/clerkAuth.service.ts`, `packages/services/identity/src/config/env.schema.ts`, the Option B′ spike (`docs/brainstorms/2026-07-10-sandbox-subdomain-azp-spike-requirements.md`, `docs/plans/2026-07-11-001-feat-sandbox-subdomain-azp-spike-plan.md`)

## Update (2026-07-12) — spike revisited the premise: per-PR **subdomains are viable** (recommendation: GO)

The trap below rests on one claim: _"Clerk matches `azp` by exact string, so per-PR subdomains each mint an unbounded `azp` the shared allowlist can't enumerate → 401."_ A feasibility spike (Option B′) found that claim is true **at the SDK layer but not binding at ours**, and that the sandbox dev instance does not block subdomains:

- **The exact-match is OUR code, not a Clerk constraint.** `azp` enforcement runs in `@kitchensink/clerk-verify` only because _we_ pass `authorizedParties` to `verifyToken`. Validating the signature-verified `azp` ourselves against an **anchored regex** (`^https://pr-\d+\.sandbox\.commise\.app$`) accepts a bounded family of per-PR origins with enforcement still ON — no unbounded allowlist, no wildcard handed to Clerk. Built + unit-tested (`buildPreviewAzpPattern` / `resolveAzpEnforcement` in `@kitchensink/clerk-verify`), wired stage-gated into identity/food/recipe (prod stays exact-match).
- **The dev instance accepts subdomain origins with no toggle.** Probed live against the sandbox Frontend API (`nice-fowl-6.clerk.accounts.dev`): it reflects **any** `Origin` back in `Access-Control-Allow-Origin` — `sandbox.commise.app`, `pr-9001.sandbox.commise.app`, **and** an unrelated origin — with `allow-credentials: true`. So a sign-in served from a per-PR subdomain is accepted and mints a token with `azp = that subdomain`. Clerk's "allowed subdomains" toggle is **production-instance-only**, but the **dev instance doesn't need it** — it isn't origin-restricted. This is precisely why the regex-`azp` guard is _essential_ on the dev sandbox: the instance trusts any origin, so our backend check is the real trust boundary.

**Recommendation: GO** — migrate sandbox previews to per-PR subdomains, gated by the regex-`azp` predicate. Prod is unaffected (single origin, exact-match). **One empirical confirmation remains:** a real browser sign-in on a live `pr-N.sandbox.commise.app` to decode the minted token and see `azp` literally equal the subdomain (near-certain given the CORS result + Clerk's documented `azp = Origin`). The old "Wildcard / pattern `azp` — not possible" line under _Alternatives_ is corrected below.

## Update (2026-07-28) — the router's Host swap makes every preview unreachable; the cure is to take CloudFront OUT of the preview path

Post-cutover the subdomain previews were **entirely unreachable in a browser**. One root cause, three symptoms, all traced live against `pr-73.sandbox.commise.app`.

**Root cause.** `ALL_VIEWER_EXCEPT_HOST_HEADER` + `updateRequestOrigin({ hostHeader: <deployment host> })` means the Host the Next app terminates is the **per-PR Vercel deployment host**, never the public preview origin. The app's idea of its own host ≠ the browser's origin. `x-forwarded-host` does **not** rescue this: the CFF already sets it (`router.cff.js`), and Vercel overwrites it with the Host it terminates — re-confirmed in the live trace below, so do not re-propose it.

1. **Clerk's handshake leaves our origin and dead-ends at Vercel SSO.** The dev-instance handshake's `redirect_url` is built from the app's host, so it came back as `https://commise-<hash>-radicle-co.vercel.app/en` — the bare deployment host, which **is** SSO-protected (`ssoProtection: all_except_custom_domains`). Every first document request ended at `vercel.com/login`. `/en`, `/en/sign-in` and `/en/recipes` were all dead.
2. **Every Server Action → 500.** Next 15's Server-Action CSRF check (`isCsrfOriginAllowed`, `next/dist/server/app-render/csrf-protection.js`) rejects `Origin !== Host` **before** it looks the action id up. Isolated to that one variable on the live preview, same URL and same bogus `Next-Action` id: `Origin == Host` → **404** (check passed, no such action); `Origin != Host` → **500**.
3. **clerk-js failing to load** — a consequence of (1), not a separate defect.

### What the alias experiment PROVED (and refuted)

The proposed cure was: register `pr-{N}.sandbox.commise.app` as a Vercel domain/alias and let Host be the public host. **As stated — keeping CloudFront in front — it is impossible.** Two independent Vercel constraints close it:

- **Cert issuance requires the hostname to resolve to Vercel.** `POST /v7/certs` for `pr-73.sandbox.commise.app` returned `449 http_pretest_domain_not_resolving_to_vercel_error` while the name still resolved to CloudFront, and `POST /v2/deployments/{id}/aliases` refuses with `400 cert_missing` until a cert exists. So you cannot register the alias _and_ keep CloudFront as the name's resolver.
- **Vercel rejects Host ≠ SNI outright.** Even with the domain registered and aliased, a request to the deployment host (SNI = `*.vercel.app`) carrying `Host: pr-73.sandbox.commise.app` returns **`403` with `x-vercel-mitigated: deny`** (anti-domain-fronting). The same request with matching SNI/Host returns normally. So "keep CloudFront's SNI on the deployment host and only override `hostHeader`" does not work either.

**The variant that DOES work — and it removes machinery.** Point the preview hostname at Vercel directly (Route 53 `CNAME → cname.vercel-dns.com`), let Vercel issue the cert, and alias the hostname to the PR's deployment. Executed live on PR #73 and verified in a real browser:

- Handshake `redirect_url` is now `https://pr-73.sandbox.commise.app/en`; the chain completes `307 → 307 → 307 → 200` and lands on `/en/sign-in` with **clerk-js loaded**.
- The Server-Action control pair inverts as predicted: `Origin == Host` → 404, `Origin != Host` → 500. Symptom 2 disappears with **no** app change, because Origin and Host are the same host again.
- **No bypass token is involved.** A registered custom domain is exempt from deployment protection, so the router's `vercel-bypass` KVS key becomes unnecessary for previews — as does the KVS route, the CFF, and the router distribution itself, for the preview path.

**Closes the last open confirmation.** A real browser sign-in on the live `pr-73.sandbox.commise.app` minted a session token whose `azp` is literally `"https://pr-73.sandbox.commise.app"` (`iss = https://nice-fowl-6.clerk.accounts.dev`), and the signed-in Home page rendered. The regex-`azp` guard therefore holds on a real per-PR subdomain; the item "confirm a live sign-in mints `azp` equal to the subdomain" is **done**.

### Was the SNI reframing right? Partly — and the corrected reason is stronger

The historical justification for `ALL_VIEWER_EXCEPT_HOST_HEADER` was "viewer Host → wrong origin TLS SNI → 502". The hypothesis that this was merely a **consequence of the domain not being registered** — i.e. that registering it makes Host pass-through viable — is **refuted for the CloudFront-fronted topology**, because registration is only possible once the name already resolves to Vercel. It is right only in the trivial sense that registration is part of the cure; it is wrong that it makes the _router_ viable.

The keep-`EXCEPT_HOST_HEADER` invariant therefore **stands**, but for a better-evidenced reason: with CloudFront in front, forwarding the viewer Host fails at Vercel regardless of TLS — unregistered → `404 DEPLOYMENT_NOT_FOUND`, registered-but-mismatched-SNI → `403 x-vercel-mitigated: deny`. Do not "fix" the router by switching to `ALL_VIEWER`.

### What remains — an infra action, not a code change

The repo-side change that landed here is `experimental.serverActions.allowedOrigins` (`src/lib/serverActionOrigins.ts` → `next.config.ts`). It fixes symptom 2 only, and is **necessary but not sufficient**: it does nothing for the Clerk handshake, so previews stay unreachable behind the router with it alone. It is a no-op once the topology below lands, and it is the right safety net while the router remains.

Adopting the working topology is an **infra/CI change the repo owner must make**, not something a code change can do:

1. Per PR, create the Route 53 record `pr-{N}.sandbox.commise.app` → `CNAME cname.vercel-dns.com` (more specific than the existing `*.sandbox` alias, so it wins), add the Vercel project domain, issue the cert, and **alias the specific preview deployment** (`POST /v2/deployments/{id}/aliases`) on every build — the workflow already resolves that deployment for the KVS step. — **DONE (#94); see _Creation of the preview address_ below.**
2. Do **not** use a Vercel _branch domain_ (`gitBranch`) as the auto-alias shortcut. Measured: with `gitBranch` set the domain is treated as a preview URL and deployment protection comes **back** (`302 → vercel.com/sso-api`); with `gitBranch` cleared the domain falls back to the **production** deployment. Only an explicit per-deployment alias gives an unprotected, correct preview.
3. ~~Teardown on PR close must remove the alias, the Vercel project domain, **and** the Route 53 record~~ — **DONE (2026-07-28, #94); see the sub-section below.** A CNAME left pointing at Vercel after the domain is released is a subdomain-takeover vector.
4. Once previews no longer resolve through CloudFront, the router distribution/KVS/CFF and the `vercel-bypass` secret are dead weight for the web preview and can be retired.

**Live state left in place (PR #73 only):** the Route 53 CNAME, the Vercel project domain + cert, and an alias pinned to deployment `dpl_CZLpYW9JrqYqYJYPftELYuL26E4M`. The preview worked, but because nothing re-pointed it, the **next push to the branch left it serving that pinned build** — which is precisely what the `preview-domain` job below now prevents, by re-aliasing on every PR event.

### Creation of the preview address — implemented (#94)

Both halves of the lifecycle are now automated, and they are deliberate mirrors of each other. `packages/apps/commise/web/scripts/createPreviewDomain.ts`, run by the **`preview-domain` job in `.github/workflows/sandbox-deploy.yml`** on every non-closed `pull_request` event, provisions all three records item 1 lists: the Vercel project-domain binding (`POST /v10/projects/{id}/domains`), the Route 53 `CNAME → cname.vercel-dns.com` (UPSERT, TTL 60), and the **per-deployment alias** (`POST /v2/deployments/{id}/aliases`). The deployment comes from the same `zentered/vercel-preview-url` action `sandbox-web-preview.yml` already uses for the KVS route, and the hosted zone from the same CloudFormation export the cleanup job reads.

- **Order is the safety property, twice over.** The Vercel claim happens **before** the DNS write — the takeover window is "the record resolves to Vercel while nobody claims the name", so an interrupted creation may only ever leave the SAFE half-state (claimed, not yet resolving), and a Vercel failure aborts before Route 53 is touched. That is teardown's order inverted, on purpose. Independently, the **alias must come last**: as measured above, it is refused with `400 cert_missing` until a cert exists, and the cert is refused with `449 http_pretest_domain_not_resolving_to_vercel_error` until the name already resolves to Vercel. The alias is therefore only _possible_ after DNS, so a freshly-created record is followed by a bounded retry (12 × 15 s) that treats exactly those two failures as "not yet" and every other status as permanent.
- **Idempotent, because it re-runs on every push** — which is what keeps the alias off a stale build. A domain already on **this** project is success (`existing`); an already-correct record is `unchanged`; a re-pointed alias is `moved`. A `409` is resolved by **asking this project whether it holds the domain** rather than pattern-matching Vercel's error codes, so a hostname claimed by a **different** project fails loudly — publishing DNS for a name we do not own is the takeover shape itself.
- **Scope is the same single authority as teardown.** `previewHostForPrToken` / `prTokenForPreviewRecordName` / `PR_TOKEN` / `requirePreviewHost` moved to `packages/apps/commise/web/scripts/previewDomainScope.ts`, which both commands import; there is deliberately no second `pr-{N}` matcher (ADR-0005). Exact first-label equality, re-asserted inside all three adapters.
- **Still NOT automated:** a Vercel _branch domain_ remains forbidden (item 2 above — measured to re-enable deployment protection), and nothing here retires the router/KVS/CFF machinery (item 4).

### Teardown of the preview address — implemented (#94)

`.github/scripts/teardown-sandbox-pr.sh` — the single script both the on-close `cleanup` job and the daily `reap-abandoned` job run (ADR-0005) — now removes the Route 53 record and the Vercel project-domain binding via `packages/apps/commise/web/scripts/teardownPreviewDomain.ts`, **before** any CloudFormation delete, because a stack delete can hang for many minutes and the security-critical removal must not queue behind it.

- **Order is the safety property.** DNS is deleted **first**, then the Vercel claim is released. The takeover window is precisely "record still resolves to Vercel while nobody claims the name", so an interrupted run may only ever leave the safe half-state (still claimed, no longer resolving). A DNS failure aborts before Vercel is touched.
- **Idempotent.** An absent record and an absent Vercel domain are both **success** — a PR that never had a preview, and a re-run of a completed teardown, must be green or the real signal gets ignored. Every other failure is an `::error::` and a non-zero exit.
- **Scope is exact-label equality — stricter than ADR-0005's name rule.** This zone also holds the apex `sandbox.commise.app`, the `*.sandbox` wildcard alias, ACM validation CNAMEs, and `identity.sandbox.commise.app` — the single **shared, persistent** identity service every preview signs in against. A record belongs to PR _N_ only when its first label is exactly `pr-{N}` (`pr-{N}-…` does **not** qualify in DNS), and both the Route 53 and Vercel adapters re-assert that themselves rather than trusting their caller. `ListResourceRecordSets` starts at-or-**after** the requested name, so its page routinely contains the shared identity host; only the exact match is put in the change batch, and there is a regression test for exactly that page.
- **The daily reaper discovers candidates from Route 53 too.** A PR that only ever had a web preview owns no stack, ECR repo or log group, so without that source its dangling CNAME would be invisible to the reaper forever.

Teardown was ahead of setup for the first day of its life — it would correctly reclaim an address a human had to remember to create. That gap is closed: see _Creation of the preview address_ above, whose `preview-domain` job creates the record, the project domain and (on every PR event) the per-deployment alias. The cert is issued by Vercel itself once the CNAME resolves, so nothing calls `POST /v7/certs` directly.

## ⚠️ Before you change this — the trap

If you are about to "simplify" sandbox previews to **per-PR subdomains** (`pr-123.commise.app`), relax/remove `CLERK_AUTHORIZED_PARTIES` enforcement on sandbox, or change where the sandbox web app is served from — **stop and read this first.** It looks like ordinary subdomain-per-preview routing should apply here. It deliberately does not, and reverting to it will silently 401 every sandbox sign-in.

## Context

- The **sandbox identity service is a single shared, persistent environment** (`STAGE=sandbox`, `registration.identity.sandbox.commise.app`). Every per-PR front-end points at that one service. (See `sandbox-identity-deploy.yml` — "one shared sandbox env".)
- All sandbox front-ends authenticate against **one shared Clerk _dev_ instance** (`pk_test`).
- The identity service verifies the **Clerk session token** itself and enforces the token's **`azp` (authorized party)** claim against `CLERK_AUTHORIZED_PARTIES`. Critically, Clerk's check is **exact-string `Array.includes(azp)`** — **no wildcards, no glob, no subdomain matching** (verified in `@clerk/backend`). A token's `azp` is the **browser Origin where the web app (ClerkJS) is served**, and is independent of how that app addresses the API.
- Therefore: if sandbox web previews are served from **per-PR subdomains** (`pr-{N}.commise.app`), each mints tokens with a different, unbounded `azp`. The single shared `CLERK_AUTHORIZED_PARTIES` value on the shared identity service cannot enumerate unbounded future `pr-{N}` origins → every preview 401s. The `*.commise.app` wildcard **cert** does not help; `azp` is not certificate-based.
- Re-routing the **identity service** (domain vs. path) changes nothing here — `azp` keys on the **web app's** origin, not the API's address.

## Decision

1. **Serve all sandbox web previews from one stable origin** — `sandbox.commise.app` — and select the PR via the **URL path** (and/or cookie), e.g. `sandbox.commise.app/pr-123/…`, **not** via a per-PR subdomain. This pins the sandbox `azp` to a single value (`https://sandbox.commise.app`) that `CLERK_AUTHORIZED_PARTIES` can list, so `azp` enforcement stays **on** in sandbox (matching prod's posture) rather than being disabled.
2. **Manifest query params select static resources (proposed sub-mechanism).** Because previews share one origin, the app resolves which PR's static bundle/assets to load from a **manifest query param** (e.g. `?manifest=pr-123`) rather than from the host. This is the agreed direction; the exact param shape is to be finalized during implementation.
3. **Mobile is exempt by nature.** `@clerk/expo` tokens have no browser Origin; `azp` is typically absent, and Clerk **skips** the check when `azp` is absent. Confirm per build by decoding a real token, but mobile does not drive this decision.

## Consequences

**Positive**

- `azp` enforcement remains enabled in sandbox (defense-in-depth parity with prod) without an unbounded allowlist.
- One sandbox web origin ⇒ one TLS cert path, one Clerk allowed-origin, simpler CORS.

**Negative / costs**

- No per-PR-isolated front-end URL. Previews share an origin, so they share ClerkJS browser/session state per origin — running several PRs' UIs truly in parallel in one browser profile is harder.
- The app must carry PR/manifest context in the path or a param and route on it — more app-side routing logic than host-based selection.

## Alternatives considered

- **Per-PR subdomains + prod-only `azp` enforcement** (disable `azp` on sandbox; require it only on prod-like stages). Lower app-side complexity and keeps isolated preview URLs. **Rejected** here in favor of keeping `azp` enforced in sandbox — but this remains the natural fallback if path-routing proves too costly. If you switch to it, the change is: relax `CLERK_AUTHORIZED_PARTIES` to be required only on prod-like stages in `env.schema.ts`, keep `CLERK_JWT_KEY` required everywhere (signatures still verified via the shared sandbox key), and update this ADR's status to _Superseded_.
- **Wildcard / pattern `azp`.** ~~Not possible — Clerk matches `azp` by exact string.~~ **Corrected (2026-07-12, see Update above):** the SDK matches by exact string, but `azp` enforcement is _our_ code — validating the signature-verified `azp` against an anchored regex ourselves makes bounded per-PR patterns viable with enforcement on. Combined with the dev instance reflecting any origin, this is what makes the subdomain migration the recommended path.

## Implementation guards

> **Migration in progress (2026-07-12, commit `330323a`).** The transition-safe subdomain slices have
> landed and are **OFF by default** — path routing remains the live posture until the human-gated cutover
> (see `docs/plans/2026-07-12-001-feat-sandbox-subdomain-migration-plan.md`). The router now ALSO serves
> `*.sandbox.commise.app` and resolves by Host-label first; the backend accepts the apex origin only when
> `CLERK_AZP_PREVIEW_MODE=transition`. Until cutover, the path-routing guards below still hold; `basePath`
> is retired last (plan U6/U7).
>
> **CUTOVER EXECUTED (2026-07-13).** The sandbox now serves previews on **subdomains**:
> `pr-{N}.sandbox.commise.app` at root, sandbox identity in **transition** mode (SSM
> `azp-preview-mode=transition`), Vercel/GitHub `SANDBOX_PREVIEW_MODE=subdomain`. The path form 404s by
> design. The guards below now describe the _rollback_ posture, not the live one. Remaining: the live
> `azp`-on-subdomain sign-in confirmation, then drain + tighten (`azp-preview-mode=strict`, retire path
> routing). See the plan's "Cutover — EXECUTED" section.

Path-routing guards are in place (`// ⚠️ DELIBERATE — see docs/architecture/decisions/0001`):

- `packages/apps/commise/web/next.config.ts` + `src/lib/base-path.ts` — the per-PR `basePath` derivation (do not drop it / move to subdomains).
- `packages/apps/commise/web/src/middleware.ts` — the prefix-aware Clerk matcher (do not "simplify" back to root-anchored patterns — it silently makes protected routes public).
- `packages/apps/commise/web/router/src/*` + `infra/lib/sandbox-router-stack.ts` — the host-swap router (do not switch to a prefix-stripping proxy or per-PR subdomains).

The **azp** tripwires the ADR originally listed — `clerkAuth.service.ts` (azp handling) and `env.schema.ts` (`CLERK_AUTHORIZED_PARTIES`) — are owned by the create-user-flow work (PR #39) and the `CLAUDE.md` "Deliberate decisions" entry; not duplicated here.

The **manifest/static-resource loader** guard lands with that deferred mechanism.
