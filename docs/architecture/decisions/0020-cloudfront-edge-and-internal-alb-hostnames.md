# 0020 — Every production service sits behind CloudFront, and the ALB moves to an internal origin name

- **Status**: Accepted
- **Date**: 2026-08-16
- **Drivers**: Owner ruling (2026-08-15), new scope — not derived from the PR 91 origin document. Every
  production service was reachable only through a bare internet-facing ALB with no edge in front of it. Two
  rounds of six-persona review found **two P0 defects with three-persona agreement** in the first version of
  this design, both of which would have shipped: caching recipe responses on a URL-only key leaks users'
  private recipes to each other, and rejecting tokenless requests at the edge breaks CORS preflight,
  `/health` and the GDPR erasure fan-out. Both are fixed below, and both are recorded rather than quietly
  corrected, because the shape of each mistake is the shape a re-derivation would take again.
- **Relates to**:
  [ADR-0002](0002-vpc-consolidation-and-cidr-scheme.md) — the export-in-use deadlock that makes the
  certificate ADDITIVE rather than amended;
  [ADR-0003](0003-shared-alb-per-stage.md) — the shared per-stage ALB whose listener these hosts attach to,
  and whose default action answers an unmatched host with `404`;
  [ADR-0001](0001-sandbox-front-end-addressing.md) — CloudFront's `Host` rewriting is the failure class that
  made PR 73's previews unreachable, and identity sits directly in that path;
  [ADR-0005](0005-environment-tagging-and-pr-cleanup.md) / [ADR-0010](0010-ensure-exists-per-pr-deploy-gate.md)
  — the per-PR preview machinery this ADR deliberately does not touch;
  [ADR-0011](0011-api-version-prefix.md) — the `/api/{version}/` prefix every path below assumes.

## Context

Three production services (identity, food, recipe) each answer on `{service}.commise.app`, resolved straight
to the shared per-stage ALB. There is no edge: no caching, no TLS termination ahead of the load balancer, no
place to attach a WAF later, and no request shaping. Food's nutrition responses in particular are
caller-independent and highly repeated — exactly the shape a CDN exists for — and after PR 91's KTD-3 the
recipe service fetches them over HTTP on every recipe read, so the same bytes are re-served continuously.

## Decision

**Public hostnames become CloudFront distributions; the ALB keeps answering on a new internal origin name.**

