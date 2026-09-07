# 0033 — Sandbox previews are addressed by per-PR subdomain, resolved directly to Vercel

- **Status:** Accepted
- **Date:** 2026-07-13
- **Supersedes:** [0001](0001-sandbox-front-end-addressing.md) — decisions 1 and 2 (one shared origin, PR selected by URL path)
- **Area:** sandbox deploy topology · web serving · Clerk `azp` enforcement · Route 53 / Vercel domain lifecycle
- **Related:** `packages/shared/clerk-verify/src/clerkVerify.ts` (the anchored `azp` predicate), `packages/apps/commise/web/scripts/createPreviewDomain.ts` and `teardownPreviewDomain.ts`, `.github/scripts/teardown-sandbox-pr.sh`, [ADR-0005](0005-environment-tagging-and-pr-cleanup.md) (per-PR teardown)

## Context

ADR-0001 chose one shared sandbox origin with the PR selected by URL path, and it rested on a single
inference: Clerk matches `azp` by exact string, so per-PR subdomains would each mint an unbounded `azp` that
a shared allowlist could not enumerate, and every sandbox sign-in would 401.

That inference was overturned by measurement, in two parts.

- **The exact-match is OUR code, not a Clerk constraint.** `@clerk/backend` compares `azp` against a list
  only because we pass `authorizedParties`. On preview stages we do not: the signature-verified `azp` is
  validated against an **anchored regex** instead, so a bounded family of `pr-{N}` origins is admitted with
  enforcement fully ON — no wildcard is ever handed to Clerk.
- **The dev instance is not origin-restricted anyway.** Probed live: the sandbox Frontend API reflects
  **any** `Origin` in `Access-Control-Allow-Origin` with `allow-credentials: true`, including an unrelated
  one. Clerk's "allowed subdomains" toggle is production-instance-only. That is precisely why our own
  regex check is the real trust boundary on sandbox, rather than a belt-and-braces addition to one.

Path routing also carried costs ADR-0001 recorded as accepted: previews shared ClerkJS browser and session
state per origin, so several PRs' UIs could not run truly in parallel, and the app had to carry PR context
in the path and route on it.

## Decision

### 1. A preview is `https://pr-{N}.sandbox.commise.app`, served at ROOT

No `basePath`. The older path form (`sandbox.commise.app/pr-{N}`) returns 404 **by design**, as does the
apex root. The addressing form is selected by `SANDBOX_PREVIEW_MODE`.

### 2. `azp` enforcement stays ON, against an anchored, dot-escaped pattern

`resolveAzpEnforcement` builds `^https://pr-\d+\.{base}$` (or, in `transition` mode, a form that also admits
the legacy apex origin during migration). Only the exact string `transition` relaxes it; any other value
stays strict, so a mistyped environment variable can never silently widen the boundary.

⚠️ Prod is unaffected and stays on exact-match `azp` against a single origin.

### 3. The preview hostname resolves DIRECTLY to Vercel, not through CloudFront

This is the part that took two failed designs to reach, and both failures are recorded because each looks
like the obvious fix.

The router fronted previews with CloudFront and swapped the Host header, which left the Next app
terminating the **Vercel deployment host** rather than the public preview origin. Three symptoms followed
from that one cause: Clerk's handshake built its `redirect_url` from the app's host and dead-ended at
Vercel's SSO login; Next rejected every Server Action with a 500, because its CSRF check refuses
`Origin !== Host` before it looks the action up; and clerk-js failed to load as a consequence of the first.

⛔ **`x-forwarded-host` does not rescue this** — the CloudFront function already sets it and Vercel
overwrites it with the Host it terminates. ⛔ **Nor does switching the router to `ALL_VIEWER`** — Vercel
answers `404 DEPLOYMENT_NOT_FOUND` for an unregistered name, and `403 x-vercel-mitigated: deny`
(anti-domain-fronting) when SNI and Host disagree.

⛔ **Registering the alias while keeping CloudFront in front is impossible**, and the two constraints close
the loop on each other: Vercel refuses to issue a certificate until the hostname already resolves to Vercel
(`449 http_pretest_domain_not_resolving_to_vercel_error`), and refuses the alias until a certificate exists
(`400 cert_missing`).

So the name resolves to Vercel: a Route 53 `CNAME → cname.vercel-dns.com`, a Vercel project domain, and an
explicit **per-deployment alias**. A registered custom domain is exempt from deployment protection, which
retires the bypass token, the KVS route and the router distribution for the preview path.

### 4. CI owns the address lifecycle, because CloudFormation owns none of it

Creation runs on every non-closed PR event; teardown runs FIRST in the cleanup script, before any stack
delete (which can hang for many minutes).

**The two orders are deliberate mirrors and must not be "simplified".** Teardown deletes DNS **before**
releasing the Vercel claim; creation takes the claim **before** publishing DNS. The takeover window is
exactly "the record resolves to Vercel while nobody claims the name", so an interruption may only ever leave
the safe half-state, and a failure in the first step aborts before the second.

**Creation's alias comes LAST and is retried**, for the certificate reason in §3 — the alias is only
_possible_ after DNS resolves — with a bounded retry treating exactly those two failures as "not yet" and
every other status as permanent. It re-runs on every push on purpose: an alias pinned to one deployment is
what left PR #73 serving a stale build for fifteen days.

Absent and already-correct records are **success** in both directions, so a PR that never had a preview and
a re-run of a completed teardown are both green. A `409` for a domain held by a **different** Vercel project
fails loudly, because publishing DNS for a name we do not own is the takeover shape itself.

⛔ A Vercel **branch domain** (`gitBranch`) is not a substitute for the alias — measured, it re-enables
deployment protection.

### 5. DNS scope is exact first-label equality, defined once

`pr-{N}` only; `pr-{N}-…` does **not** qualify in DNS. The rule lives in `previewDomainScope.ts` and is
re-asserted inside every adapter of both commands, because the same zone holds the apex, the `*.sandbox`
wildcard, ACM validation records, and `identity.sandbox.commise.app` — the single shared identity service
every preview signs in against. `ListResourceRecordSets` starts at-or-after the requested name, so its page
routinely contains that shared host; only an exact match enters the change batch.

## Consequences

- Previews are isolated per PR: separate origins mean separate ClerkJS browser and session state, so several
  PRs' UIs run in parallel without interfering.
- The web app no longer carries PR context in its path, and the `basePath` machinery becomes removable.
- **The `azp` regex is the whole trust boundary on sandbox.** The dev instance accepts any origin, so
  weakening or disabling the check there is not defence-in-depth being trimmed — it is the only control.
- **A preview's address is not in any CloudFormation stack**, so it cannot be reclaimed by deleting one. The
  daily reaper therefore discovers candidates from Route 53 as well, since a web-only PR owns no stack, ECR
  repository or log group and its dangling CNAME would otherwise be invisible forever.
- Prod is unaffected — single origin, exact-match `azp`, no per-deployment aliasing.

**Residual risk**

- The per-PR Route 53 record is more specific than the `*.sandbox` wildcard and wins by longest match. A
  future record that is more specific still would silently take precedence over it.
- `transition` mode admits the legacy apex origin. It is a migration posture, not the end state; tightening
  to strict is owed once the path form has drained.
