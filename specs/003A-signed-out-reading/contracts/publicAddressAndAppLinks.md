# Contract: Public Address and App Links

**Feature**: [spec.md](../spec.md) | FR-014, FR-015, FR-019 | `021-FR-010`, `021-FR-016`, `021-FR-035`

⚠️ One-way door. Shared links, search results and the platforms' association caches all hold these values.

## The public address

```text
https://commise.app/{locale}/recipe/{id}/{slug}
```

- `id` is the recipe's public id, a UUID. It is stored in `recipe_public_ids` (data-model, Public id) and is never the recipe's row id. It changes at most once: when an erasure scrubs a name from the title (`016-FR-037`), the row is replaced by a new one. The old id goes into `recipe_retired_public_ids`, which links to nothing. `slug` is derived from the title by one pure function and is never stored.
- `locale` is a shipped locale (owner 2026-11-20). The page's own words follow it (below).
- Unknown query parameters are stripped with a `308` to the same address without them, and only the `003A-FR-015` allowlist is kept (each kept string is cached as `003A-FR-015` states). Measurement reads only whether a share mark is
  present (`021-FR-031`, `021-FR-080`).
- `GET /{locale}/recipe/{id}` and `GET /{locale}/recipe/{id}/{wrongSlug}` answer `308` to the right slug only when the recipe is open.
  Otherwise they answer the not-available page with status `404`. The redirect never reveals a closed recipe's title.
- A retired id answers `410` with the not-available page and `noindex`, for every slug, with no redirect (spec FR-014).
    - `src/middleware.ts` produces it: it asks U13's state route and rewrites to the not-available page with status `410`, because an App Router page can only give `404` (`notFound()`).
    - On any other answer or a failed call it passes through. The page then answers `404`, since the public read never reads a retired id.
- Every other request under `/{locale}/recipe/` answers the not-available page with status `404`.
- One parser, `parsePublicRecipePath`, is the authority. The web route, the middleware, the native gate, the
  native linking config and the association files' path list all use it or its exported prefix.
- The two addresses stay two (owner 2026-11-20): the in-app `/{locale}/recipes/{id}` and the public
  `/{locale}/recipe/{id}/{slug}`. Merging them is out of scope.

The in-app address `/{locale}/recipes/{id}` is unchanged. For a signed-out visitor there, the recipe detail page asks
for the recipe's current public id by the row id it holds, then asks the public read with that public id. On `200` it redirects to the canonical `/{locale}/recipe/{id}/{slug}`, built from the public id in the answer (`021-FR-018`), so the row id never reaches a public address. The lookup refuses a recipe with the erasure marker (data-model, Erased owner), so that visitor gets the sign-in redirect below. Signed in, the in-app read accepts only such a recipe's current public id. Every in-app recipe response carries `publicId`, and the app links any recipe the viewer does not own by it (U13), so no row-id link reaches a renamed recipe (`016-FR-037`). The public read and the public address accept only a current public id, and `/{locale}/recipe/{rowId}/…` answers `404`, not a redirect. If the public read answers anything else, the page keeps
today's sign-in redirect with its return path (spec FR-027), so the dark build never cuts off today's path to a public
recipe.

## The page shell

The web app has no `app/layout.tsx`. `[locale]/layout.tsx` is a root layout and mounts `ClerkProvider` through
`appDocument.tsx`. So the public route needs a root layout with no `ClerkProvider` (a `(public)` route group with its own root layout, so `[locale]/layout.tsx` never wraps it; plan, Structure Decision). It renders a variant of the document shell without Clerk, so nothing on a public page can start a Clerk
session or set a Clerk cookie. Signed-in extras load through `React.lazy` only when a Clerk cookie already exists.

## The sign-up return

A signed-out tap on "Save", "Save a copy" or "Rate this recipe" sends the reader to sign up or sign in with the return path
`/{locale}/recipes/{id}?then=save`, `?then=saveCopy` or `?then=rate`. `{id}` is the public id, because the public page never holds the row id. The signed-in read resolves a current public id to its recipe, and a retired one answers `404` (data-model, Public id). That is the in-app address, which `safeReturnPath` already
accepts, and which shows another cook's open recipe to a signed-in reader (`021-FR-018`). `then` is parsed against the
closed set. A value outside it is ignored. The action is offered once for the reader to accept or refuse. It is never
done without them.

## Locale, page language and the cache key (owner 2026-11-20, reverses spec Q3)