| Name                             | Serves                                                    |
| -------------------------------- | --------------------------------------------------------- |
| `{service}.commise.app`          | The CloudFront distribution (public, after U17's cutover) |
| `{service}.internal.commise.app` | The shared ALB directly (the distribution's origin)       |

**Production only.** No sandbox, no per-PR preview. A distribution takes 5–15 minutes to deploy and cannot
be deleted without first disabling it and waiting for propagation — which would wreck the ADR-0005 teardown
and the ADR-0010 ensure-exists deploy gate, both of which assume a preview's infrastructure can be created
and reclaimed inside a PR's lifetime.

**All traffic goes through CloudFront, including service-to-service** (owner ruling). Accepted consequence:
recipe→food becomes an internet round trip, and the GDPR erasure fan-out now depends on CloudFront being
healthy.

## The six things an implementer must not discover the hard way

### 1. The tension is caching versus AUTHORIZATION, not authentication

The first version of this design framed the problem as authentication and "resolved" it by verifying the
Clerk JWT at the edge and caching on the URL alone. **That is wrong and would have leaked private data.**
Verifying a token proves the caller is _someone_; it does not prove they may read _this resource_.

Recipe's read routes are owner-scoped from the token — `recipes.controller.ts` declares `@Get()` →
`list(ownerId, query)` — so **every user requests the identical URL and must receive different content**. A
URL-only cache key would serve the first caller's recipe list to every other authenticated caller.

**Decision — cache key per route class:**

| Route class              | Cache key                                           | Why                                              |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------ |
| Recipe, **owner-scoped** | URL **+ the owner extracted from the verified JWT** | The response varies by principal                 |
| Recipe, **public**       | URL alone, no owner component                       | Genuinely identical for everyone                 |
| Food, nutrition          | URL alone                                           | Caller-independent — an invariant food preserves |
| Identity                 | **Nothing is cached**                               | Every response is per-user                       |

The edge verifier extracts the owner from the verified token and injects it into the cache key. Food's
caller-independence is not a one-time test but a **standing invariant** its endpoint must preserve (plan U8),
because U16 keys its cache on the URL alone.

### 2. The edge must NOT reject every tokenless request

The first version specified exactly that. It would have blocked all browser traffic and failed every deploy.

- **CORS preflights carry no credentials by specification.** This repository has already encoded that exact
  failure once: `deployedSmoke.ts`'s `classifyPreflight` exists because "auth is running BEFORE CORS … every
  browser call is blocked even though the service is healthy to curl".
- **`prod-deploy.yml` curls `/health` unauthenticated and expects `200`.**

**Decision — a passthrough list, evaluated BEFORE verification:**

1. any `OPTIONS` request,
2. the `/health*` prefix,
3. the `/api/v1/internal/*` prefix (see trap 3).

### 3. Service-to-service traffic does not carry Clerk tokens

The erasure fan-out (`erasureFanout.ts`) POSTs to `{recipeBaseUrl}/api/v1/internal/account/erasure` carrying
a short-lived **EdDSA service token minted by identity** — not a Clerk token. A Clerk verifier rejects it,
the deletion worker rethrows, and SQS retries forever, silently re-breaking the exact GDPR path plan U1 and
U2 exist to repair.

**Decision.** The edge **exempts `/api/v1/internal/*`** and passes it to the origin, which performs its own
EdDSA verification. The prefix is a service-principal surface, not a public one.

### 4. The certificate must be ADDED, never amended

`DomainStack` builds one `acm.Certificate` whose ARN is exported as `${stackName}:CertificateArn` and
imported by `SharedAlbStack`, identity, webhooks, food and the web router. Changing its
`subjectAlternativeNames` **replaces the resource** and mints a new ARN — and ADR-0002 already records the
consequence: _"CloudFormation refuses to change an export while another stack imports it … A naive deploy
deadlocks on export-in-use."_

**Decision.** A **second, additive** `acm.Certificate` for `*.internal.commise.app`, with its own logical id
and its own export, attached to the shared HTTPS listener via `addCertificates`. The original is never
touched, and a test pins its exact SAN set.

⚠️ **The wildcard matches exactly one label.** `*.internal.commise.app` covers `food.internal.commise.app`
and nothing deeper. A two-label left side, or the transposition `internal.food.commise.app`, matches no
certificate on the listener and fails the TLS handshake — the same trap `foodSubdomainForStage` documents for
`food.pr-7` versus `food-pr-7`. The host is resolved by one function, `internalOriginForStage` in
`@kitchensink/infra-alb`, which returns the fully-qualified host and its zone-relative record name together
so the listener rule, the Route 53 record and the CloudFront origin cannot be spelled apart.

**Verified live, 2026-08-16** (account `040663841500`): certificate `d0b2de77-…` issued for
`*.internal.commise.app` in 162 seconds; the prod ALB presents it for a 3-label SNI host; all three internal
names answer `200` with `ssl_verify_result 0` and each returns its own service; an unmatched
`nope.internal.commise.app` still receives ADR-0003's default `404`.

### 5. "Internal" is a naming convention, not a network boundary — until it is made one

`*.internal.commise.app` is published in the **public** Route 53 zone and points at the **same
internet-facing ALB**. Removing the public host condition does not stop anyone who resolves the origin name
from reaching it directly and skipping the edge entirely.

**Decision.** Since all traffic now routes through CloudFront, **prod's ALB security group restricts `:443`
ingress to the `com.amazonaws.global.cloudfront.origin-facing` managed prefix list** (plan U17).

⚠️ **Prod only.** The ALB is per stage; sandbox and every per-PR preview have no distribution and must keep
reaching their ALB directly. Applying this lockdown to a non-prod stage takes every preview offline.

#### ⛔ Correction (U17, 2026-08-16) — the prefix list is L3/L4 hygiene, NOT the boundary

The Decision above, and the Alternatives row reading _"the prefix list buys most of it"_, both overstate
what that restriction delivers. **It authorizes CloudFront — not _our_ CloudFront.** The origin hostnames
are published in the public zone, so anyone can point their own distribution at
`food.internal.commise.app` and reach the ALB with the viewer-request verifier out of the path entirely.
AWS says so on the same page that recommends the pattern: the prefix list is listed as _optional_, and the
mechanism for "only through CloudFront" is a secret origin header — _"If the header name and value are not
secret, other HTTP clients could potentially include them in requests that they send directly to the
Application Load Balancer."_

**This is NOT an authentication bypass, and that distinction is the whole finding.** It was first raised as
one, and that was wrong. Every origin re-verifies the same bearer independently — identity's
`AuthMiddleware` on every route but `/health`, recipe's `AuthMiddleware` on `*` (`app.module.ts`, its one
exclusion carrying its own EdDSA `ServiceErasureGuard`), and food's `FoodAuthGuard` on both controllers.
And the header that would make a bypass catastrophic is already inert by construction: `x-edge-principal`
has **zero consumers in service code** (every occurrence is under `packages/infra/global/**`), it is an
opaque SHA-256 digest rather than an id, and the verifier **deletes any client-supplied copy before any
branch**. Skipping the edge costs the cache, edge rate-shaping, and a future WAF attachment point. It costs
no authorization.

So the severity is **Medium, not P0** — and the defect worth recording is in this document rather than in
the network: the two sentences above read as though the hole were closed, and the next engineer will
believe them. Most dangerously, the one who decides `x-edge-principal` can now be trusted as an identity
assertion _because_ "only our edge can reach the origin". The day that happens, a Medium becomes a total
auth bypass.

**What U17 shipped, and what it did not.** The prefix-list restriction is implemented and asserted;
`albHttpsIngressPrefixListFor` (`@kitchensink/infra-alb`) returns the list in prod and `undefined`
elsewhere, so absence is the prod gate. **The secret origin header is still owed** — a value generated by
CloudFormation into Secrets Manager, sent by every CloudFront origin via `customHeaders`, and required as
an additional condition on each prod listener rule, reaching both templates as a
`{{resolve:secretsmanager:…}}` dynamic reference so nothing secret enters this public repository. Until it
lands, the ALB is restricted but not bounded.

**⚠️ The lockdown was one line away from being decoration.** `SharedAlbStack` passed `open: true` to both
`addListener` calls — which is not a listener setting but a call to `allowDefaultPortFrom(anyIpv4())` on
the security-group construct `NetworkStack` creates and already opened. While both added the identical
rule CDK deduped them and it was invisible. Narrowing `NetworkStack`'s `:443` to the prefix list stops the
dedupe matching, and `open: true` re-emits `0.0.0.0/0:443` as a standalone ingress resource in
**`SharedAlbStack`'s** template — so the ALB stays open while `NetworkStack`'s template, its tests, and a
`cdk diff` scoped to the stack that was edited all show a correct lockdown. `NetworkStack` now owns every
ALB ingress rule and both listeners pass `open: false`; the assertions in `SharedAlbStack.test.ts` read
**both** templates, and restoring `open: true` reds them.

**⚠️ The security-group quota admits exactly ONE such rule.** A managed prefix list counts against
`L-0EA8095F` (default **60** inbound rules per security group) by its **weight**, not its current entry
count — 55 for CloudFront's, which held 46 entries when this was written. One rule fits with four to
spare; a second costs 110 and fails the deploy with `RulesPerSecurityGroupLimitExceeded`. So `:80` stays a
plain CIDR rule (it only redirects to `:443`, and protects nothing), the IPv6 list
`com.amazonaws.global.ipv6.cloudfront.origin-facing` can never be added at the default quota, and the ALB
must stay IPv4-only. AWS has raised this weight before (30 → 55) and does not retroactively invalidate
existing rules — the failure lands on the **next** modification of the group, and because `NetworkStack` is
the root of the prod dependency chain it presents as an `UPDATE_FAILED` blocking every prod infra deploy,
months later, looking nothing like the change that caused it. **Raise L-0EA8095F to 120 before relying on
this.**

**Verification inverts.** U15's proof was `curl https://food.internal.commise.app/health` → `200`. That
curl **is** the bypass. Once the header condition lands the same request returns ADR-0003's default `404`,
and the `404` is the PASS. A request from outside the prefix list is not testable from a laptop — you
cannot source-spoof a CloudFront address — so the meaningful check is
`curl -H 'x-commise-edge: wrong' https://{service}.internal.commise.app/health` → `404`.

**Revisit trigger — VPC origins.** CloudFront VPC origins are the correct end state and are rejected only
for now: they require the origin in a **private** subnet, and the shared ALB's scheme is immutable, so
changing it replaces the ALB and breaks the three `Fn.importValue` consumers of its DNS name, canonical
zone id and listener ARN — ADR-0002's export-in-use deadlock, across four stacks, in prod, mid-cutover.
U17 **creates its precondition**: after cutover CloudFront is the prod ALB's only legitimate internet
client. Do it as its own PR with its own no-diff proof. mTLS is not an alternative at all — CloudFront does
not present a client certificate to a custom origin.

### 6. `CLERK_JWT_KEY` reaches the bundle at BUILD time, from CI

Lambda@Edge cannot read environment variables, and this repository's
`ssm.StringParameter.valueForStringParameter` pattern resolves at **deploy** time — too late for an asset
bundled and hashed at synth.

**Decision.** CI reads the key from SSM and exports it **before synth**; the bundler inlines it. The key is
public, so nothing secret is embedded, and rotation is a redeploy rather than a commit. **Synth must fail
loudly when the variable is unset** — a stage that silently shipped a verifier with no key would reject
every request. Measured: `@kitchensink/clerk-verify` bundles to ~34 kB minified / ~13 kB zipped, well inside
the 1 MB viewer-request limit. Lambda@Edge deploys in `us-east-1` (which this account already is), and the
Node runtime is pinned explicitly because `@kitchensink/clerk-verify` declares `engines: node 24.x` while
Lambda@Edge offers no `nodejs24.x`.

**As built (2026-08-16, plan U16).** The key enters in exactly one place, `esbuild.mjs`'s `define`, and
`EdgeStack` refuses to synthesize unless (a) `CLERK_JWT_KEY` is set AND (b) a bundle exists AND (c) that
bundle contains the key it was handed. (c) is what makes the rotation runbook safe: a `dist-edge/` left over
from an earlier build carries the OLD key while synth reports success, which ships a verifier that rejects
every request in production. There is deliberately **no placeholder** — unlike `SandboxSchedulerStack`'s
throwing stub — because both stub directions are unacceptable at the edge: a throwing one is a total outage
of every fronted service, and a pass-through one leaves the cache-partition header unset, collapsing every
caller onto one cache entry (trap 1). Measured unminified at ~70 kB / ~19 kB zipped, and the bundle is not
minified on purpose so check (c) matches a plain string literal.

## Clerk key rotation is now an edge operation — the runbook step

A Clerk signing-key rotation used to be a redeploy of the origins, which read the key from an environment
variable. **The edge key is compiled into a versioned bundle**, so a rotation is now a two-part operation and
a partial one is an outage of both cached services:

1. Rebuild and redeploy the edge bundle with the new key.
2. **Wait out CloudFront propagation** before assuming the old key is gone.

Name who notices: Clerk's own rotation notice, or a periodic verification job. Without one, the first signal
is every authenticated request failing at the edge.

## Identity is fronted but NOT cached — kept by owner ruling, against three reviewers

Identity's distribution caches nothing. Its **origin request policy must explicitly forward `Authorization`
and `Origin`**: `AuthMiddleware` verifies the Bearer token itself and the `azp`/CORS enforcement reads
`Origin`. `CachingDisabled` controls **caching**, not header forwarding, so an unconfigured policy silently
strips them and breaks sign-in in exactly the ADR-0001 failure class.

### ⛔ Correction (2026-08-16, plan U16) — the viewer `Host` must NOT be forwarded

This section originally said identity's distribution "forwards the viewer `Host`". **That is wrong and was
not implemented**, because forwarding it breaks the ADR-0003 host-based listener rule at BOTH ends of the
cutover:

- **Before U17**, the viewer `Host` is the `d….cloudfront.net` domain. It matches no listener rule, so every
  request receives the shared listener's default `404` — which is precisely the pre-cutover verification
  this unit exists to make possible.
- **After U17 step 4**, the public host condition is REMOVED from the rule, so a forwarded
  `{service}.commise.app` matches nothing either. The two requirements are mutually exclusive.

What the original wording was protecting is the ADR-0001 failure class — an origin terminating on the wrong
host. That is real for a Next.js app (Clerk's handshake `redirect_url`, Next 15's Server-Action origin check)
and absent for these Nest APIs, which generate no absolute URL from `Host` and enforce CORS and `azp` from
`Origin` and the signed token.

**As built:** all three distributions use the managed `AllViewerExceptHostHeader` origin request policy,
which forwards every viewer header EXCEPT `Host` — so `Authorization` and `Origin` (this section's actual
requirement) are forwarded, and CloudFront sends the ORIGIN's own name as `Host`, which is what the listener
rule matches. A hand-rolled allowlist naming only those two headers would have been worse: it would also drop
`Content-Type`, breaking every request body. Pinned by `EdgeStack.test.ts`.

**Three reviewers objected to fronting identity at all**, and the objection is recorded here rather than
implied, because it is sound: identity's three stated benefits are respectively deferred (a WAF attachment
point — and this repository has twice declined WAF on cost grounds, `acceptedNagFindings.ts`,
`AwsSolutions-APIG3` and `CFR1`/`CFR2`), already provided by the ALB (TLS termination), and unspecified
(request shaping). Identity also sits directly in the Clerk auth path, which is where CloudFront's default
`Host` rewriting did the most damage in ADR-0001.

