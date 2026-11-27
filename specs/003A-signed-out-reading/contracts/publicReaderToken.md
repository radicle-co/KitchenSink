# Contract: Recipe-signed Service Tokens for Public Reads

**Feature**: [spec.md](../spec.md) | FR-009 | research R2

⚠️ One-way door: the issuer and audience strings, the algorithm, and the key material. A token minted with one value
and verified against another fails every public read.

recipe-service signs one kind of short-lived token for one audience, food's internal routes. The token names no user and no recipe. The shape follows the erasure token
(`recipe-core/src/serviceErasureToken.ts`). It is asymmetric and is verified with no network call. The verifier pins
the issuer, audience, algorithm and subject.

## Token

| Part      | Value                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Header    | `{ alg: 'EdDSA', kid }`. `kid` names the key, so a verifier can hold the current and the previous key |
| `iss`     | `urn:commise:recipe-service:public-reader`                                                            |
| `aud`     | `urn:commise:food-service:public-read`                                                                |
| `sub`     | `svc_public-reader`                                                                                   |
| `exp`     | `iat + 60`. The verifier refuses any token with `exp - iat` over 120                                  |
| Algorithm | Ed25519. The verifier pins it, so `alg: none` and an `HS256` swap are refused                         |

**Where the constants live.** The issuer and audience live in `@kitchensink/recipe-core` (`publicReaderToken.ts`), which food already imports for the erasure token. An integration test signs with the real signer and verifies with food's real verifier.

**Keys.** A provisioner Lambda in `infra/global` (`PublicReaderKeyStack`, one per base stage) generates the Ed25519
pair inside AWS, following the remote-search key's precedent. It stores the private key in Secrets Manager and
publishes the secret's ARN and the public key to SSM. recipe-service reads the private key as an ECS secret. Food reads the public key from SSM into its environment. No person handles the private key. The provisioner is
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
