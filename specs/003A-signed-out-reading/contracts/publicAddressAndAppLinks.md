# Contract: Public Address and App Links

**Feature**: [spec.md](../spec.md) | FR-014, FR-015, FR-019 | `021-FR-010`, `021-FR-016`, `021-FR-035`

⚠️ One-way door. Shared links, search results and the platforms' association caches all hold these values.

## The public address

```text
https://commise.app/{locale}/recipe/{id}/{slug}
```

- `id` is the recipe's UUID. `slug` is derived from the title by one pure function and is never stored.
- `locale` is a shipped locale (owner 2026-11-20). The page's own words follow it (below).
- A query string is allowed and ignored by the page, and each distinct query string is its own cache entry with the same bytes (003A-FR-015). Measurement reads only whether a share mark is
  present (`021-FR-031`, `021-FR-080`).
- `GET /{locale}/recipe/{id}` and `GET /{locale}/recipe/{id}/{wrongSlug}` answer `308` to the right slug only when the recipe is open.
  Otherwise they answer the not-available page with status `404`. The redirect never reveals a closed recipe's title.
- Every other request under `/{locale}/recipe/` answers the not-available page with status `404`.
- One parser, `parsePublicRecipePath`, is the authority. The web route, the middleware, the native gate, the
  native linking config and the association files' path list all use it or its exported prefix.
- The two addresses stay two (owner 2026-11-20): the in-app `/{locale}/recipes/{id}` and the public
  `/{locale}/recipe/{id}/{slug}`. Merging them is out of scope.

The in-app address `/{locale}/recipes/{id}` is unchanged. For a signed-out visitor there, the recipe detail page asks
the public read. On `200` it redirects to the canonical `/{locale}/recipe/{id}/{slug}` (`021-FR-018`). On anything else it keeps
today's sign-in redirect with its return path (spec FR-027), so the dark build never cuts off today's path to a public
recipe.

## The page shell

The web app has no `app/layout.tsx`. `[locale]/layout.tsx` is a root layout and mounts `ClerkProvider` through
`appDocument.tsx`. So the public route needs a root layout with no `ClerkProvider` (how it sits beside `[locale]/layout.tsx` is settled in
the U6 blueprint). It renders a variant of the document shell without Clerk, so nothing on a public page can start a Clerk
session or set a Clerk cookie. Signed-in extras load through `React.lazy` only when a Clerk cookie already exists.

## The sign-up return

A signed-out tap on "Save", "Save a copy" or "Rate this recipe" sends the reader to sign up or sign in with the return path
`/{locale}/recipes/{id}?then=save`, `?then=saveCopy` or `?then=rate`. That is the in-app address, which `safeReturnPath` already
accepts, and which shows another cook's open recipe to a signed-in reader (`021-FR-018`). `then` is parsed against the
closed set. A value outside it is ignored. The action is offered once for the reader to accept or refuse. It is never
done without them.

## Locale, page language and the cache key (owner 2026-11-20, reverses spec Q3)

⚠️ This changes a one-way door: the locale is in the address, and the cache key is the one `003A-FR-015` states (it amends
`021-FR-062`).

- The page's own words (headings, buttons, states) are in the locale in the address, with English as the catalog
  fallback. The recipe's own text is never translated.
- A locale-less `/recipe/{id}/{slug}` redirects to the locale `Accept-Language` negotiates. A browser that matches no
  shipped locale (for example `fr-FR`, or `en-GB` while only `en-US` ships) goes to `en-US`, the default route locale. A bare
  `/en/recipe/...` has its locale replaced by the negotiated one and is never mapped straight to a market.
- The page is a server render with no ISR. It sends `s-maxage` with no `Vary: Accept-Language`, so the CDN key is the one `003A-FR-015` states.

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

Android's intent filter carries `android:autoVerify="true"` and `pathPrefix="/recipe/"` only.

**Never associated**: sign-in, sign-up, the OAuth return path, `/{locale}/*` and every other route. If the app captured
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
