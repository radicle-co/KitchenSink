# Home Widget Architecture — Research & Options

**Date**: 2026-07-05
**Status**: Research / option-space exploration (input to 001 reconciliation)
**Problem owner**: 001-commise-recipe-app (US-0 / FR-046, the post-login Home screen)

## Problem statement

The Home screen must be a surface of **widget-like cards** (recent recipes, meal-plan summary,
nutrition snapshot, shopping-list status, AI suggestion, resume-cooking, …). We want:

1. **Self-registration, no central config file.** When a feature is added to the product, its
   Home widget should appear **without a human editing a central registry/manifest by hand.** The
   source of truth for "this feature has a Home widget" should live **with the feature**, not in a
   list someone must remember to update.
2. **Cross-platform, one contract.** Every widget must render on **both** the Next.js 15 web app
   and the Expo 53 / React Native mobile app (constitution parity rule).
3. **Reordering + personalization.** Users can reorder, hide, and (later) resize widgets; their
   layout persists across devices.
4. **The endgame is a real React component.** Whatever the discovery/layout mechanism, it must
   terminate in an actual React component being mounted — using the dynamic tools available
   (`React.lazy` + dynamic `import()`, `next/dynamic`, Suspense), not a frozen JSON renderer.
5. **Degrade gracefully before dependencies exist.** Five of the six v1 widgets are backed by
   services (005–009) that are not built yet. A widget whose backing service is absent must simply
   not appear — not error, not show a dead tile.

## DECISION (2026-07-06) — final architecture

_This supersedes the option exploration below; the rest of the doc is the rationale that led here._

**Home = a widget surface, three layers:**

- **Discovery** = explicit startup registration (a .NET-Core-style composition root, `.use(addFeature)`). NOT build-time codegen or `require.context` — pure code, portable across every bundler.
- **Composition** = `curateHomeWidgets(widgets, ctx)`, a pure function: gate by **capability** (feature flag: is the backing service live) + **subscription tier**, order by **personalization**. Capability gating is what lets Home ship with only the recipe widget live — 005–009 auto-appear as they deploy.
- **Render** = `React.lazy(reg.load)` + `Suspense` + `ErrorBoundary`; unknown ids skipped.

**DI container:**

- **Frontend → ditox** (`ditox`) + `@ditox/react`. Token-based (`token<T>()`), typed, decorator-free, esbuild/Hermes-safe, singleton/scoped/transient + child scopes. Provider = `CustomDependencyContainer` (injects the pre-built startup container); hooks = `useDependency(token)`. **RSC/server uses the core `ditox` container directly** (hooks are client-only). Widget list via `bindMultiValue` → `resolve(HomeWidgetsT)`.
- **Backend → keep NestJS decorator DI** (already has metadata via `nest build`/tsc). Frontend token DI ≠ backend decorator DI — that asymmetry is intentional and fine.

**Feature packages:** `packages/apps/commise/features/<name>` published as `@commise/features-*`. Exports: `.` (definition + widget metadata), `./widget/web`, `./widget/mobile`, plus component building blocks. **No page exports** — the apps compose pages. Platform files use **`.native.ts(x)`** (CODING_STANDARDS §14; never `.mobile`).

**Loader seam (forward-compat):** widget registration carries a **loader** — `load: () => import('@commise/features-*/widget/{web|mobile}')` — not a component. A widget can later become a Module Federation remote (`load: () => loadRemote(...)`) one line at a time.

**Bundlers:** web = Next.js (RSC/SWC — its own pipeline, the accepted esbuild exception). Mobile = **Metro** + `@rnx-kit/metro-serializer-esbuild` (tree-shaking) + esbuild minify. **Stay on Metro**; Re.Pack only if we later adopt Module Federation — the explicit-registration + loader seam make that an extension, not a rewrite. EAS Update covers no-app-store-release JS changes.

**appShell = the ditox container, available everywhere** (server: module-singleton core container; client: `CustomDependencyContainer` + hooks). Per-request child scope seeds `user`/`entitlements`/`prefs`. Holds ambient singletons (logger, analytics, errors, clients, config, flags, nav, ui, storage, i18n, query, clock, ids) + feature contributions (widgets, routes, searchProviders, settingsSections, quickActions, notificationHandlers, deepLinks, onboardingSteps).

