# Next.js App Router (15 / 16) — code smells, anti-patterns, red flags

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID      | Smell                                                                                      | Section                         | Detected by | Default severity | Architecture |
| ------- | ------------------------------------------------------------------------------------------ | ------------------------------- | ----------- | ---------------- | ------------ |
| NEXT-01 | `'use client'` hoisted to the top of large trees (layouts, pages, providers wrapping `<ht… | Server / Client boundary        | judgement   | major            | yes          |
| NEXT-02 | Over-broad or non-serialisable props across the boundary (whole DB rows, class instances,… | Server / Client boundary        | tool        | blocker          | yes          |
| NEXT-03 | Server-only modules importable from the client graph (no `server-only` marker)             | Server / Client boundary        | partial     | major            | yes          |
| NEXT-04 | Secrets or privileged values exposed via `NEXT_PUBLIC_` / inlined env; runtime-config ass… | Server / Client boundary        | tool        | blocker          | yes          |
| NEXT-05 | Env-var lookup shapes that are not inlined on the client                                   | Server / Client boundary        | judgement   | major            | no           |
| NEXT-06 | Hydration mismatch sources in render (Date/random/window/locale), and the "fix" that trip… | Server / Client boundary        | tool        | major            | no           |
| NEXT-07 | Sequential awaits creating request waterfalls in Server Components                         | Data fetching & rendering       | judgement   | major            | no           |
| NEXT-08 | Duplicate data access without request-scoped dedupe (non-`fetch` sources)                  | Data fetching & rendering       | judgement   | minor            | no           |
| NEXT-09 | Server Components fetching their own Route Handlers                                        | Data fetching & rendering       | judgement   | major            | yes          |
| NEXT-10 | `useSearchParams` in a prerendered route without a `<Suspense>` boundary                   | Data fetching & rendering       | tool        | major            | no           |
| NEXT-11 | Layout-level auth or `searchParams`-dependent logic (layouts don't re-render on navigatio… | Data fetching & rendering       | judgement   | blocker          | yes          |
| NEXT-12 | Missing or mis-scoped `loading.tsx` / `error.tsx` / `global-error.tsx` / `not-found`       | Data fetching & rendering       | tool        | major            | yes          |
| NEXT-13 | `redirect()` / `notFound()` inside `try/catch` (control-flow errors swallowed)             | Data fetching & rendering       | judgement   | major            | no           |
| NEXT-14 | Side effects during render (cookies, cache invalidation, mutations on GET)                 | Data fetching & rendering       | tool        | blocker          | no           |
| NEXT-15 | Caching assumptions carried across the 14 → 15 → 16 changes                                | Caching (15 → 16 semantics)     | partial     | major            | yes          |
| NEXT-16 | Per-user data inside a shared `use cache` scope; request APIs inside cached scopes         | Caching (15 → 16 semantics)     | tool        | blocker          | yes          |
| NEXT-17 | `revalidatePath` misuse (URL vs route pattern, missing `type`, over-invalidation)          | Caching (15 → 16 semantics)     | judgement   | minor            | no           |
| NEXT-18 | Server Action without authentication, authorisation (ownership) and input validation insi… | Server Actions & Route Handlers | judgement   | blocker          | yes          |
| NEXT-19 | Closures capturing sensitive values into inline Server Actions; hardcoded secrets in acti… | Server Actions & Route Handlers | judgement   | major            | no           |
| NEXT-20 | Server Actions used for reads / parallel client calls                                      | Server Actions & Route Handlers | judgement   | minor            | no           |
| NEXT-21 | Route Handlers treated as internal (no auth, no origin/CORS policy, open redirects in cal… | Server Actions & Route Handlers | tool        | blocker          | yes          |
| NEXT-22 | Unvalidated `params` / `searchParams` / headers driving authorisation or queries           | Server Actions & Route Handlers | tool        | blocker          | no           |
| NEXT-23 | Authorisation enforced only in `middleware.ts` / `proxy.ts`                                | Proxy (formerly middleware)     | judgement   | blocker          | yes          |
| NEXT-24 | Proxy doing heavy work, leaking request headers, unscoped matchers, or still named `middl… | Proxy (formerly middleware)     | tool        | major            | no           |
| NEXT-25 | Dynamic hostnames in `rewrites()`/`redirects()` built from user input                      | Proxy (formerly middleware)     | judgement   | blocker          | yes          |
| NEXT-26 | `next/image` misuse (raw `<img>`, `priority` on 16, open `remotePatterns`, SVG, auth-requ… | Built-in components & config    | tool        | major            | no           |
| NEXT-27 | `next/script` and `next/font` misuse                                                       | Built-in components & config    | tool        | minor            | no           |
| NEXT-28 | Async Request APIs accessed synchronously / legacy sync-compat casts                       | Built-in components & config    | tool        | blocker          | no           |
| NEXT-29 | Upgrade-surface drift on 16 (webpack config silently failing Turbopack build, `next lint`… | Built-in components & config    | tool        | major            | no           |
| NEXT-30 | Unpatched Next/React RSC runtime                                                           | Built-in components & config    | tool        | blocker          | yes          |

<!-- END GENERATED INDEX -->

## Scope & sources consulted

Scope: Next.js App Router, versions 15.x and 16.x (npm latest at research time `next@16.3.5`, 2026-09-12;
the nextjs.org docs served were stamped `version: 16.3.5`). Pages Router is out of scope except where a
rule still applies. Generic React smells live in `react.md`. All sources opened 2026-09-13.

| Source                                                                                                                             | Version / date                      | URL                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgrading to v16                                                                                                                   | docs 16.3.5, lastUpdated 2026-08-25 | https://nextjs.org/docs/app/guides/upgrading/version-16                                                                                                                                                                                                                                                                                                           |
| Upgrading to v15                                                                                                                   | docs 16.3.5                         | https://nextjs.org/docs/app/guides/upgrading/version-15                                                                                                                                                                                                                                                                                                           |
| Data Security guide                                                                                                                | docs 16.3.5, 2026-08-25             | https://nextjs.org/docs/app/guides/data-security                                                                                                                                                                                                                                                                                                                  |
| Authentication guide                                                                                                               | docs 16.3.5                         | https://nextjs.org/docs/app/guides/authentication                                                                                                                                                                                                                                                                                                                 |
| Server and Client Components                                                                                                       | docs 16.3.5                         | https://nextjs.org/docs/app/getting-started/server-and-client-components                                                                                                                                                                                                                                                                                          |
| `'use client'` directive                                                                                                           | docs 16.3.5                         | https://nextjs.org/docs/app/api-reference/directives/use-client                                                                                                                                                                                                                                                                                                   |
| Fetching Data (waterfalls, `React.cache`, preload)                                                                                 | docs 16.3.5, 2026-09-07             | https://nextjs.org/docs/app/getting-started/fetching-data                                                                                                                                                                                                                                                                                                         |
| `use cache`, `use cache: private`, `cacheComponents`, Migrating to Cache Components, `revalidatePath`                              | docs 16.3.5                         | https://nextjs.org/docs/app/api-reference/directives/use-cache · https://nextjs.org/docs/app/api-reference/directives/use-cache-private · https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents · https://nextjs.org/docs/app/guides/migrating-to-cache-components · https://nextjs.org/docs/app/api-reference/functions/revalidatePath |
| `proxy.js` file convention                                                                                                         | docs 16.3.5, 2026-09-07             | https://nextjs.org/docs/app/api-reference/file-conventions/proxy                                                                                                                                                                                                                                                                                                  |
| Server Actions guide; Backend for Frontend guide; `route.js`                                                                       | docs 16.3.5                         | https://nextjs.org/docs/app/guides/server-actions · https://nextjs.org/docs/app/guides/backend-for-frontend · https://nextjs.org/docs/app/api-reference/file-conventions/route                                                                                                                                                                                    |
| `redirect`, `useSearchParams`, `error.js`, `generateMetadata`, `next/image`, `next/script`, `next/font`                            | docs 16.3.5                         | https://nextjs.org/docs/app/api-reference/functions/redirect · …/functions/use-search-params · …/file-conventions/error · …/functions/generate-metadata · …/components/image · …/components/script · …/components/font                                                                                                                                            |
| Environment variables guide                                                                                                        | docs 16.3.5                         | https://nextjs.org/docs/app/guides/environment-variables                                                                                                                                                                                                                                                                                                          |
| Hydration error message page                                                                                                       | live                                | https://nextjs.org/docs/messages/react-hydration-error                                                                                                                                                                                                                                                                                                            |
| `@next/eslint-plugin-next` (rules + preset table read from npm tarball)                                                            | `16.3.5`                            | npm tarball                                                                                                                                                                                                                                                                                                                                                       |
| GHSA-f82v-jwr5-mffw — CVE-2025-29927 middleware authorization bypass                                                               | 2025-03                             | https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw                                                                                                                                                                                                                                                                                         |
| Next.js blog — CVE-2025-66478 (React2Shell downstream)                                                                             | 2025-12-03 (+12-06 updates)         | https://nextjs.org/blog/CVE-2025-66478                                                                                                                                                                                                                                                                                                                            |
| Next.js security advisories index; GHSA-6gpp-xcg3-4w24 (CVE-2026-64642); GHSA-p9j2-gv94-2wf4 (CVE-2026-64645); GHSA-2xp9-vwfh-vxw4 | 2026-07-21 / 2026-08-25             | https://github.com/vercel/next.js/security/advisories                                                                                                                                                                                                                                                                                                             |
| React blog — RSC advisories (CVE-2025-55182/55183/55184/67779, CVE-2026-23864)                                                     | 2025-12 / 2026-01                   | https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components · https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components                                                                                                                                                            |
| react.dev — `'use server'` security considerations                                                                                 | live                                | https://react.dev/reference/rsc/use-server                                                                                                                                                                                                                                                                                                                        |
| CodeQL JS query help index                                                                                                         | live                                | https://codeql.github.com/codeql-query-help/javascript/                                                                                                                                                                                                                                                                                                           |

### Tool facts worth knowing before citing a rule

- **`@next/eslint-plugin-next@16.3.5` has 22 rules and none of them touch the App Router's real risk surface**
  (server/client boundary, secrets, Server Action authz, caching, waterfalls). Rules: `google-font-display`,
  `google-font-preconnect`, `inline-script-id`, `next-script-for-ga`, `no-assign-module-variable`,
  `no-async-client-component`, `no-before-interactive-script-outside-document`, `no-css-tags`,
  `no-document-import-in-page`, `no-duplicate-head`, `no-head-element`, `no-head-import-in-document`,
  `no-html-link-for-pages`, `no-img-element`, `no-location-assign-relative-destination`, `no-page-custom-font`,
  `no-script-component-in-head`, `no-styled-jsx-in-document`, `no-sync-scripts`, `no-title-in-document-head`,
  `no-typos`, `no-unwanted-polyfillio`. `recommended`: most `warn`; `inline-script-id`,
  `no-assign-module-variable`, `no-document-import-in-page`, `no-duplicate-head`, `no-head-import-in-document`,
  `no-script-component-in-head` are `error`; `core-web-vitals` upgrades `no-html-link-for-pages` and
  `no-sync-scripts` to `error`. Config key prefix: `@next/next/<rule>`.
- **Next 16 removed `next lint`** and "`next build` no longer runs linting" — a repo that relied on build-time
  lint has silently lost that gate unless ESLint is wired separately.
- **Semgrep community rules have no `nextjs` directory**; framework-generic React/JS rules apply only.
- **CodeQL** models generic JS sinks (`js/xss`, `js/server-side-unvalidated-url-redirection`,
  `js/request-forgery`) but no query understands `'use server'` as a public endpoint; authz on Server
  Functions is judgement.
- **Several smells below only fail in `next build`/production** (`useSearchParams` Suspense requirement,
  request APIs inside `use cache` on dynamic routes "can pass `next build` and fail under `next start`",
  dev-only rendering of error messages). "It works in `next dev`" is not evidence.

---

## Server / Client boundary

### NEXT-01 `'use client'` hoisted to the top of large trees (layouts, pages, providers wrapping `<html>`)

- **Signal:** `'use client'` in `app/**/layout.tsx`, `page.tsx`, or a component that mostly renders static
  markup and imports many children; a root provider component wrapping `<html>`/`<body>`; a whole design-system
  barrel marked `'use client'` just because one component uses state.
- **Tool coverage:** none — judgement (`@next/next/no-async-client-component` only catches async client components).
- **Why it hurts:** "Once a file is marked with `'use client'`, **all of its imports and the components it
  directly renders are included in the client bundle**" → bundle bloat, loss of server-only data access in that
  subtree, secrets/DB code dragged toward the client graph.
- **Severity:** major (minor for small leaf trees).
- **Remediation:** push the boundary down — "add `'use client'` to specific interactive components instead of
  marking large parts of your UI as Client Components"; pass Server Components as `children`/slots into client
  wrappers (Interleaving); "render providers as deep as possible in the tree – notice how `ThemeProvider` only
  wraps `{children}` instead of the entire `<html>` document". Trap: adding `'use client'` to every file — the
  directive is only needed at the entry file rendered from a Server Component.
- **Not a finding when:** the subtree is genuinely interactive throughout (e.g. a canvas editor) or the app is a
  deliberate SPA.
- **Architecture:** yes — the boundary placement is an architectural decision per route; escalate if it hides
  data-access design.
- **Sources:** https://nextjs.org/docs/app/getting-started/server-and-client-components · https://nextjs.org/docs/app/api-reference/directives/use-client

### NEXT-02 Over-broad or non-serialisable props across the boundary (whole DB rows, class instances, functions)

- **Signal:** Server Component passes `user={userRow}` / `post={await db.post.findUnique(...)}` to a
  `'use client'` component whose prop type is the ORM model (`User`, `Prisma.User`); passing functions (non-Server-Action)
  or class instances as props; Client prop types wider than what is rendered.
- **Tool coverage:** build/runtime error for functions/classes ("Functions and classes are already blocked");
  none for over-broad plain objects — judgement. `experimental.taint` +
  `experimental_taintObjectReference`/`experimental_taintUniqueValue` catches only what you taint.
- **Why it hurts:** every field in the RSC payload reaches the browser (`// EXPOSED: This exposes all the fields in
userData to the client`); PII/hashes/internal flags leak (CWE-200).
- **Severity:** blocker when the object carries secrets/PII not rendered; major otherwise.
- **Remediation:** DTOs from a `server-only` Data Access Layer returning "safe, minimal Data Transfer Objects";
  narrow client prop types ("accept a limited object with just the fields necessary"); taint as a second layer
  ("you should still filter and sanitize the data in your DAL"). Trap: `Omit<User, 'passwordHash'>` in the type
  while still passing the whole runtime object.
- **Not a finding when:** the passed object is a DTO whose fields are all intended for display.
- **Architecture:** yes — DAL/DTO boundary; escalate to architecture/security.
- **Sources:** https://nextjs.org/docs/app/guides/data-security · https://nextjs.org/docs/app/api-reference/directives/use-client

### NEXT-03 Server-only modules importable from the client graph (no `server-only` marker)

- **Signal:** modules that read non-`NEXT_PUBLIC_` env, instantiate DB/ORM clients, call internal APIs with
  credentials, or hold proprietary logic, **without** `import 'server-only'`; DB packages / `process.env` imported
  outside a designated DAL directory; browser-only modules (window) without `import 'client-only'`.
- **Tool coverage:** partial — `server-only`/`client-only` make misuse a build error once present; a
  dependency-cruiser / ESLint `no-restricted-imports` boundary rule can enforce "DB packages only under `data/`";
  none by default.
- **Why it hurts:** "it's possible to accidentally import server-only code into the client"; non-public env
  vars are replaced with "an empty string" on the client → the code silently misbehaves rather than failing;
  proprietary logic ships in JS.
- **Severity:** major (blocker if secrets are literal in the module).
- **Remediation:** `import 'server-only'` in DAL and `"use server"` files ("Both work when the action is imported
  into a Client Component"); Data Security audit checklist: "Verify that database packages and environment
  variables are not imported outside the Data Access Layer."; only the DAL reads `process.env`.
- **Not a finding when:** truly isomorphic pure utilities.
- **Architecture:** yes — module boundary enforcement; escalate.
- **Sources:** https://nextjs.org/docs/app/getting-started/server-and-client-components · https://nextjs.org/docs/app/guides/data-security

### NEXT-04 Secrets or privileged values exposed via `NEXT_PUBLIC_` / inlined env; runtime-config assumptions

- **Signal:** `NEXT_PUBLIC_*SECRET*`, `NEXT_PUBLIC_*SERVICE*KEY*`, private API tokens with the public prefix;
  expecting `NEXT_PUBLIC_*` to change per environment for a single Docker image; `?? 'http://localhost:…'`
  fallbacks on public vars; `serverRuntimeConfig`/`publicRuntimeConfig` in v16 code.
- **Tool coverage:** secret scanners for committed values; none for build-time injected values; TS error for
  removed runtime config in 16.
- **Why it hurts:** public vars are inlined "into any JavaScript sent to the browser"; "all `NEXT_PUBLIC_`
  variables will be frozen with the value evaluated at build time" → promoted builds point at the wrong
  environment; a fallback literal gets compiled into production when the build env lacks the var.
- **Severity:** blocker for privileged secrets; major for frozen-endpoint/fallback bugs.
- **Remediation:** server-only env read in the DAL; for per-environment runtime values read on the server after
  `await connection()` and pass down, or expose via an API; validate required env at build (fail, don't
  default). `serverRuntimeConfig`/`publicRuntimeConfig` were removed in 16 — "Use environment variables instead."
- **Not a finding when:** the value is public by design (publishable keys, analytics ids).
- **Architecture:** yes for runtime-config strategy (build-once-deploy-many); escalate.
- **Sources:** https://nextjs.org/docs/app/guides/environment-variables · https://nextjs.org/docs/app/guides/upgrading/version-16

### NEXT-05 Env-var lookup shapes that are not inlined on the client

- **Signal:** `process.env[varName]` (variable key), `const env = process.env; env.NEXT_PUBLIC_X`, destructuring
  `const { NEXT_PUBLIC_X } = process.env` in client code.
- **Tool coverage:** none in `@next/eslint-plugin-next`; TypeScript can't see it.
- **Why it hurts:** "dynamic lookups will _not_ be inlined" → `undefined` in the browser.
- **Severity:** major (blocker when it's the API base URL / auth publishable key).
- **Remediation:** static `process.env.NEXT_PUBLIC_X` member expressions in one typed env module that maps each
  name literally (e.g. T3 Env `runtimeEnv`). Trap: a repo convention of `process.env['KEY']` bracket notation —
  the Next docs only document the _variable_-key forms as non-inlined; whether a string-literal bracket
  (`process.env['NEXT_PUBLIC_X']`) is inlined by both webpack and Turbopack was **not verified** from a primary
  source, so prefer dot notation for public client vars. Because it is unverified, report a literal-bracket read as a
  **convention/fragility risk (minor)**, not as a breakage; only the variable-key and aliased forms are documented
  breakages.
- **Not a finding when:** server-only code (no inlining needed).
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/guides/environment-variables

### NEXT-06 Hydration mismatch sources in render (Date/random/window/locale), and the "fix" that trips the React Compiler lint

- **Signal:** `new Date()`, `Date.now()`, `Math.random()`, `toLocaleString()` without fixed locale/timezone,
  `typeof window !== 'undefined'` branches, `localStorage`/`window` reads in render of a component that is
  prerendered; invalid nesting (`<div>` in `<p>`, `<a>` in `<a>`, `<button>` in `<button>`); widespread
  `suppressHydrationWarning`; `useEffect(() => setIsClient(true), [])` gates.
- **Tool coverage:** `react-hooks:purity` (Date/random); runtime hydration error; `react-hooks:set-state-in-effect`
  **flags** the docs' own `setIsClient(true)` in `useEffect` workaround. none for locale/timezone drift.
- **Why it hurts:** hydration errors force client re-render, content flicker, lost SSR benefit; iOS data detectors
  (phone/email) also cause mismatches.
- **Severity:** major on high-traffic pages; minor for isolated widgets.
- **Remediation:** render the same output on server and first client render; format dates with explicit
  timezone/locale on the server; `next/dynamic(..., { ssr: false })` for browser-only widgets;
  `useSyncExternalStore` with a `getServerSnapshot` for client-only values (lint-clean alternative to the
  `setIsClient` effect); `suppressHydrationWarning` only for inevitable one-level differences ("This only works
  one level deep … Don't overuse it"); `<meta name="format-detection" content="telephone=no, date=no, email=no, address=no"/>`.
- **Not a finding when:** the component is never server-rendered (inside `ssr:false`).
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/messages/react-hydration-error · https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect

---

## Data fetching & rendering

### NEXT-07 Sequential awaits creating request waterfalls in Server Components

- **Signal:** two or more independent `await getX()` lines in the same async component/page
  (`const artist = await getArtist(u); const albums = await getAlbums(u);`) where the second does not use the
  first's result; `generateMetadata` and page each awaiting slow independent calls without dedupe.
- **Tool coverage:** none — judgement (a lint for "independent sequential awaits" does not exist in the Next
  plugin; ESLint `no-await-in-loop` covers only loops).
- **Why it hurts:** latency is the sum instead of the max; "the whole route will be blocked from rendering until
  all the data is fetched".
- **Severity:** major on request-time routes; minor at build-time prerender.
- **Remediation:** initiate then `await Promise.all([...])` (or `Promise.allSettled` — "If one request fails when
  using `Promise.all`, the entire operation will fail"); split into sibling async components under `<Suspense>`;
  `preload()` pattern for dependent chains. Trap: `Promise.all` around calls that must be authorised first
  (don't parallelise the authz check away).
- **Not a finding when:** the second call depends on the first (sequential by necessity — then stream the
  dependent part in `<Suspense>`).
- **Architecture:** no (yes if an N+1 of backend calls implies a missing aggregate endpoint).
- **Sources:** https://nextjs.org/docs/app/getting-started/fetching-data

### NEXT-08 Duplicate data access without request-scoped dedupe (non-`fetch` sources)

- **Signal:** the same ORM/DB/SDK call executed in `generateMetadata`, the layout and the page for one request,
  not wrapped in `React.cache`; DAL auth helper (`verifySession`) re-querying DB per component.
- **Tool coverage:** none — judgement.
- **Why it hurts:** N× DB load per request; inconsistent reads within one render.
- **Severity:** minor–major (by query cost).
- **Remediation:** `fetch` calls are memoised automatically "across `generateMetadata`, `generateStaticParams`,
  Layouts, Pages, and Server Components"; for ORM calls wrap in `React.cache` ("scoped to the current request
  only"). Trap: using `React.cache` to pass data _into_ a `use cache` scope — "Values stored via `React.cache`
  outside a `use cache` function are not visible inside it."
- **Not a finding when:** calls use `fetch` with identical inputs.
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/getting-started/fetching-data · https://nextjs.org/docs/app/api-reference/functions/generate-metadata · https://nextjs.org/docs/app/api-reference/directives/use-cache

### NEXT-09 Server Components fetching their own Route Handlers

- **Signal:** `await fetch(`${process.env.BASE_URL}/api/...`)` or `fetch('http://localhost:3000/api/...')` inside
  a Server Component/page/layout.
- **Tool coverage:** none — judgement.
- **Why it hurts:** "For Server Components prerendered at build time, using Route Handlers will fail the build
  step"; extra HTTP round trip at runtime; auth cookies not forwarded; localhost URLs break in deployment.
- **Severity:** major.
- **Remediation:** "Fetch data in Server Components directly from its source, not via Route Handlers" — call the
  DAL function the handler calls.
- **Not a finding when:** the handler is a separate deployable/external BFF.
- **Architecture:** yes — indicates the DAL isn't shared; escalate.
- **Sources:** https://nextjs.org/docs/app/guides/backend-for-frontend

### NEXT-10 `useSearchParams` in a prerendered route without a `<Suspense>` boundary

- **Signal:** a Client Component calling `useSearchParams()` rendered from a static page with no enclosing
  `<Suspense>`; `export const dynamic = 'force-dynamic'` added to "fix" the build error.
- **Tool coverage:** production build error "Missing Suspense boundary with useSearchParams"; in dev
  "`useSearchParams` doesn't suspend and things may appear to work without `Suspense`".
- **Why it hurts:** "calling `useSearchParams` will cause the Client Component tree up to the closest `Suspense`
  boundary to be client-side rendered" → without a close boundary the whole page loses prerendered HTML; or the
  build fails in CI only.
- **Severity:** major.
- **Remediation:** wrap the smallest component in `<Suspense fallback=…>`; in a Server Component page prefer the
  `searchParams` prop and pass values down; to make a route dynamic prefer `await connection()` over
  `dynamic = 'force-dynamic'`.
- **Not a finding when:** the route is already dynamic (then `useSearchParams` is available during SSR).
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/api-reference/functions/use-search-params

### NEXT-11 Layout-level auth or `searchParams`-dependent logic (layouts don't re-render on navigation)

- **Signal:** session/role checks in `layout.tsx` used to gate child pages; layouts reading request-specific data
  and expecting freshness per navigation; layouts doing uncached `cookies()`/`headers()` access expecting
  `loading.tsx` to cover them.
- **Tool coverage:** none — judgement (Cache Components gives a build-time error for the loading case).
- **Why it hurts:** "Due to Partial Rendering, be cautious when doing checks in Layouts as these don't re-render on
  navigation, meaning the user session won't be checked on every route change"; "a layout that accesses uncached
  or runtime data … does not fall back to a same route segment `loading.js`. Instead, it blocks navigation".
- **Severity:** blocker when the layout check is the only authorisation; major for blocked navigation.
- **Remediation:** fetch user data in the layout but perform authorisation in the DAL called by each page/action;
  wrap runtime-data access in its own `<Suspense>` or move it into `page.js`.
- **Not a finding when:** the layout check is UX-only and pages/actions re-verify.
- **Architecture:** yes — authz placement; escalate to security.
- **Sources:** https://nextjs.org/docs/app/guides/authentication · https://nextjs.org/docs/app/getting-started/fetching-data

### NEXT-12 Missing or mis-scoped `loading.tsx` / `error.tsx` / `global-error.tsx` / `not-found`

- **Signal:** route groups with slow data and no `loading.tsx` or `<Suspense>`; `error.tsx` without
  `'use client'`; expecting `error.tsx` to catch errors thrown by the `layout.tsx` of the same segment; no
  `app/global-error.tsx`; `metadata` export in `global-error`; error UI rendering `error.message` expecting the
  server message in production; parallel route slots without `default.js` (v16).
- **Tool coverage:** build error for missing `default.js` in parallel routes (v16) and for server `error.tsx`
  (UNVERIFIED exact message); none for coverage gaps.
- **Why it hurts:** `error.js` "does **not** wrap the `layout.js` or `template.js` above it in the same segment" →
  layout errors bubble to the parent or the root; "Errors forwarded from Server Components show a generic message
  with an identifier" in production (use `error.digest` to correlate logs); `global-error` "must define its own
  `<html>` and `<body>`" and doesn't get global styles.
- **Severity:** major for top-level routes; minor for leaf segments.
- **Remediation:** `error.tsx` (`'use client'`) per meaningful segment, `global-error.tsx` at root, `retry()`
  (stable in 16.3; `reset()` only when refetching is undesirable); log `digest`; `default.js` returning `null` or
  `notFound()` for each slot.
- **Not a finding when:** a parent segment boundary intentionally handles the subtree.
- **Architecture:** yes — failure containment; escalate for app-shell design.
- **Sources:** https://nextjs.org/docs/app/api-reference/file-conventions/error · https://nextjs.org/docs/app/guides/upgrading/version-16

### NEXT-13 `redirect()` / `notFound()` inside `try/catch` (control-flow errors swallowed)

- **Signal:** `try { …; redirect('/x') } catch (e) { … }` or a `catch` that logs/returns an error object in
  Server Actions, Route Handlers, or Server Components; generic `catch (e) { return { error: String(e) } }`
  wrapping code that may call `redirect`/`notFound`; `redirect` called in a client event handler.
- **Tool coverage:** none — judgement.
- **Why it hurts:** "`redirect` throws an error so it should be called **outside** the `try` block" — the
  `NEXT_REDIRECT` error is caught and the redirect never happens (user stays on the form, or an error is shown).
  In client event handlers `redirect` is not supported ("You can use the `useRouter` hook instead").
- **Severity:** major.
- **Remediation:** compute inside `try`, call `redirect` after; if a broad catch genuinely mixes app and framework
  errors, call `unstable_rethrow(err)` from `next/navigation` "at the top of the catch block" (docs: "currently
  unstable … not recommended for production"; it covers `notFound()`, `redirect()`, `permanentRedirect()` and
  Request-time API errors such as `cookies`/`headers`/`searchParams`); prefer letting the caller handle the
  exception; `useRouter().push` in handlers. Note the same swallowing applies to `notFound()` and to request APIs
  inside a catch.
- **Not a finding when:** `redirect` is outside the try block.
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/api-reference/functions/redirect · https://nextjs.org/docs/app/api-reference/functions/unstable_rethrow

### NEXT-14 Side effects during render (cookies, cache invalidation, mutations on GET)

- **Signal:** `cookies().delete/set` or `revalidatePath/revalidateTag` inside a Server Component body; mutations
  triggered by `searchParams` (`?logout=1`); DB writes in `page.tsx`/`layout.tsx`/`generateMetadata`.
- **Tool coverage:** runtime error — "Next.js explicitly prevents setting cookies or triggering cache
  revalidation within render methods"; none for DB writes.
- **Why it hurts:** prefetching and crawlers execute GETs → accidental logouts/writes; CSRF via links (CWE-352).
- **Severity:** blocker for state-changing writes on GET.
- **Remediation:** Server Actions (POST) for mutations; "Mutations … should never be a side-effect, either in
  Server or Client Components".
- **Not a finding when:** read-only logging/metrics.
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/guides/data-security

---

## Caching (15 → 16 semantics)

### NEXT-15 Caching assumptions carried across the 14 → 15 → 16 changes

- **Signal:** code comments/assumptions that `fetch` is cached by default; `GET` Route Handlers assumed static;
  `export const dynamic`/`revalidate`/`fetchCache` in an app with `cacheComponents: true`; `revalidateTag('x')`
  single-argument on v16; `unstable_cacheLife`/`unstable_cacheTag` imports; `experimental.ppr`/`dynamicIO`/
  `useCache` flags on 16; `export const dynamic = 'force-dynamic'` used purely to read env at runtime.
- **Tool coverage:** partial — TypeScript error for single-arg `revalidateTag` ("will produce a TypeScript error");
  route segment configs "will error" once `cacheComponents` is enabled; codemods for renames. none for the
  _assumption_ that data is cached.
- **Why it hurts:** v15: "`fetch` requests are no longer cached by default" and "`GET` functions in Route Handlers
  are no longer cached by default" → unexpected origin load/cost after upgrade; page segments "no longer reused
  from the Client Cache" on navigation. v16: `revalidateTag` needs a `cacheLife` profile; enabling
  `cacheComponents` "is not a rename-only change: it can surface build errors for uncached data outside of
  `<Suspense>`".
- **Severity:** major (cost/latency regressions) — blocker when an upstream rate limit is hit.
- **Remediation:** explicit per call: `cache: 'force-cache'` or `use cache` + `cacheLife` ("Set an explicit cache
  lifetime with `cacheLife` in every `use cache` scope"); `cacheTag` + `updateTag` (read-your-writes in Server
  Actions) vs `revalidateTag(tag, 'max')` (stale-while-revalidate); `await connection()` instead of
  `force-dynamic` for runtime env.
- **Not a finding when:** the code states and tests its caching intent for the installed version.
- **Architecture:** yes — caching strategy/cost; escalate.
- **Sources:** https://nextjs.org/docs/app/guides/upgrading/version-15 · https://nextjs.org/docs/app/guides/upgrading/version-16 · https://nextjs.org/docs/app/guides/migrating-to-cache-components

### NEXT-16 Per-user data inside a shared `use cache` scope; request APIs inside cached scopes

- **Signal:** `'use cache'` function that calls a helper reading `cookies()`/`headers()`/`searchParams` (anywhere
  in its call stack); cached function returning user-specific data whose user id is _not_ an argument or closure
  variable (e.g. read from a module-level store/Map); cached component receiving runtime Promises as props.
- **Tool coverage:** runtime error `next-request-in-use-cache` — but "On a dynamically rendered route this surfaces
  when the route runs, so it can pass `next build` and fail under `next start`"; build hang "Filling a cache
  during prerender timed out" for runtime Promises. none for per-user data keyed incorrectly.
- **Why it hurts:** cache key = build id + function id + serialised args + captured closures; data not in the key
  is shared across users → cross-tenant data exposure (CWE-524/CWE-200); production-only failures.
- **Severity:** blocker for cross-user leakage; major for production-only runtime errors.
- **Remediation:** "read them outside cached scopes and pass values as arguments"; `'use cache: private'` for
  request-specific results ("Next.js does not store it in a server cache across requests"); never read shared
  mutable Maps inside cached scopes. Trap: in serverless, the default in-memory handler "typically don't persist
  across requests" — correctness must not depend on a hit.
- **Not a finding when:** all user-varying inputs are arguments (they're part of the key) _and_ the data is
  intended to be cached per user.
- **Architecture:** yes — cache tenancy; escalate to security/architecture.
- **Sources:** https://nextjs.org/docs/app/api-reference/directives/use-cache · https://nextjs.org/docs/app/api-reference/directives/use-cache-private

### NEXT-17 `revalidatePath` misuse (URL vs route pattern, missing `type`, over-invalidation)

- **Signal:** `revalidatePath('/product/[slug]')` without `type`; `revalidatePath('/')` or `('/', 'layout')` after
  every mutation; revalidation called during render.
- **Tool coverage:** none — judgement.
- **Why it hurts:** "If `path` contains a dynamic segment … this parameter is required"; revalidatePath "operates
  on the route file structure, not the URL visible to users" → the intended page stays stale, or the whole site
  is invalidated per write (cost, cold renders).
- **Severity:** minor–major.
- **Remediation:** tags (`cacheTag` + `updateTag`/`revalidateTag`) scoped to the entity; literal path for one page;
  pattern + `type` for all matching pages.
- **Not a finding when:** small static sites where full revalidation is cheap.
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/api-reference/functions/revalidatePath

---

## Server Actions & Route Handlers

### NEXT-18 Server Action without authentication, authorisation (ownership) and input validation inside it

- **Signal:** `'use server'` function (file-level or inline) whose first statements are not (1) a session check,
  (2) a resource-ownership/permission check, (3) schema parsing of every argument (`FormData`, ids); reliance on the
  page's auth redirect or on proxy/middleware; `formData.get('x') as string` casts; returning raw DB records.
  Grep: `'use server'` files → look for `auth(`/`verifySession(` and `.parse(`/`.safeParse(` near the top.
- **Tool coverage:** none — judgement (no Next/CodeQL/Semgrep rule models Server Actions as endpoints).
- **Why it hurts:** "when a Server Action is created and exported, it is reachable via a direct POST request, not
  just through your application's UI"; "A page-level authentication check does not extend to the Server Actions
  defined within it"; missing ownership → IDOR (CWE-639); React: "Arguments to Server Functions are fully
  client-controlled". Return values "are serialized and sent to the client".
- **Severity:** blocker.
- **Remediation:** thin action → `server-only` DAL that authenticates, authorises ownership, validates, and returns
  a minimal result (`return { success: true }`); rate-limit expensive actions. Trap: trusting encrypted action IDs /
  dead-code elimination — "you should still treat Server Actions as reachable via direct POST requests and verify
  authentication and authorization inside each one."
- **Not a finding when:** the action delegates to a DAL function that demonstrably performs all three checks.
- **Architecture:** yes — public endpoint surface; escalate to security.
- **Sources:** https://nextjs.org/docs/app/guides/data-security · https://react.dev/reference/rsc/use-server

### NEXT-19 Closures capturing sensitive values into inline Server Actions; hardcoded secrets in action bodies

- **Signal:** inline `async function x() { 'use server'; … }` inside a component that references variables holding
  tokens, internal ids, pricing, or permission flags from render scope; secret string literals inside `'use server'`
  functions.
- **Tool coverage:** none — judgement; secret scanners for literals.
- **Why it hurts:** "the captured variables are sent to the client and back to the server when the action is
  invoked"; encrypted by default, but "We don't recommend relying on encryption alone"; a closure value can be
  replayed/stale. CVE-2025-55183: source of Server Functions that stringify arguments can leak — "Only hardcoded
  secrets in source code are exposed … Runtime secrets like `process.env.SECRET` are NOT affected".
- **Severity:** major (blocker for secrets).
- **Remediation:** re-read sensitive state on the server inside the action; secrets from env via the DAL; closures
  only for snapshot values that are safe to reveal (e.g. `publishVersion`). For multi-instance self-hosting set
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64 AES 16/24/32 bytes).
- **Not a finding when:** captured values are non-sensitive snapshot identifiers re-validated in the action.
- **Architecture:** no (yes for self-hosted key management).
- **Sources:** https://nextjs.org/docs/app/guides/data-security · https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components

### NEXT-20 Server Actions used for reads / parallel client calls

- **Signal:** Client Components calling an action to _fetch_ data (`const items = await getItemsAction()` in
  `useEffect`/TanStack `queryFn`); `Promise.all([actionA(), actionB()])` from the client.
- **Tool coverage:** none — judgement.
- **Why it hurts:** "Next.js dispatches Server Actions one at a time per client … do not rely on `Promise.all`";
  "Server Actions are queued. Using them for data fetching introduces sequential execution"; React: "not
  recommended for data fetching" and frameworks "do not have a way to cache the return value".
- **Severity:** minor–major (latency, head-of-line blocking of real mutations).
- **Remediation:** read in Server Components and pass down (or `use()` a promise); client-side reads via Route
  Handler + SWR/TanStack Query; do parallel work inside a single action.
- **Not a finding when:** the "read" is the result of a mutation (return value of the write).
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/guides/server-actions · https://nextjs.org/docs/app/guides/backend-for-frontend · https://react.dev/reference/rsc/use-server

### NEXT-21 Route Handlers treated as internal (no auth, no origin/CORS policy, open redirects in callbacks)

- **Signal:** `app/**/route.ts` exporting `POST/PUT/DELETE` without credential verification; `Access-Control-Allow-Origin: '*'`
  with cookie auth; callback handlers doing `NextResponse.redirect(searchParams.get('next'))`; webhook handlers
  without signature verification; secret comparison with `!==` (timing — judgement).
- **Tool coverage:** `codeql:js/server-side-unvalidated-url-redirection` (CWE-601) for redirects;
  `codeql:js/missing-token-validation` targets Express-style CSRF middleware (UNVERIFIED for Route Handlers);
  none for missing auth.
- **Why it hurts:** "Route Handlers are public HTTP endpoints. Any client can access them." Unlike Server Actions,
  there is no built-in Origin/Host check (inferred: the Origin comparison is documented only for Server Actions —
  judgement). Open redirect (CWE-601), CSRF (CWE-352).
- **Severity:** blocker for unauthenticated mutations; major for open redirects.
- **Remediation:** verify credentials in the handler ("Do not rely on proxy alone for authentication and
  authorization"); same-origin check for redirects (`if (destination.origin !== request.nextUrl.origin)`); explicit
  CORS allow-lists; verify webhook signatures; rate limiting.
- **Not a finding when:** intentionally public, read-only, non-sensitive endpoints.
- **Architecture:** yes — API surface; escalate to security.
- **Sources:** https://nextjs.org/docs/app/guides/backend-for-frontend · https://nextjs.org/docs/app/guides/data-security

### NEXT-22 Unvalidated `params` / `searchParams` / headers driving authorisation or queries

- **Signal:** `(await searchParams).isAdmin === 'true'`; `params.id` passed straight to DB without schema/ownership;
  `headers().get('x-user-id')` trusted; string-concatenated SQL.
- **Tool coverage:** `codeql:js/sql-injection` (CWE-89/90/943, verified) for concatenated queries; none for authz-by-param.
- **Why it hurts:** "You should always validate input from client, as they can be easily modified"; audit guidance:
  "Folders with brackets are user input. Are params validated?"
- **Severity:** blocker when it grants access; major otherwise.
- **Remediation:** re-verify identity from the session cookie in the DAL; zod-parse params at the page/action
  boundary; parameterised/tagged-template queries.
- **Not a finding when:** params select public content and are validated for shape.
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/guides/data-security

---

## Proxy (formerly middleware)

### NEXT-23 Authorisation enforced only in `middleware.ts` / `proxy.ts`

- **Signal:** protected data/actions whose only auth gate is a proxy/middleware redirect; DAL/actions/route
  handlers without session checks; matcher that excludes paths (`api`, static, locale prefixes) where actions or
  handlers live; DB lookups inside proxy.
- **Tool coverage:** none — judgement.
- **Why it hurts:** CVE-2025-29927 (GHSA-f82v-jwr5-mffw, CVSS 9.1, CWE-285): "It is possible to bypass
  authorization checks within a Next.js application, if the authorization check occurs in middleware" (spoofed
  `x-middleware-subrequest`; patched 12.3.5 / 13.5.9 / 14.2.25 / 15.2.3). It recurred in a different shape:
  CVE-2026-64642 (GHSA-6gpp-xcg3-4w24, CVSS 8.3, CWE-285) — App Router + Turbopack + a single
  `i18n.locales` entry "can bypass middleware/proxy based authentication" (16.0.0–16.2.10; patched 16.2.11;
  workaround "enforce authorization in the page's server-side data path"). Also by design: Server Functions "are
  handled as POST requests to the route where they are used, so a Proxy matcher that excludes a path will also
  skip Server Function calls on that path … A matcher change or a refactor … can silently remove Proxy coverage."
  Auth guide: Proxy "should not be your only line of defense"; only "optimistic checks … avoid database checks".
- **Severity:** blocker.
- **Remediation:** defense in depth — proxy for optimistic cookie-based redirects only; authoritative checks in the
  DAL (pages, actions, route handlers); unit-test the matcher with `unstable_doesProxyMatch`; keep Next patched.
- **Not a finding when:** proxy is purely UX redirect and every data path re-verifies.
- **Architecture:** yes — auth architecture; escalate to security.
- **Sources:** https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw · https://github.com/vercel/next.js/security/advisories/GHSA-6gpp-xcg3-4w24 · https://nextjs.org/docs/app/api-reference/file-conventions/proxy · https://nextjs.org/docs/app/guides/authentication

### NEXT-24 Proxy doing heavy work, leaking request headers, unscoped matchers, or still named `middleware` on 16

- **Signal:** `middleware.ts` / `export function middleware` on Next 16 (deprecated); `export const runtime` in
  proxy (throws); DB/network calls per request in proxy; no `matcher` (runs on `_next/static`, `_next/image`,
  `public/`); non-constant matcher values; `NextResponse.next({ headers: requestHeaders })` when the intent was to
  forward request headers upstream; relying on shared module globals in proxy.
- **Tool coverage:** v16 codemod `middleware-to-proxy`; error for `runtime` config in proxy; none for the rest.
- **Why it hurts:** "Without a `matcher`, Proxy runs on **every request** … auth logic or redirects can
  unintentionally block CSS, JS, or images"; "The `matcher` values need to be constants … Dynamic values such as
  variables will be ignored"; `NextResponse.next({ headers })` "makes `requestHeaders` available to clients" vs
  `{ request: { headers } }` forwards upstream (CWE-200 when headers carry internal data); proxy runs on
  prefetches too. Edge runtime is "**NOT** supported in `proxy`" (use `middleware` if edge is required).
- **Severity:** major (blocker if internal headers/tokens are reflected to clients).
- **Remediation:** rename to `proxy.ts`/`export function proxy`; negative-lookahead matcher; cookie-only optimistic
  checks; pass data via request headers with `NextResponse.next({ request: { headers } })`.
- **Not a finding when:** app intentionally stays on `middleware` for edge runtime (documented).
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/api-reference/file-conventions/proxy · https://nextjs.org/docs/app/guides/upgrading/version-16

### NEXT-25 Dynamic hostnames in `rewrites()`/`redirects()` built from user input

- **Signal:** `destination: 'https://:tenant.api.example.com'` or `has: [{ type: 'query', key: 'region', value: '(?<region>.+)' }]`
  feeding a hostname.
- **Tool coverage:** none — judgement.
- **Why it hurts:** CVE-2026-64645 (GHSA-p9j2-gv94-2wf4, CVSS 8.3, CWE-918): rewrites → SSRF, redirects → open
  redirect; affected 12.0.0–15.5.20 and 16.0.0–16.2.10; patched 15.5.21 / 16.2.11.
- **Severity:** blocker (SSRF).
- **Remediation:** upgrade; constrain captures to hostname-safe characters (`'(?<region>[a-z0-9-]+)'`); prefer an
  explicit allow-list map from tenant → host.
- **Not a finding when:** destinations are static hosts with dynamic _paths_ only (still validate).
- **Architecture:** yes — multi-tenant routing; escalate to security.
- **Sources:** https://github.com/vercel/next.js/security/advisories/GHSA-p9j2-gv94-2wf4

---

## Built-in components & config

### NEXT-26 `next/image` misuse (raw `<img>`, `priority` on 16, open `remotePatterns`, SVG, auth-required sources)

- **Signal:** `<img>` in App Router pages; `priority` prop on Next 16; `images.domains` (deprecated) or
  `remotePatterns` with wildcard hostnames; `dangerouslyAllowSVG: true` without CSP/`contentDispositionType`;
  `dangerouslyAllowLocalIP: true`; images missing `width`/`height` (and not `fill`); query-string local srcs
  without `localPatterns.search` on 16.
- **Tool coverage:** `@next/next/no-img-element` (warn); TS/runtime for removed/deprecated config; none for
  remotePatterns breadth.
- **Why it hurts:** CLS (width/height "used by browsers to reserve space for the image and avoid layout shift");
  v16: "the `priority` property has been deprecated in favor of the `preload` property" (and "In most cases, you
  should use `loading="eager"` or `fetchPriority="high"` instead of `preload`"); broad remotePatterns turn your
  optimizer into an open proxy — and "allowed `remotePatterns` that respond with a redirect will follow the
  redirect … without validating `remotePatterns` again"; `dangerouslyAllowLocalIP` — "Only enable once you
  understand the SSRF risk"; optimizer CVEs (GHSA-2xp9-vwfh-vxw4: unauthenticated RCE via AVIF/libheif, patched
  15.5.24 / 16.3.3).
- **Severity:** major (blocker for open optimizer on vulnerable versions).
- **Remediation:** `next/image` with dimensions or `fill`+`sizes`; tight `remotePatterns` (protocol+host+path);
  `maximumRedirects` (16 default 3); SVG with `unoptimized`; keep Next patched; `unoptimized` for auth-protected
  sources (docs recommend it).
- **Not a finding when:** `<img>` for data URIs/SVG icons where optimisation adds nothing (still size them).
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/api-reference/components/image · https://nextjs.org/docs/app/guides/upgrading/version-16 · https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4

### NEXT-27 `next/script` and `next/font` misuse

- **Signal:** `<script>` tags for third parties in JSX; synchronous scripts; `strategy="beforeInteractive"` outside
  the root layout; inline `<Script>` without `id`; `strategy="worker"` in App Router; `<link>` to Google Fonts CSS
  instead of `next/font`; font loader called in many components (duplicated instances).
- **Tool coverage:** `@next/next/no-sync-scripts`, `@next/next/inline-script-id` (error),
  `@next/next/no-before-interactive-script-outside-document`, `@next/next/next-script-for-ga`,
  `@next/next/no-page-custom-font`, `@next/next/google-font-display`, `@next/next/google-font-preconnect`,
  `@next/next/no-css-tags`.
- **Why it hurts:** render-blocking scripts hurt LCP/INP; `beforeInteractive` "must be placed inside a root layout";
  `worker` "is not yet stable and does not yet work with the App Router"; CSP nonces harder with raw tags.
- **Severity:** minor–major (by script weight/position).
- **Remediation:** `next/script` with `afterInteractive`/`lazyOnload`; `next/font` exported from one module and
  imported where used (docs' "utility function that exports a font" approach ensures preload only when rendered).
- **Not a finding when:** first-party inline JSON-LD `<script type="application/ld+json">` (still escape content).
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/api-reference/components/script · https://nextjs.org/docs/app/api-reference/components/font · `@next/eslint-plugin-next@16.3.5`

### NEXT-28 Async Request APIs accessed synchronously / legacy sync-compat casts

- **Signal:** `cookies().get(...)`, `headers().get(...)`, `params.slug` without `await`/`use()`; `as unknown as
UnsafeUnwrappedCookies`/`UnsafeUnwrappedHeaders`; sync `params` in `opengraph-image`/`icon`/`sitemap` `id` on 16.
- **Tool coverage:** TypeScript (with `next typegen` `PageProps`/`LayoutProps`/`RouteContext` helpers); codemod
  `next-async-request-api` (not run by the `upgrade` codemod).
- **Why it hurts:** "Starting with **Next.js 16**, synchronous access is fully removed" → runtime breakage; the
  15-era casts hide it from TS.
- **Severity:** blocker on 16; minor on 15 (warning).
- **Remediation:** `await props.params` / `use(props.params)`; `PageProps<'/route/[slug]'>` types; run the async
  request API codemod explicitly.
- **Not a finding when:** Next 14 app (not yet migrated) — but flag as upgrade debt.
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/guides/upgrading/version-16 · https://nextjs.org/docs/app/guides/upgrading/version-15

### NEXT-29 Upgrade-surface drift on 16 (webpack config silently failing Turbopack build, `next lint` gate lost, scroll/image defaults)

- **Signal:** custom `webpack` in `next.config` while `next build` uses Turbopack by default; CI relying on
  `next lint` or `next build` linting; `resolve.fallback`-style silencing of `fs` imports in client code;
  `experimental.turbopack` key; `images.qualities`/`minimumCacheTTL` assumptions; `process.argv.includes('dev')`
  checks in `next.config`.
- **Tool coverage:** build fails for webpack config under Turbopack ("the build will **fail** to prevent
  misconfiguration"); none for the lost lint gate.
- **Why it hurts:** lint no longer runs anywhere; `qualities` default now `[75]` (other `quality` props coerced);
  `minimumCacheTTL` default 60 s → 4 h (stale images); `process.argv` 'dev' check now `false`.
- **Severity:** major for lost CI gates; minor otherwise.
- **Remediation:** wire ESLint CLI in CI (`next-lint-to-eslint-cli` codemod); fix client imports of Node built-ins
  ("It is preferable to refactor your modules so that client code doesn't ever import from modules using Node.js
  native modules") rather than `turbopack.resolveAlias`; explicit image config.
- **Not a finding when:** the repo has already migrated with explicit CI lint.
- **Architecture:** no.
- **Sources:** https://nextjs.org/docs/app/guides/upgrading/version-16

### NEXT-30 Unpatched Next/React RSC runtime

- **Signal:** `next` within vulnerable ranges: CVE-2025-66478 (React2Shell; fixed 15.0.5, 15.1.9, 15.2.6, 15.3.6,
  15.4.8, 15.5.7, 16.0.7); React RSC DoS/source-exposure fixes need `react-server-dom-*` 19.0.4 / 19.1.5 / 19.2.4
  (bundled by Next — check Next's release notes for the matching Next version, not verified here);
  CVE-2026-64642/64645 (patched 16.2.11 / 15.5.21); GHSA-2xp9-vwfh-vxw4 (patched 15.5.24 / 16.3.3); other July 2026
  advisories on the index (Server Action DoS GHSA-m99w-x7hq-7vfj, SSRF in Server Actions on custom servers
  GHSA-89xv-2m56-2m9x, cache confusion GHSA-68g3-v927-f742 / GHSA-4633-3j49-mh5q, SVG optimizer DoS
  GHSA-q8wf-6r8g-63ch, Edge Server Action payload GHSA-4c39-4ccg-62r3, Windows RCE GHSA-p293-qw3h-jr36) — patched
  versions for these not individually opened.
- **Tool coverage:** `npm audit` / Dependabot / GHSA-backed scanners (coverage lag noted for Trivy in a public
  issue — not relied upon).
- **Why it hurts:** unauthenticated RCE (CVSS 10.0) — Next: "If your application was online and unpatched as of
  December 4th, 2025 at 1:00 PM PT, we strongly encourage you to rotate any secrets"; "There is no workaround".
- **Severity:** blocker.
- **Remediation:** upgrade within release line; rotate secrets after exposure windows; subscribe to the advisory feed.
- **Not a finding when:** version is at/after all patched releases (verify against the live advisory index).
- **Architecture:** yes — patch cadence/ops; escalate to security/ops.
- **Sources:** https://nextjs.org/blog/CVE-2025-66478 · https://github.com/vercel/next.js/security/advisories · https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components

---

## Security-hygiene overlap

| Concern                                           | CWE                         | CodeQL                                                                                                           | Semgrep                                                                                       | Next-specific signal                                                                                                                                                                                                                                                                     | Entry               |
| ------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Server Action / Route Handler missing authz; IDOR | CWE-285, CWE-862, CWE-639   | none — judgement                                                                                                 | none                                                                                          | `'use server'` without session + ownership check                                                                                                                                                                                                                                         | NEXT-18, NEXT-21    |
| Middleware/proxy-only auth bypass                 | CWE-285                     | none                                                                                                             | none                                                                                          | auth only in `proxy.ts`/`middleware.ts`; matcher gaps                                                                                                                                                                                                                                    | NEXT-23             |
| CSRF                                              | CWE-352                     | `js/missing-token-validation` (CWE-352; models Express-style CSRF middleware — applicability to Next UNVERIFIED) | none                                                                                          | mutations on GET/render (NEXT-14); Route Handlers accepting cookie-auth POST without origin check (NEXT-21). Server Actions: POST-only + Origin vs Host (or `X-Forwarded-Host`) comparison; behind reverse proxies configure `serverActions.allowedOrigins` rather than disabling checks | NEXT-14, NEXT-21    |
| Open redirect                                     | CWE-601                     | `js/server-side-unvalidated-url-redirection`, `js/client-side-unvalidated-url-redirection`                       | `typescript.react.security.audit.react-href-var.react-href-var` (client links)                | `redirect(searchParams.get('next'))`, callback handlers, dynamic `redirects()` hosts                                                                                                                                                                                                     | NEXT-21, NEXT-25    |
| SSRF                                              | CWE-918                     | `js/request-forgery` (CWE-918, verified)                                                                         | none                                                                                          | dynamic hostnames in `rewrites()`; broad `remotePatterns`; `dangerouslyAllowLocalIP`                                                                                                                                                                                                     | NEXT-25, NEXT-26    |
| Secrets exposure to client                        | CWE-200, CWE-798            | none (no hardcoded-credentials query in the CodeQL JS query-help index as opened)                                | none                                                                                          | `NEXT_PUBLIC_*SECRET*`; over-broad props; missing `server-only`; secret literals in `'use server'` (CVE-2025-55183)                                                                                                                                                                      | NEXT-02–04, NEXT-19 |
| Cross-user cache leakage                          | CWE-524, CWE-200            | none                                                                                                             | none                                                                                          | user data in shared `use cache` scopes                                                                                                                                                                                                                                                   | NEXT-16             |
| XSS                                               | CWE-79                      | `js/xss`, `js/reflected-xss`, `js/stored-xss`                                                                    | `typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml` | `dangerouslySetInnerHTML` (see `react.md` REACT-42); unescaped JSON-LD script content; `dangerouslyAllowSVG`                                                                                                                                                                             | NEXT-26, REACT-42   |
| Deserialisation RCE in RSC                        | CWE-502 (mapping judgement) | none                                                                                                             | none                                                                                          | vulnerable `next`/`react-server-dom-*` versions                                                                                                                                                                                                                                          | NEXT-30             |

---

## Open questions / unverified

- Whether string-literal bracket access `process.env['NEXT_PUBLIC_X']` is inlined by both webpack and Turbopack
  in Next 16 (NEXT-05) — docs only list variable-key and aliased `process.env` as non-inlined.
- Exact build error text for a server `error.tsx` without `'use client'` (NEXT-12).
- Route Handlers have no built-in CSRF/Origin check — inferred from the docs documenting that check only for Server
  Actions; not stated explicitly (NEXT-21).
- CodeQL ids verified: `js/request-forgery`, `js/sql-injection`, `js/server-side-unvalidated-url-redirection`,
  `js/missing-token-validation`. No `js/hardcoded-credentials` query appears in the JS query-help index. Whether
  `js/missing-token-validation` models Next Route Handlers was not verified.
- Patched versions for the July/August 2026 advisories other than GHSA-6gpp, GHSA-p9j2, GHSA-2xp9 were not opened;
  which Next release bundles `react-server-dom-*` 19.2.4 (CVE-2026-23864) not verified.
- `next/font` "call the loader once at module scope" rule: the docs page opened shows the shared-utility approach
  but I did not locate an explicit prohibition text.
- No primary source quantifies acceptable client-bundle size for App Router routes; Next 16 also removed the
  `First Load JS` metric from build output ("inaccurate in server-driven architectures") — bundle-size findings
  need Lighthouse/analyzer evidence, not the old build table.
