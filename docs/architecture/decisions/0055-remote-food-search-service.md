# 0055 — Remote food search runs through a dedicated search service behind a long-lived cache, and food-service calls it

- **Status:** Accepted (owner ruling).
- **Date:** 2026-10-02
- **Amends:** [ADR-0046](0046-apps-search-food-directly.md) Decision 2: the app reads one progressive answer, and
  food-service, not the client, composes the groups.
- **Relates to:** [ADR-0017](0017-service-ownership-for-features-006-007-009-010.md): the "no new deployable" default
  this decision is an exception to. [ADR-0053](0053-external-source-access.md): how a source is reached and its limits
  declared. [ADR-0020](0020-cloudfront-edge-and-internal-alb-hostnames.md): the edge cache in front of food-service.
  [ADR-0004](0004-minimize-nat-egress.md): how a service reaches the internet.
  [ADR-0014](0014-service-owned-api-contracts.md): who owns a wire contract.
  [ADR-0027](0027-ingredient-phrase-is-not-personal-data.md): an ingredient phrase is not personal data.
  [ADR-0054](0054-session-seam.md): the session seam the apps read through.
- **Plan:** `docs/plans/2026-09-20-002-feat-ingredient-lookup-grain-and-food-search-decoupling-plan.md`, section 4.8
  (R62 to R67) and unit S7, which replaces S5.4.

## Context

Ingredient search reads our own catalog. A cook can also press "Search USDA". That makes one live call to USDA, the
only source wired for live search (`WIRED_SOURCE_IDS` in `food-service/src/sources/foodSourceAdapter.ts`). The other
sources in the register are files whose data the seed already holds.

The button exists because of one limit. The USDA key allows about 1,000 calls an hour (ADR-0053). Every cook and every
preview that holds the same key share them, and each live search spends one. A search on every keystroke spends that
window.

Four places record that live search must stay an explicit action: `liveSearch.service.ts`, its unit test,
`foods.controller.ts` and `liveIngredientSearch.model.ts`. Their reason is the line "even a PERFECT
one-call-per-settled-query autocomplete would want ~3x the entire key". That arithmetic assumed that every settled query
costs a call. A cache changes the
premise: a query costs a call only the first time it is asked in a cache lifetime. For a query that nobody asked yet, the
arithmetic still holds, so that source can report busy. Our own database's results are never held back by it.

The owner ruled that the button is poor UX, and set the design. Verbatim: _"we should be searching all remote services,
flowing them in as the results come back, rather than having a specific button - that's poor UX. What's likely best is
that we have a dedicated service for searching that effectively proxies all remote sources and has a CDN with cache in
front it to reduce live requests against the remote services with a very long TTL."_ And: _"the food service should
call this search service; not the client since the food service is where the business logic around deduplication and
updating food/IDs and handling selection lives."_

## Decision

1. **A dedicated search service proxies every remote source that can search, for the searches a cook makes.** If its
   register entry declares remote search (ADR-0053), a source qualifies. USDA qualifies today. A source joins by
   its register entry and an adapter, not by a change to the callers. The service only searches: it holds no catalog,
   no foods and no cook data. The worker's add-by-name keeps calling the source through food-service's own transport.
   Both paths read one statement of each source's search parameters (data types, page size), so they cannot ask a
   source for different candidates. USDA's statement is the JSON body of a `POST /v1/foods/search`. Measured on
   2026-10-03, USDA answered `400` to 38 to 75% of GET searches whose `dataType` filter named `Survey (FNDDS)`. All
   40 POSTs with the same filter succeeded and kept the FNDDS hits.
2. **A read-through CDN with a long lifetime sits in front of the search service.** It keeps a found answer for 7
   days and an empty one for 1 day. The cache key is the contract version, the source, the adapter's revision and the
   canonical query, and nothing else. Every error, timeout and rate-limit answer is `no-store`, every error-caching
   TTL is 0, and CloudFront makes one attempt per origin request. A changed request gets a new key, and nothing is
   invalidated. The cache holds only our canonical form of what a source said. Food-service decides about our catalog
   fresh on each search (point 4).
3. **Food-service calls the search service. The apps never do.** The apps keep calling one food-service search
   endpoint (ADR-0046). The search service is not reachable from a browser or the mobile app.
4. **Food-service owns everything that concerns our catalog.** It searches our database (the catalog and the cook's
   own foods), asks the search service for remote results, and then:
    - It hides a remote hit for a food our catalog holds: one the catalog owner reader answers (an owner, an exact
      citation, a lineage or a variant), or one whose root name a live catalog root that holds a record already
      carries, because a pick of it answers that root. When that food is not in this answer's catalog results, it records a search
      gap: the query, the source, the item and the food, with a count and no user (ADR-0027). A curator adds the
      wording as a synonym on the root in the seed.
    - It hides a remote hit for an item our catalog retired without a forward, and refuses to adopt one.
    - It shows no variants from a remote source. Variants come only from our seed (R64).
    - It turns a picked remote food into a new root, with its own id (R64).
    - It keeps the source limits (point 6). A miss spends the shared window and the cook's hourly budget, per source.
      A cook at their limit still gets cached answers, and that source's frame says so. A remote call is never
      retried automatically (R65).
