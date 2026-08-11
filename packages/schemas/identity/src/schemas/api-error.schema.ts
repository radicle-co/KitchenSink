/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the identity service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/identity-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/identity/src/common/api-error.schema.ts

/**
 * THE ERROR ENVELOPE — authored wire contract for every non-2xx body the identity service emits
 * (`docs/CODING_STANDARDS.md` §15.2), copied into `@kitchensink/schema-identity`.
 *
 * `{ code, message, details? }` is shared VERBATIM with the food and recipe services (ARCH-PS-2) so one
 * client-side handler covers all three. It was previously a hand-written interface declared once per service,
 * with nothing tying the three copies together.
 *
 * UNLIKE the food service, identity ACTUALLY EMITS ONLY THIS SHAPE: `ApiExceptionFilter` is `@Catch()`-all and
 * rewrites every failure — a Nest `HttpException`, a validation rejection, or an unexpected throwable — into the
 * envelope before it reaches the wire. That property is what makes a single component honest here, and it is
 * asserted by `src/common/filters/__tests__/api-exception.filter.test.ts` rather than assumed.
 *
 * `code` is a plain `string`, not an enum of the codes emitted today, and that is deliberate: a client MUST
 * tolerate a code it has not been taught, because a deployed service adds codes ahead of a released mobile
 * binary. Narrowing it would make every new code a breaking change for a client that only branches on the few
 * it knows — and identity's own fallback already produces `HTTP_<status>` for an unmapped status.
 */
import { z } from 'zod';

/**
 * The structured error envelope returned to API clients.
 *
 * `.loose()` on purpose — this schema DESCRIBES a response rather than validating a request, so a body carrying
 * a field a client has not been taught must stay valid instead of turning a forward-compatible deploy into a
 * client-side parse crash.
 */
export const apiErrorSchema = z
    .object({
        /** Stable, machine-readable failure code, e.g. `NOT_FOUND`, `UNAUTHORIZED`, `HTTP_418`. */
        code: z.string(),
        /** Human-readable summary. Never localized, never security-sensitive, never a stack trace. */
        message: z.string(),
        /**
         * Per-failure diagnostic detail. A validation rejection carries `fields`: the individual constraint
         * messages, preserved as an array so a client can surface them per-input rather than as one blob.
         */
        details: z.record(z.string(), z.unknown()).optional(),
    })
    .loose();

/** The structured error envelope returned to API clients: `{ code, message, details? }`. */
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