**The owner ruled to keep it.** It cuts over **last** (plan U17), after food and recipe are proven, so the
service carrying the auth path is the one with the most evidence behind it when it moves.

## Consequences

- **Production becomes the only stage exercising the edge path.** Every edge-specific failure — `Host`
  rewriting, CORS, `azp`, a cached `401`, a cold start — is discoverable only in production, on a 5–15 minute
  deploy loop. This is a direct consequence of the prod-only ruling, recorded so it is chosen rather than
  stumbled into. U16 verifies against the distribution domain **before** DNS moves, which is the only
  pre-cutover rehearsal available.
- **The GDPR erasure path now depends on CloudFront.** Mitigated by trap 3's exemption, and by a U17 test
  scenario that exercises a real erasure **after each cutover** rather than assuming one.
- **recipe→food is an internet round trip.** Accepted; food's responses are cacheable at the edge, which is
  most of why the distribution exists.
- **A Clerk rotation is an edge operation.** See the runbook step above.
- **The public names keep working throughout U15 and U16.** Nothing cuts over until U17, one service at a
  time, verified between each.

## Alternatives considered

| Alternative                                                   | Why not                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No edge; keep the bare ALB                                    | The status quo. Leaves food's highly-repeated, caller-independent responses uncached and gives no future WAF attachment point.                                                                                                                                                                                                                                       |
| Edge for food only                                            | Genuinely defensible — food is the only clearly cacheable service. Rejected by owner ruling; recorded above with the reviewers' objection.                                                                                                                                                                                                                           |
| Amend the existing certificate with a `*.internal` SAN        | Deadlocks on export-in-use (ADR-0002). This is trap 4.                                                                                                                                                                                                                                                                                                               |
| Verify at the origin instead of the edge                      | Then the edge cannot key a cache per principal without trusting an unverified token, and trap 1 becomes unsolvable.                                                                                                                                                                                                                                                  |
| Cache owner-scoped routes on the URL alone                    | The P0 data leak of the first design. Not an alternative — a defect.                                                                                                                                                                                                                                                                                                 |
| Reject all tokenless requests at the edge                     | The second P0: breaks CORS preflight, `/health` and the erasure fan-out. Not an alternative — a defect.                                                                                                                                                                                                                                                              |
| Make `*.internal` a private zone / genuinely internal network | Would make trap 5 unnecessary, but the ALB is internet-facing by ADR-0003 and moving it is a much larger change. ⛔ **The claim that "the prefix list buys most of it" is WRONG — see the U17 correction in trap 5.** The prefix list authorizes CloudFront, not ours. CloudFront VPC origins are the real form of this alternative and are deferred, not dismissed. |