**Open validation spikes:** (1) `@ditox/react` `CustomDependencyContainer` + hooks across the Next RSC/client boundary; (2) pin `ditox` (single maintainer); (3) esbuild serializer + Metro under Expo 53.

## The three orthogonal layers

The mistake in the current 001 plan is treating "the Home screen" as one thing. It is three
separable concerns, and each can use a different pattern:

| Layer              | Question                                                                             | Where it can live                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **L1 Discovery**   | _What widgets exist in this build?_                                                  | build-time codegen · side-effect registry · server manifest · backend self-advertise             |
| **L2 Composition** | _Which widgets, in what order, for THIS user — and are their backing services live?_ | client defaults · per-user layout in a DB · server BFF that gates by capability + tier           |
| **L3 Render**      | _Given a widget id, mount the real React component_                                  | client `id → component` registry + dynamic import + Suspense (**unavoidable on every platform**) |

The key realization from prior art (below): **L3 is unavoidable and must exist on the client no
matter what L1/L2 do.** No mainstream system ships executable UI from the server; they all keep a
client-side `type → component` map and send _data + an ordered list of type ids_. So the design
question is really: _how do we keep that client registry from being a hand-maintained central
file, and how do we drive its ordering/personalization?_

## Cross-platform feasibility filter (the hard constraint)

From the mechanics research — what actually works across **webpack / Turbopack (web)** AND
**Metro (mobile)**:

| Mechanism                                                                    | Web                                              | Metro/RN                                                                                  | Verdict                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Build-time codegen** → static `registry.generated.ts` with literal imports | ✅                                               | ✅                                                                                        | **Only byte-identical-portable option.** Emit static ESM; every bundler treats it the same.        |
| `import.meta.glob`                                                           | ❌ (Vite-only)                                   | ❌                                                                                        | N/A to this stack                                                                                  |
| `require.context`                                                            | ⚠️ webpack yes; Turbopack caveats ([next#78019]) | ⚠️ only behind Metro `transformer.unstable_allowRequireContext` (Expo enables by default) | Works but via **two non-portable code paths**; strictly worse than codegen                         |
| Side-effect `registerWidget()` at import                                     | ⚠️ tree-shaken unless imported                   | ⚠️ same                                                                                   | **Doesn't solve discovery** — still needs the import edge from codegen/context                     |
| Module Federation (web) + Re.Pack (RN)                                       | ✅                                               | ✅ (Re.Pack 5 / Rspack, MF2)                                                              | **Runtime remotes** — means dropping Metro for Rspack on mobile; overkill now, keep as future path |
| Dynamic `import()` + `React.lazy` (the **render** primitive)                 | ✅ (`next/dynamic` or `React.lazy`)              | ✅ (Metro supports `import()`)                                                            | **Portable.** This is how L3 mounts real components.                                               |

**Consequence:** L1 discovery → **codegen**. L3 render → **`React.lazy` + dynamic `import()`**. Both
portable, no unstable flags, no bundler lock-in. Everything else is an L2 choice layered on top.

**Consequence #2 (repo reality):** because web (RSC/Tailwind) and mobile (Tamagui/RN) do **not**
share a component runtime, a widget is **two implementations behind one id/contract** —
`widget.web.tsx` + `widget.native.tsx`. The codegen emits **two** registries (web imports `.web`,
mobile imports `.native`). The shared _contract_ (id, props, data types) lives in a types package.
This is exactly the `.native.tsx` convention CLAUDE.md already mandates (none exist yet — this
would be the first).

## Prior art (what established systems actually do)

**Self-registration / extension-point systems**

- **VS Code** — declarative `contributes` in each extension's `package.json`; host scans all
  manifests at startup and merges into a contribution table **before** any code runs. _Split
  declaration (always loaded) from implementation (lazy)._
- **Eclipse/OSGi** — host defines an extension point; plugins contribute via `plugin.xml`; a
  singleton **registry** is built by scanning descriptors; classes instantiated lazily. The
  ur-pattern everything descends from.
- **WordPress** — lived through our exact migration: imperative `register_widget()` side-effect
  calls → declarative `block.json` metadata scanned by the host. Hooks carry an explicit integer
  **priority** (cleanest ordering model).
- **Shopify Theme App Extensions** — app ships a block with a `{% schema %}`; the theme exposes a
  generic `@app` slot; the **merchant drags widgets into slots** in a visual editor, persisted per
  store. _Host defines slots; end-user does placement._
- **Backstage (new frontend system)** — plugins export extensions via typed **blueprints**
  (`attachTo: {id, input}`); adding a plugin to `package.json` auto-installs its extensions; an
  `app-config.yaml` overlay enables/disables/reorders **without touching feature code**.
- **Grafana / Home Assistant Lovelace** — panel/card **plugin registry** + layout-as-data
  (`panels[]` with `gridPos`; Lovelace custom cards self-register via `customElements.define` +
  `window.customCards`). Per-user layout is an editable document seeded from a default.

**Server-driven UI / widget feeds (cross-platform, personalized)**

- **Airbnb "Ghost Platform"** — server returns `sections[]` + per-form-factor placement
  referencing sections by id; **one shared GraphQL schema** is the contract; each of web/iOS/Android
  keeps a **hand-written `SectionComponentType → component` registry**. Schema drift = build error.
- **Lyft / DoorDash / Faire** — same shape (protobuf or JSON): **server owns what/where/order;
  client owns a catalog of renderers**; unknown types must degrade gracefully.
- **iOS WidgetKit / Android App Widgets** — the OS is the host; each app **self-declares** a typed
  widget (kind id, supported sizes, a data/timeline provider); the **user** owns placement/order and
  the OS persists it. _App declares a typed widget + data provider; host composes; user arranges._
- **GraphQL BFF / component-fragment aggregation** — each feature owns a fragment; a BFF composes
  the ordered home feed; client pattern-matches `__typename → component`.

**Universal lesson:** every one keeps a client `type → component` map (L3). The best ones minimize
its pain via (a) a **shared typed contract** so drift is caught at build time, (b) a
**graceful-unknown fallback** so a new server-sent widget never crashes an old client (this is what
lets a new widget **auto-appear** for existing users), and (c) **self-registration colocated with
the feature** (manifest field / `customElements` / blueprint) so there is no central switch to edit.

## How our repo constrains/enables each layer

(Facts gathered from the codebase; file paths are load-bearing.)

- **Shared UI** `packages/ui` exports **tokens only**, `"sideEffects": false`, **no components, no
  `.native.tsx`**. → No shared component layer exists yet; **side-effect registry is a poor fit**
  (aggressive tree-shaking, nothing to register into). A shared _widget contract_ package is new work.
- **Typed client pattern** `packages/clients/food-service` (`FoodServiceClient`: `{baseUrl, token}`,
  `TokenSource` re-read per request, status→typed-result mapping) is the **template** for a
  `HomeClient` calling a BFF, or per-service widget-descriptor clients. → **Enables L2 server BFF.**
- **Per-user data owner**: the **identity service owns the Drizzle Postgres DB** (`users`,
  `accounts`, `profiles` in `packages/services/identity/src/database/schema/*`), hand-written SQL
  migrations, and a `/v1/users/me` + `/v1/profiles/me` surface. → **Unambiguous owner of a
  `profiles.preferences.homeLayout` (profile-preferences JSON) + `PATCH /v1/profiles/me`.** (L2 personalization.)
- **Service exposure**: single **shared ALB per stage**; each service imports the HTTPS listener and
  adds a host rule at a unique priority (identity=100, food=200, "future 300, 400…"). A public
  unauthenticated `/health` controller already exists. → A plain versioned `GET /v1/home-widget` per
  service is **cheap** (a normal controller alongside the existing `v1/...` routes); **enables backend
  self-advertise (L1 variant).** Caveat: no dynamic service registry — the BFF enumerates services by
  convention/priority (a known host list). _(Not a `.well-known` path — just a versioned endpoint.)_
- **Codegen precedent**: `packages/ui/scripts/generate-theme.mjs` (tokens → CSS) proves the
  build-time-codegen shape is accepted — **but no generated file is committed anywhere** and there is
  **no Turbo `gen` task**. A committed `registry.generated.ts` would be a **new convention** (mild
  blocker: needs buy-in + a `codegen` task wired as `^codegen` in Turbo).
- **Data-fetching divergence**: mobile has **TanStack Query**; web has a **hand-rolled fetch**
  (`src/lib/api-client.ts`), different env var names (`NEXT_PUBLIC_API_BASE_URL` vs
  `EXPO_PUBLIC_API_URL`). → A shared widget contract should not assume a shared data client; either
  converge on TanStack Query for web too, or let each widget impl fetch per-platform.
- **Home mount points already exist**: web `packages/apps/commise/web/src/app/page.tsx` (static
  welcome today); mobile `App.tsx` renders a single `ProfileScreen` (no home yet).

## Candidate end-to-end architectures

Each is a choice of {L1, L2, L3}. All terminate in a real React component via L3
(`React.lazy(entry.load)` + Suspense).

### Option 1 — Convention Codegen Registry (build-time discovery, client-owned layout)

- **L1**: each feature declares its widget in `package.json`
  (`"commise": { "homeWidget": { "id", "web", "native", "defaultWeight", "capability", "minTier" } }`).
  A Turbo `codegen` task globs workspace `package.json`s → emits per-app `registry.generated.ts`
  with `{ id, load: () => import('…'), defaultWeight, capability, minTier }`.
- **L2**: default order from `defaultWeight`; personalization kept client-side (local) — or bolt on
  a DB later.
- **L3**: ordered ids → registry → `React.lazy` + Suspense; graceful-unknown skip.
- **+** Fully portable, type-safe, "add package → appears" after codegen, code-split per widget.
- **−** Codegen must re-run on package add/remove; **no cross-device personalization** without a
  server; **no capability gating** for absent services unless the widget itself no-ops.

### Option 2 — Server-Driven Layout + Codegen Render Registry ★ recommended baseline

- **L1**: the codegen registry from Option 1 = the set of widget types this **client build** can render.
- **L2**: a **Home BFF** (`GET /v1/home`, owned by identity or a small home service) returns the
  **ordered, personalized, capability-gated** list for this user: merge a default template with the
  user's saved layout (a **sparse diff**), filter by tier and by **which backing services are live**.
  Personalization persists via `PATCH /v1/profiles/me` (identity profile preferences).
  **Auto-append**: any known widget not in the user's saved layout renders at its `defaultWeight`, so
  new features appear for existing users with no migration.
- **L3**: client takes the ordered ids → codegen registry → `React.lazy` component; unknown id (client
  older than server) → skip.
- **+** Solves discovery **and** personalization **and** capability-gating (the 005–009-not-built
  problem: BFF simply omits widgets whose capability is absent) **and** cross-platform. Data-only
  changes (reorder, enable an already-shipped widget) need **no client redeploy**.
- **−** Two moving parts (registry + BFF) kept in sync by a **shared widget-id contract**
  (mitigated by graceful-unknown + shared types package). New widget _code_ still needs a client build.

### Option 3 — Backend Self-Advertising + BFF (maximal decoupling)

- Option 2, but the BFF learns the widget catalog from each service's plain versioned
  `GET /v1/home-widget` (id, title-key, default weight, size, data endpoint, required tier)
  instead of a static list. **Deploy a service → its widget becomes eligible, zero central edit.**
  _(A normal controller next to the existing `v1/...` routes — deliberately not a `.well-known` path.)_
- **+** Truest microservice self-registration; each backend owns its widget metadata next to its code.
- **−** BFF still needs the host list (no dynamic registry — enumerated by ALB convention/priority);
  still needs the L3 client render registry. Most infra of the three.

### Option 4 — Runtime Remote Widgets (Module Federation / Re.Pack)

- Widgets are independently-built remote bundles; the client loads them at runtime from a
  server-provided list. **True "drop in, appears, no client redeploy."**
- **−** RN requires Re.Pack (Metro → Rspack), a large tooling migration, plus hosting/versioning and
  runtime-failure surface. **Overkill now**; the right answer only if widgets must ship independently
  of the app release train. Keep as a documented future escalation.

### Option 5 — Side-effect Registry — **rejected**

- `registerWidget()` at import fails here: `packages/ui` is `sideEffects:false`, bundlers tree-shake,
  there is no shared runtime to register into, and discovery still needs the import edge from codegen.

### Option 6 — Filesystem-convention via platform primitives — **rejected as primary**

- Reuse `require.context` (Expo Router already does this on Metro; webpack on web). Works, but two
  non-portable code paths + Turbopack caveats, for no gain over codegen. Interesting, not chosen.

## The render chain (L3) in concrete terms

The thing the user cares about — how it ends in a mounted React component:

```
[ ordered widget ids ]                       ← L2: codegen defaults, or BFF /v1/home (personalized, gated)
        │
        ▼
registry.generated.ts  (per app, from codegen)
  { 'meal-plan': { load: () => import('@commise/features-meal-plan/home-widget.web'),  defaultWeight: 300, capability: 'meal-plans' },
    'nutrition': { load: () => import('@commise/features-nutrition/home-widget.web'),  ... }, ... }
        │
        ▼
for each id in order:
  const Widget = React.lazy(registry[id].load)          // dynamic import(), portable web+Metro
  <Suspense fallback={<WidgetSkeleton/>}>
    <ErrorBoundary fallback={null}>                      // a widget failing never breaks the page
      <Widget />                                          // ← real component; fetches its own data
    </ErrorBoundary>
  </Suspense>
  // unknown id (not in registry) → skip  → safe server/client version skew + auto-appear
```

- On web, `next/dynamic(registry[id].load)` if the widget must be a client component under RSC.
- Each widget owns its data fetch (TanStack Query on mobile; web either converges on TanStack Query
  or uses the existing fetch wrapper). The BFF decides _whether_ a widget shows; the widget decides
  _what_ it shows.

## Recommendation

**Adopt Option 2 as the baseline, structured so Option 3 is a drop-in later.** Concretely:

1. **Shared contract package** (`packages/shared/home-widget-contract` or into `@kitchensink/ui`):
   the `HomeWidgetId` union, `HomeWidgetDescriptor`, and the BFF response types. Graceful-unknown on
   the client. _This is the anti-drift keystone._
2. **L1 — codegen**: `package.json` `commise.homeWidget` convention + a Turbo `codegen` task emitting
   per-app `registry.generated.ts`. Feature owns its declaration; nobody edits a central list.
3. **L3 — render**: `React.lazy` + Suspense + per-widget ErrorBoundary; unknown ids skipped.
4. **L2 — BFF + personalization**: `GET /v1/home` returns the ordered, tier-gated, capability-gated
   list (auto-appending unknown-to-user widgets at `defaultWeight`); `PATCH /v1/profiles/me`
   persists reorder/hide to a `profiles.preferences.homeLayout` (profile-preferences JSON) in the **identity** service. Capability gating is
   what lets 001 ship Home **now** with only the recipe widget live — 005–009 light up automatically
   as their services deploy.
5. **Future**: backends self-advertise via a plain versioned `GET /v1/home-widget` (Option 3) when we
   tire of the BFF's static capability list; Re.Pack/MF (Option 4) only if widgets ever need
   independent deploys.

### Build tooling: esbuild's role in L1

esbuild **can** run inside a production Metro build — `@rnx-kit/metro-serializer-esbuild` (Microsoft
rnx-kit) replaces Metro's **serializer** so esbuild does the bundling + tree-shaking that stock Metro
never does. But that runs at **serialization**, _after_ Metro's resolver + Babel have already built the
module graph. So it does **not** grant esbuild's `onResolve`/`onLoad` glob-plugin discovery inside the
app build — Metro (not esbuild) still decides which modules are in the graph, which still requires a
**literal import edge**. Discovery therefore still needs the codegen registry; the esbuild serializer
changes bundling/tree-shaking, not discovery. (And the web app is Next → webpack/Turbopack, with no
esbuild-serializer equivalent, so esbuild never unifies the two frontends anyway.)

Its correct use for L1 is as the **build engine for the registry package**: use `@kitchensink/esbuild`
(already in the repo) to build `@kitchensink/home-registry`, globbing the workspace for
`commise.homeWidget` declarations and emitting `dist/registry.js` — this is where esbuild's glob
discovery legitimately runs, _ahead of_ either app build. Both apps import the built package; Turbo
`^build` regenerates it. Parallels `packages/ui/scripts/generate-theme.mjs` → `dist/theme.css`.

Two consequences if we also adopt the rnx-kit esbuild serializer on mobile (recommended for bundle
size once there are many code-split widgets):

- It **sharpens the "no side-effect registry" call** — stock Metro doesn't tree-shake, so a
  `registerWidget()` side-effect module survives by accident; the esbuild serializer will prune it.
  Explicit descriptors, never load-time side effects.
- **Authoring constraints**: esbuild does not tree-shake `export *` and is incompatible with RAM
  bundles — the registry barrel must use explicit named exports / the keyed map, never `export *`.

Two mandatory config details for the registry build, independent of the tool:

- **`bundle: false` / externalize the widget specifiers** so esbuild **preserves the literal
  `() => import('@commise/…/home-widget')` arrows** rather than inlining widget code — the _app_
  bundler (Metro/webpack) must be the one to resolve and code-split them.
- **Metro only bundles statically-analyzable `import()` specifiers**, so the registry must contain
  literal import arrows (never `import(variable)`); the `.web.tsx`/`.native.tsx` split is resolved by
  the app bundler (Metro platform extensions natively; web via `resolve.extensions` / conditional
  package `exports`), not encoded in the registry.

**Why not just codegen (Option 1)?** It can't gate on "service not deployed" and can't do
cross-device personalization without inventing the same BFF anyway. The BFF is the piece that makes
"a feature shows up once it's added" **and** "it disappears cleanly when its backend isn't there"
**and** "the user's arrangement follows them" all true at once.

## Build policy: esbuild everywhere (feature requirement)

This feature standardizes on **esbuild as the universal build tool**, to the extent each surface allows:

- **All buildable packages** (libraries, NestJS services, Lambdas, and the `@kitchensink/home-registry`
  package) build with the shared `@kitchensink/esbuild` preset. No package uses tsc/babel/swc for its
  emit.
- **Mobile app bundle** uses esbuild via `@rnx-kit/metro-serializer-esbuild` (esbuild does the Metro
  serialization → real tree-shaking). Requires `disableImportExportTransform` in babel and forbids RAM
  bundles + `export *` in tree-shaken code.
- **Web app bundle — the one boundary.** The Next.js app is compiled by Next's own pipeline
  (SWC / Turbopack). Next does **not** permit esbuild as the app bundler, so the web _app shell_ is the
  single surface esbuild does not own. Everything the web app _imports_ (registry, widget packages, UI,
  clients) is still esbuild-built. Making esbuild literally universal on web would require moving the web
  app off Next.js (Vite/esbuild SPA or Rspack) — tracked as Open Decision #5, not assumed here.

## Open decisions (need a human call)

1. **Shared component layer vs per-platform impls.** Confirm widgets are `widget.web.tsx` +
   `widget.native.tsx` behind one id (aligns with the mandated `.native.tsx` convention), rather than
   attempting a shared cross-platform component runtime (large new effort).
2. **BFF home** owner: extend the **identity** service (already owns per-user DB) vs a new small
   `home-service` (cleaner bounded context, +1 ALB priority ~400, +1 service to run).
3. **Web data layer**: adopt TanStack Query on web for parity with mobile, or keep the hand-rolled
   fetch and let widgets abstract it.
4. **Committed generated file**: ~~accept a checked-in `registry.generated.ts`~~ → **leaning
   resolved**: build `@kitchensink/home-registry` to `dist/` via esbuild (parallels the theme codegen),
   so nothing generated lands in committed source. Confirm this over a checked-in file.
5. **Web app off Next.js?** To make esbuild _literally_ universal (including the web app bundle), the
   web app would move off Next.js. Default assumption: **no** — keep Next, accept it as the one
   non-esbuild app bundler. Revisit only if there's an independent reason to leave Next.

## Sources

- VS Code Contribution Points; Backstage frontend extensions/blueprints & app feature discovery;
  Shopify theme app extensions / app blocks; WordPress `register_widget` → `block.json`.
- Airbnb server-driven UI ("Ghost Platform"); DoorDash generic SDUI components; Faire SDUI;
  Spotify HubFramework; Grafana dashboard JSON model; Home Assistant custom cards; Apollo SDUI basics.
- Metro `require.context` (`facebook/metro#822`, Expo `expo/expo#19257`); Next.js Turbopack
  `require.context` caveat (`vercel/next.js#78019`); Expo Router file-based routing; Re.Pack 5 (Rspack
    - Module Federation 2).
