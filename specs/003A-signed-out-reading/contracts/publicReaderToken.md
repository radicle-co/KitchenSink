# Contract: Recipe-signed Service Tokens for Public Reads

**Feature**: [spec.md](../spec.md) | FR-009, FR-012 | research R2, R4

⚠️ One-way door: the issuer and audience strings, the algorithm, and the key material. A token minted with one value
and verified against another fails every public read.

recipe-service signs one kind of short-lived token for two audiences. The token names no user and no recipe. Each
audience grants the internal routes of one service. The shape follows the erasure token
(`recipe-core/src/serviceErasureToken.ts`). It is asymmetric and is verified with no network call. The verifier pins
the issuer, audience, algorithm and subject.

## Token

| Part      | Value                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Header    | `{ alg: 'EdDSA', kid }`. `kid` names the key, so a verifier can hold the current and the previous key |
| `iss`     | `urn:commise:recipe-service:public-reader`                                                            |
| `aud`     | `urn:commise:food-service:public-read` or `urn:commise:identity-service:author-standing`              |
| `sub`     | `svc_public-reader`                                                                                   |
| `exp`     | `iat + 60`. The verifier refuses any token with `exp - iat` over 120                                  |
| Algorithm | Ed25519. The verifier pins it, so `alg: none` and an `HS256` swap are refused                         |

Each verifying service has its own audience. A token taken from one leg cannot be replayed on the other.

**Where the constants live.** Food's pair (issuer, audience) lives in `@kitchensink/recipe-core`
(`publicReaderToken.ts`), which food already imports for the erasure token. Identity's pair lives in
`@kitchensink/identity-core` (`authorStandingToken.ts`). recipe-core does not gain a dependency on identity-core: the
signer in recipe-service imports each verifier's pair. An integration test signs with the real signer and verifies
with each real verifier, so the two issuer strings cannot drift apart.

**Keys.** A provisioner Lambda in `infra/global` (`PublicReaderKeyStack`, one per base stage) generates the Ed25519
pair inside AWS, following the remote-search key's precedent. It stores the private key in Secrets Manager and
publishes the secret's ARN and the public key to SSM. recipe-service reads the private key as an ECS secret. Food and
identity read the public key from SSM into their environment. No person handles the private key. The provisioner is
not attached to the VPC.

## Food: public-reader routes

Two internal routes. Each answers the existing request and response schemas of its public twin, so recipe's food
gateways parse them unchanged.

| Route                                       | Twin                               |
| ------------------------------------------- | ---------------------------------- |
| `POST /api/v1/internal/foods/refs/resolve`  | `POST /api/v1/foods/refs/resolve`  |
| `GET /api/v1/internal/foods/nutrition?ids=` | `GET /api/v1/foods/nutrition?ids=` |

- Both sit under `/api/v1/internal/*`, which the production edge already passes through (ADR-0020 trap 3).
- Both answer `Cache-Control: private, no-store`. No `/v1` alias.
- The controller carries `PublicReaderGuard` and is not covered by `FoodAuthGuard`. The `internalRouteGuards` guard
  fails the build for an internal controller with no token guard.
- The requester is `svc_public-reader`. Food's existing authorship gate already answers a private food as `absent` to a
  requester that is not its author.
- The answer audience is `{ kind: 'publicReader' }`, and `marksRealHold` returns `false` for it (ADR-0040, amended by
  this feature's ADR). A public read holds no root. That is safe because any real cook who bound a root already holds
  it through their own signed-in answers.
- `@kitchensink/food-service-client` takes `apiPrefix: '/api/v1/foods' | '/api/v1/internal/foods'`. Today its paths
  are fixed in the code.

## Identity: author standing

`POST /api/v1/internal/accounts/standing`, answered `private, no-store`, canonical path only.

- Request: `{ userIds: string[] }`, 1 to 24 app-user ULIDs. More is `400`.
- Response: `{ standings: { userId, standing }[] }`, where `standing` is one of `active`, `suspended`, `closed`,
  `erased` or `unknown`. Identity maps `users.status`: `tombstoned` becomes `closed`. An id with no row is `unknown`.
- Identity's `AuthMiddleware` exempts exactly this path. Its `PublicReaderGuard` checks the token.
- recipe-service reads a timeout, an error, a missing entry or `unknown` as closed, and answers the public read `503`.
- `active` opens. `erased` opens too, for a recipe the erasure left public, shown with no author (owner ruling
  2026-11-09, spec Q8). `suspended`, `closed` and `unknown` close.
