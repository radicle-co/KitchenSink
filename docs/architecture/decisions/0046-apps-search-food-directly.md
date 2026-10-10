# 0046 — The apps search food-service directly, and recipe-service leaves the search path

- **Status:** Accepted
- **Date:** 2026-10-02
- **Relates to:** [ADR-0047](0047-shared-cors-policy.md): the CORS policy food adopts for its new browser boundary.
  [ADR-0020](0020-cloudfront-edge-and-internal-alb-hostnames.md): the production edge, its cache keys and its own 401.
  [ADR-0045](0045-ingredient-lookup-and-unresolved-foods.md): the lookup a search result binds to.
  [ADR-0053](0053-external-source-access.md): the one USDA budget that every cook and the worker spend.
  [ADR-0014](0014-service-owned-api-contracts.md): the food contract the apps now depend on.
- **Plan:** `docs/plans/2026-09-20-002-feat-ingredient-lookup-grain-and-food-search-decoupling-plan.md` (US9, R38 to
  R44, KTD-9, KTD-10, Phase II S1 to S6, §12, §15)

## Context

The ingredient picker searches through recipe-service. Three recipe routes forward to food-service:
`/ingredients/suggest`, `/ingredients/search/live` and `/ingredients/authored-food`. Food-service already holds the
ingested catalog and the remote source search. The extra hop adds latency, and it ties typing an ingredient to
recipe-service's deploys (US9).

The proxy is not a pure pass-through. It carries three things, and each one needs a home before the proxy goes
(plan §6.4):

- a per-user rate cap,
- the scoping of a cook's private foods to their owner,
- the degraded-catalog signal that the picker shows when it cannot reach the catalog.

Search terms repeat across cooks, so a shared cache serves most catalog searches without reaching food-service's database. It saves no source calls: the catalog route reads only Postgres, and the live source search stays uncached.
But today's search varies by caller, because a cook sees their own authored foods. A URL-keyed cache on that route
serves one cook's private food to another (R40). One route cannot be both shared-cacheable and per-caller.

Food-service has never been reachable from a browser. Making it reachable adds three things: an origin per stage
and per preview, a CORS boundary, and a public contract that a released mobile binary then depends on.

## Decision

1. The apps call food-service directly for ingredient search (R38), and recipe-service does not proxy it (R39).
   Recipe keeps `/ingredients/search`, the recipe filter's list of foods that some recipe binds, because that is a
   read of recipe data, not a proxy.
2. Food splits search the way it already split nutrition (R40). A catalog-only route is keyed on its URL and is
   shared-cacheable. The per-caller routes (a cook's authored foods and the live source search) answer
   `private, no-store`. The client merges the two.
3. The three things the proxy carried move before the proxy is deleted:
    - The per-user cap moves to food-service. A cache miss on the shared catalog route still reaches food with the
      cook's bearer, so food throttles that route per user at the origin (it only ever sees misses), with a throttle
      and no source budget, because that route makes no source call. The resolve route and the progressive search's
      remote calls (ADR-0055), which do call a source, also charge a per-user hourly source budget that binds across every task, because every cook
      and the worker spend one USDA window.
    - Owner scoping moves to food-service. The per-caller search reads only the caller's own rows in its SQL
      (`SearchScope` in `foodSearch.dao.ts`), and a by-id read applies the authorship policy
      `GET /api/v1/foods/{id}` already applies.
    - The degraded-catalog signal moves to the app's client, which sees the failed call itself.
4. Food adopts the shared CORS policy (R41, ADR-0047). The production edge keys its shared cache on `Origin` for
   every CORS-enabled cached path, so a request with no `Origin` cannot fill the cache with an answer a browser
   then blocks. The edge's own 401 carries the same CORS headers as the origin's. A browser then reads a refused
   bearer as a 401, not as a network failure.
5. The order is fixed where a step depends on another:
    - S1 extracts the shared CORS policy, as a refactor with no new boundary.
    - S2 lands the deployed preflight proof before the boundary it proves (R44).
    - S4 opens food's browser boundary behind a `sec-aud-1` review: food's CORS, and the shared edge cache keyed on
      `Origin`.
    - S3 adds the split search (a shared catalog route and a per-caller authored route) and the per-user caps, and
      adds the catalog route's exact paths to the edge's shared patterns in the same change. It lands after S4,
      which is safe because S4 already keys every shared path on `Origin`.
    - S5 needs S3 and S4. It gives the apps food's origin per stage and per preview, and moves the picker's hooks
      onto it (R43).
    - S6 deletes the proxy. It waits for S3's caps, because without them the deletion removes the only rate control
      on the path.
6. S5 is the point of no return. Before S5, every step is a server change that a redeploy reverses. After S5, a
   released mobile binary calls food's origin, routes and contract directly. Mobile ships on its own schedule, so a
   server deploy cannot withdraw that dependency. Before S5 reaches production, the edge 401 carries CORS headers
   and each stage's food origin is set for the web build and the mobile build.

## Consequences

- A recipe-service deploy no longer interrupts ingredient search, and each search makes one hop, not two.
- The shared cache absorbs repeated catalog searches, which lowers database load. It does not lower USDA calls.
- Food-service becomes browser-facing for the first time. It inherits ADR-0047's precondition: it stays bearer-only,
  with no cookie, no session read and no WebSocket upgrade.
- Each stage and each preview gains a third service origin that the web and mobile builds must be given.
- The food contract becomes a public API that mobile pins. A breaking change to it needs the same care as a change
  to the recipe contract (ADR-0014).
- A half-landed Phase II stops ingredient search. The fixed order in decision 5 is the control, and S5 is where
  rollback stops being a redeploy.
- The deployed preflight proof runs only while a preview's sandbox is up. Raising the sandbox on the change that
  carries S5 is a human step, not a gate.
- A per-user cap bounds one account. It does not bound many accounts owned by one person, and that limit is
  separate work.
- `POST /api/v1/foods/{id}/corroborated` trusts any signed-in caller, because recipe-service forwards the cook's
  bearer and holds no service credential for food. Closing that needs a service credential or a signed attestation,
  which is a separate decision.