5. **The search endpoint answers progressively.** It sends our database's results first, then each remote source's
   results as they arrive, then a completion marker. The app's list shows a loader, and foods fill in above it as
   they arrive. When the response completes, the loader goes. This replaces the S5 list contract's single settle
   (`docs/design/rowEditorOpenDecisions.md`, "S5 list contract"), which `staff-ux-engineer` amends.
6. **Admission stays in food-service, and a cache hit spends nothing.** Food-service asks the CDN with admission off.
   A miss reaches the search service, which answers "not admitted" without calling the source. Food-service then
   admits the call and asks again with admission on. The search service echoes food-service's request id, and a quota
   reading or a block is applied only from a response that echoes it. A call that was admitted runs to completion.
   This is ADR-0053 §3 across a process boundary. A cached answer replays the quota headers it was stored with, and an
   old quota reading must never write a block.
7. **Only food-service can use the CDN.** Every request is a CloudFront signed URL. The admission flag and the request
   id are signed, forwarded to the origin, and kept out of the cache key. The origin is a function URL that accepts
   only this distribution (origin access control). Each base stage (prod, and sandbox for every preview) holds the
   distributions' signing key and key group, cache policy, origin request policy and origin access control in one
   shared global stack, and every copy at that base uses them, because CloudFront caps each of these per account.
   The key rotates by generation. Both generations are trusted until every food task holds the new one, a pipeline
   check refuses to drop the old generation while any task definition still names it, and a retained secret is deleted
   by hand.
8. **The search service is a function with no VPC attachment, deployed, managed and tested exactly like the other
   services.** The owner, verbatim: _"Make sure that the search service is being deployed and managed and tested
   exactly like all the other services."_ So it has a copy per stage, one per pull request included, like food,
   with food's deploy gate (ADR-0010), smoke checks, tagging and teardown (ADR-0005) and test tiers. Food at each
   stage calls its own stage's copy, so food deploys after it. Search refuses any adapter revision but its own, so a
   revision change deploys search first and then food, in one pipeline run. Like the other services it has a hostname
   under the domain (`remote-search.commise.app`, and `remote-search-pr-{N}.commise.app` per preview) on the domain
   stack's existing certificate, which also keeps its address stable when a stack is recreated. ADR-0020's edge is
   production-only because a distribution per pull request is slow to create and delete. The owner accepted that
   cost here, so each preview tests its own search-service changes. Its deploy gate reads an unsigned request's `403`,
   the CDN's refusal, as a serving copy, as food's reads `401` (ADR-0010).
9. **The progressive answer is newline-delimited JSON.** One frame holds both database groups. Each remote source
   sends one frame (answered, busy, the cook's limit, or unavailable). A completion frame ends the answer, and a body
   without one is incomplete. Clients ignore unknown frames, split on the newline byte, and are correct when frames
   arrive together. The body ends at the completion frame, and search gaps are recorded after it, so a slow write never
   holds the app's loader.
10. **A remote food is picked by a sealed reference that food-service issued**, never by the source's key. One command
    returns the root's id, makes at most one source call, and is idempotent on the source and its key.
11. **S3's two search routes stay** for the tools that read them. The answer's database frame calls the same reads.

## Consequences

- One more deployable: a function and a distribution per stage, deploy jobs and a schema package. It adds no ECS
  task, ALB rule, database or NAT consumer. The exception to ADR-0017 rests on the owner's ruling.
- The shared window is spent only on misses: at most one call per source per cache lifetime at one edge location.
  CloudFront can evict a rare query sooner.
- A new remote food can take up to 7 days to appear for a query that is already cached.
- The "Search USDA" button, U29's "an explicit action, not autocomplete", S5.4 as first planned, R40's client merge and
  ADR-0046 Decision 2, curated R19's display of held hits, and the S5 list contract's single settle, live-search
  option and live limit state are superseded.
- The app's catalog search no longer uses food-service's edge cache.
- The progressive answer and the remote pick command are wire contracts and one-way doors once a mobile build ships.
  Their shapes are designed once, in S7, before any app reads them.
- Streaming through the production edge cannot be tested before go-live.
- A preview's first deploy and its teardown each wait for a distribution to be created or deleted, and each preview
  starts with an empty cache.
- The search-gap record becomes the way synonyms are found. Each hidden remote hit names wording our catalog lacks.
- CloudFront refuses a bad signature before the function runs, so the function's own alarms cannot see that outage.
  Food records how every remote search ends and alarms on the unavailable rate, and every search deploy sends one
  signed probe that must come back as "not admitted" with its own echo.
