# Contract: Public Address and App Links

**Feature**: [spec.md](../spec.md) | FR-014, FR-015, FR-019 | `021-FR-010`, `021-FR-016`, `021-FR-035`

⚠️ One-way door. Shared links, search results and the platforms' association caches all hold these values.

## The public address

```text
https://commise.app/recipe/{id}/{slug}
```

- `id` is the recipe's UUID. `slug` is derived from the title by one pure function and is never stored.
- There is no locale segment. The page's own words follow the open question Q3 ruling once a second locale ships.
- A query string is allowed and ignored by the page and the cache. Measurement reads only whether a share mark is
  present (`021-FR-031`, `021-FR-080`).
- `GET /recipe/{id}` and `GET /recipe/{id}/{wrongSlug}` answer `308` to the right slug only when the recipe is open.
  Otherwise they answer the not-available page with status `404`. The redirect never reveals a closed recipe's title.
- Every other request under `/recipe/` answers the not-available page with status `404`.
- One parser, `parsePublicRecipePath`, is the authority. The web route, the middleware exclusion, the native gate, the
  native linking config and the association files' path list all use it or its exported prefix.

The in-app address `/{locale}/recipes/{id}` is unchanged. A signed-out visitor there is sent to `/recipe/{id}`, which
then answers `308` or `404` as above (`021-FR-018`).

## The page shell

`app/recipe/layout.tsx` is a second root layout with no `ClerkProvider`, so nothing on a public page can start a Clerk
session or set a Clerk cookie. Signed-in extras load through `React.lazy` only when a Clerk cookie already exists.

## The sign-up return

A signed-out tap on "Save a copy" or "Rate this recipe" sends the reader to sign up or sign in with the return path
`/{locale}/recipes/{id}?then=saveCopy` or `?then=rate`. That is the in-app address, which `safeReturnPath` already
accepts, and which shows another cook's open recipe to a signed-in reader (`021-FR-018`). `then` is parsed against the
closed set. A value outside it is ignored. The action is offered once for the reader to accept or refuse. It is never
done without them.

## Middleware

- `/recipe/` and `/.well-known/` are excluded from the `clerkMiddleware` matcher and from the locale redirect. No Clerk
  handshake, redirect or `Set-Cookie` can reach a public response.
- `tests/middleware.test.ts` gains rows that pin both exclusions and pin that `/recipes/` (the in-app route) is still
  matched.

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
                "components": [{ "/": "/recipe/*", "comment": "Public recipe pages only (003A, 021-FR-035)" }]
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
- Signed in, `NavigationContainer`'s `linking` maps `/recipe/:id/:slug?` to the existing recipe screen (ADR-0056).
- A link that arrives while signed out, followed by a sign-in from the public view, is handed to the navigator after
  sign-in, with any pending action (`saveCopy`, `rate`) offered once.
- A native build is required. An over-the-air update cannot add associated domains.
