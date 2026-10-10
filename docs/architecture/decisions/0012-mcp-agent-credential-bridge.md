# 0012 — MCP agent credential bridge: Clerk proves identity, we own the grant

- **Status:** Accepted
- **Date**: 2026-08-02

## Context

Feature 005 exposes a Model Context Protocol (MCP) server so external agent platforms (ChatGPT, Claude,
Gemini) can read a user's recipe collection and create recipes on their behalf (FR-018), with **separate,
separately-consentable** read and write scopes (`recipes:read` / `recipes:create`, decision D-001) and
revocation at any time (FR-021).

Three facts constrain the design, all verified against the live platform on 2026-08-02:

1. **Clerk can be the OAuth authorization server for an MCP server.** `@clerk/mcp-tools` supplies
   `verifyClerkToken()` / `mcpAuthClerk`, which verify a Clerk-issued **OAuth access token** and expose
   the user id. ChatGPT performs OAuth **Dynamic Client Registration** automatically, so the connector
   self-registers — but DCR must be switched on
   (`instance/oauth_application_settings.dynamic_oauth_client_registration = true`).
2. **Clerk does NOT support custom OAuth scopes.** The provider offers only `profile`, `email`,
   `public_metadata`, `private_metadata`, `openid`, and `user:org:read`; custom scopes are "not yet
   available, development underway". `recipes:read` / `recipes:create` therefore **cannot** be Clerk OAuth
   scopes, and Clerk's own consent screen cannot render D-001's two checkboxes.
3. **Every backend service authenticates a Clerk _session token_**, not an OAuth access token —
   `@kitchensink/clerk-verify` wraps `verifyToken` against a pinned PEM and enforces `azp`. An OAuth access
   token is a different artifact and will not authenticate against it.

So there is a gap between the credential the agent holds and the credential the services accept, and no
way to carry our scopes inside either one.

### Options considered

| Option                                              | Why rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend `clerk-verify` to accept OAuth access tokens | Authenticates the user, but the token has nowhere to carry per-agent scopes (constraint 2), so D-001 is unimplementable.                                                                                                                                                                                                                                                                                                                                                                           |
| Session token with scopes from a JWT template       | JWT templates are filled from **shortcodes** over user/session data, never caller-supplied per-request values — forcing scopes onto `user.public_metadata`, which makes them **user-global, not per-grant**. ChatGPT and Gemini would necessarily receive identical scopes. Worse, `public_metadata` is already this repo's **admin** scope channel and `ScopesGuard` satisfies a requirement from `scopes` **OR** `permissions`, so an agent token becomes indistinguishable from an admin token. |
| M2M token + MCP-asserted user id                    | Re-opens the shape PR #39 removed (a caller-supplied identity in front of a public ALB). Signed, so stronger than the old forgeable header — but identity stops being Clerk-attested end-to-end.                                                                                                                                                                                                                                                                                                   |
| Wait for Clerk custom OAuth scopes                  | On Clerk's roadmap with no date. Not a v1 plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Decision

**Split identity from authorization. Clerk proves _who_; we own _what_.**

1. **Identity — Clerk OAuth + DCR.** The agent runs Clerk's OAuth flow. ChatGPT self-registers via DCR;
   the user authenticates in an **external browser** (the flow cannot render inside the chat client).
   Enable DCR on the instance.
2. **Grant — our consent screen, our table.** A page in `@commise/web` — which we control — presents
   D-001's two distinct checkboxes and writes the grant (agent, scopes, timestamp) to
   `mcp_oauth_consents`. Read may be granted without write. FR-018's intent is satisfied by our UI rather
   than Clerk's consent screen; **FR-018's wording must be updated to say so**.
3. **Downstream credential — a Clerk actor-token session.** To call recipe-service / food-service on the
   user's behalf, the MCP server mints an **actor token** (`POST /v1/actor_tokens`, `user_id` = the user,
   `actor.sub` = the MCP server's machine identity) and uses the resulting session token. That token is a
   normal Clerk-signed session token, so **downstream services keep their existing trust model unchanged**.
