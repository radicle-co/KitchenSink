/**
 * `@kitchensink/clerk-verify` — shared networkless Clerk token verification.
 *
 * One implementation consumed by the identity service and `@kitchensink/food-service` so the two
 * cannot drift (plan §2A.1). Named-only barrel per the project's convention.
 */
export {
    verifyClerkToken,
    buildPreviewAzpPattern,
    hasExactlyOneAzpMode,
    resolveAzpEnforcement,
    ClerkVerificationError,
    isClerkVerificationError,
} from './clerkVerify.js';
export type { VerifiedClerkClaims, ClerkVerifyConfig } from './clerkVerify.js';
