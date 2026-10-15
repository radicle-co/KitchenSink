/**
 * `@kitchensink/clerk-verify` — shared networkless Clerk token verification.
 *
 * One implementation consumed by every service that verifies a Clerk token, so they cannot drift (plan §2A.1),
 * and the CORS origin policy derived from the same `azp` boundary (plan 002 S1). Named-only barrel per the
 * project's convention.
 */
export {
    verifyClerkToken,
    buildPreviewAzpPattern,
    buildTransitionAzpPattern,
    hasExactlyOneAzpMode,
    isNativeClientToken,
    resolveAzpEnforcement,
    ClerkVerificationError,
    isClerkVerificationError,
} from './clerkVerify.js';
export type { VerifiedClerkClaims, ClerkVerifyConfig } from './clerkVerify.js';
export { resolveCorsPolicy } from './corsPolicy.js';
export type { AppCorsOptions, CorsOriginMode, CorsPolicy, CorsPolicyInput } from './corsPolicy.js';
export {
    DEFAULT_ROLE_METADATA,
    ENTITLED_ROLES,
    ROLES,
    ROLES_METADATA_KEY,
    ROLE_SCOPES,
    hasPaidFeatures,
    needsDefaultRole,
    parseRoles,
    scopesForRoles,
} from './roles.js';
export type { Role } from './roles.js';
