/**
 * The Sentry scrubbers, re-exported from the ONE place they live (plan U16/U22).
 *
 * ⛔ THIS FILE USED TO BE ONE OF THREE NEAR-IDENTICAL COPIES — this one, `identity-webhooks`', and a third
 * inline in mobile — differing only in their docstrings. A denylist is exactly the knowledge DRY governs:
 * one rule about what may leave a host, and three copies means the next key someone adds protects one
 * runtime out of three, silently, in the direction that leaks.
 *
 * It survives as a re-export rather than being deleted because `instrument.ts` and this service's suites
 * already name this path. ⚠️ Do not add anything here.
 */
export {
    DENYLIST_KEYS,
    ID_KEYS,
    isDeniedKey,
    isIdKey,
    looksLikeBearerToken,
    pseudonymizeId,
    scrubAttributes,
    scrubEvent,
    scrubLog,
    scrubText,
} from '@kitchensink/observability-scrubbers';