4. **Scope enforcement — the MCP server's policy module.** Before invoking a tool the MCP server checks
   the grant in `mcp_oauth_consents`. `recipe_save` requires `recipes:create`; it also enforces D-004
   (agents may only create `private` recipes, non-private payloads rejected `400`). One module owns both
   invariants.

### The `azp` seam — reuse the existing pattern, do not loosen it

An actor-token session token will not carry the browser-origin `azp` our guard expects. `clerkVerify.ts`
already solves exactly this shape for the mobile app: `assertAzpMatchesPattern` admits an `azp`-less token
**only** when a positive claim gate returns true, and `isNativeClientToken` keys on an explicit
`client_type: 'native'` claim — never on `azp`-absence.

Add a sibling gate for agent traffic keyed on the **`act` claim** (Clerk includes `act` only for an
impersonated session), and scope it to **our MCP server's specific actor `sub`** — not merely "`act`
exists", or an unrelated impersonated session (e.g. support-staff impersonation) would be admitted through
the agent path. This follows the existing docblock's rule verbatim: a token is admitted because it
**proves** what it is, not because it lacks an origin. The gate lives in the shared package, so all three
services gain it once.

## Consequences

**Good**

- D-001, D-004 and FR-021 are all implementable **today**, with no dependency on a Clerk roadmap item.
- Revocation is a row update, checked per tool call — **immediate**, versus the ~60s session-token refresh
  lag a token-carried scope would have had.
- Identity stays **Clerk-attested end-to-end**; no service ever trusts a caller-supplied user id.
- The `act` claim gives downstream services **provenance for free** — a call made via an agent is
  distinguishable from one made by the user, in the token, for logs and audit.
- Actor-token sessions are bounded by `session_max_duration_in_seconds` (default 30 min), capping the
  window of any leaked downstream credential.

**Bad / accepted risk**

- **The MCP server is a trusted enforcement point.** Downstream services see a fully-authorized user
  session and rely on the MCP server having checked scope. A compromised MCP server can exceed granted
  scopes and can mint a session for any user. Mitigations: Clerk secret-key custody, the bounded actor
  session duration, the `act` claim making agent traffic visible, and concentrating the check in one
  audited policy module. **This is the single largest security assumption in feature 005 and must be
  restated in its threat model.**
- Clerk's impersonation feature is designed for support-staff use. Using it for agent delegation is
  off-label, though structurally identical. Revisit if Clerk ships a first-class delegation primitive.
- Minting costs a Clerk API round-trip. Amortize per session, not per tool call — it is on the path to
  SC-003's 15-second budget.

## Follow-ups

- Re-check **custom OAuth scope** support at implementation time; if it lands, the consent screen can move
  back to Clerk and step 2 simplifies.
- Confirm whether `verifyClerkToken` validates locally or **introspects over the network** — a per-tool-call
  round trip is an SC-003 risk.
- **Spike the sign-up chain**: an unauthenticated user hitting `/authorize` should be redirected to our
  sign-in page (which per FR-045a carries the only sign-up affordance) and return to consent. Plausible,
  unverified, and it interacts with the no-landing-page decision — verify against the sandbox instance
  before writing it into the spec as supported.

## References

- `specs/005-ai-integration/spec.md` FR-018, FR-020, FR-021; `review.md` D-001, D-004
- ADR-0001 (`azp` as the sandbox trust boundary), PR #39 (why no caller-supplied identity)
- `packages/shared/clerk-verify/src/clerkVerify.ts` — `assertAzpMatchesPattern`, `isNativeClientToken`
- [Clerk — Build an MCP server](https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server),
  [How Clerk implements OAuth](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth),
  [User impersonation](https://clerk.com/docs/guides/users/impersonation),
  [JWT templates](https://clerk.com/docs/guides/sessions/jwt-templates)
