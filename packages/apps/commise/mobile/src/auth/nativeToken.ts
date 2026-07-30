/**
 * The Clerk JWT template the mobile app mints EVERY backend-bound token from. Unlike a browser session
 * token, a native token has no origin and therefore no `azp` claim — which the backend's pattern-mode
 * `azp` enforcement (sandbox/prod) rejects by default. This template stamps `client_type: 'native'` (and
 * carries `external_id` + `public_metadata`, the claims the services read), giving the services' native
 * admission gate (`clerk-verify`'s `isNativeClientToken`) a POSITIVE signal to admit the azp-less token.
 *
 * Every `getToken(...)` used for a request to the identity OR recipe service MUST pass `{ template }` —
 * a plain `getToken()` returns the azp-less default session token, which those services 401 in pattern
 * mode. The template is provisioned on the Clerk instance (name must match exactly).
 */
export const NATIVE_JWT_TEMPLATE = 'commise-native';