⚠️ This changes a one-way door: the locale is in the address, and the cache key is the one `003A-FR-015` states (it amends
`021-FR-062`).

- The page's own words (headings, buttons, states) are in the locale in the address, with English as the catalog
  fallback. The recipe's own text is never translated.
- A locale-less `/recipe/{id}/{slug}` redirects (`307`) to the locale `Accept-Language` negotiates. A browser that matches no
  shipped locale (for example `fr-FR`, or `en-GB` while only `en-US` ships) goes to `en-US`, the default route locale. A bare
  `/en/recipe/...` has its locale replaced by the negotiated one (U12). Both redirects are `307`. Commise never emits a locale-less or bare `/en` address, so these only catch typed, truncated or old links.
- The page is a server render with no ISR. It sends `Vercel-CDN-Cache-Control` (`s-maxage`) with no `Vary: Accept-Language`, so the CDN key is the one `003A-FR-015` states.

## Middleware

- `/{locale}/recipe/*` is handled first, by the redirects above, and never reaches `clerkMiddleware`. No Clerk handshake,
  redirect or `Set-Cookie` can reach a public response.
- `/.well-known/` is excluded from the middleware and from the locale redirect.
- `tests/middleware.test.ts` gains rows that pin both, and that `/recipes/` (the in-app route) still goes through
  Clerk.

## Association files

Served by Next route handlers with status `200`, `Content-Type: application/json`, and no redirect. They are served
only where the production app ids are configured. Every other stage answers `404`, so a preview never claims the
production app.

### `/.well-known/apple-app-site-association`

```json
{
    "applinks": {
        "details": [
            {
                "appIDs": ["{TEAM_ID}.{BUNDLE_ID}"],
                "components": [{ "/": "/*/recipe/*", "comment": "Public recipe pages only (003A, 021-FR-035)" }]
            }
        ]
    },
    "webcredentials": { "apps": ["{TEAM_ID}.{BUNDLE_ID}"] }
}
```

`webcredentials` keeps what Clerk needs today. The team id and bundle id come from the app config, never typed twice.

### `/.well-known/assetlinks.json`

```json
[
    {
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": "{ANDROID_PACKAGE}",
            "sha256_cert_fingerprints": ["{PLAY_APP_SIGNING_SHA256}", "{UPLOAD_KEY_SHA256}"]
        }
    }
]
```

Android's intent filter carries `android:autoVerify="true"` and `pathPattern="/.*/recipe/.*"` only.

**Never associated**: sign-in, sign-up, the OAuth return path, every `/{locale}/*` route except `/{locale}/recipe/*`, and every other route. If the app captured
a sign-in return, web sign-in breaks on any phone with the app installed (`021-FR-035`).

## Native

- iOS: `associatedDomains` gains `applinks:commise.app` beside the existing `webcredentials:` entry, in production
  builds only.
- Android: one intent filter as above, in production builds only.
- Signed out, the auth gate reads the incoming link with `parsePublicRecipePath`. A match sets the gate state
  `{ kind: 'publicRecipe', recipeId }`. The state exists only with its link, so the gate still has no landing member
  (`001-FR-045a`). Close or Back returns to `login`.
- Signed in, `NavigationContainer`'s `linking` maps `/:locale/recipe/:id/:slug?` to the existing recipe screen (ADR-0056).
- A link that arrives while signed out, followed by a sign-in from the public view, is handed to the navigator after
  sign-in, with any pending action (`save`, `saveCopy`, `rate`) offered once.
- A native build is required. An over-the-air update cannot add associated domains.

## Internal public-id lookups (server only)

- `GET /api/v1/internal/recipes/{rowId}/public-id` returns `{ publicId }`, or the one `404` body when the recipe is missing or carries the erasure marker.
- `GET /api/v1/internal/public-ids/{id}` returns `{ state: 'current' } | { state: 'retired' }`, else `404`. Caller: the web server. No recipe is read for a retired id.
- `GET /api/v1/internal/notice-targets/{id}` returns `{ state: 'current', recipeId } | { state: 'retired' }`, else `404`. Caller: identity's notice intake (`016` L121-02).
- All three are zod-authored in recipe-service and copied to `@kitchensink/schema-recipe` (ADR-0014), and all are `no-store`.
- Callers: the web server (the row-id and state routes) and identity's notice intake (the notice-target route). Each route accepts only its named caller's secret. Each caller has its own secret, compared in constant time, with two values accepted during rotation (U8's runbook).
