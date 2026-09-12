/**
 * `@kitchensink/nest-error-envelope` — the ONE Nest→`{ code, message, details? }` normalization, shared by every
 * HTTP service's `ApiExceptionFilter`.
 *
 * ⚠️ SERVER-ONLY. Nothing here is a wire contract and nothing here is bundled into a client: each service still
 * authors its own `apiErrorSchema`, code enum and code→status table (ADR-0014). See `./envelope.ts` for why the
 * mechanism/contract split is the design rather than a compromise, and for the identity defect that three copies of
 * this mechanism produced.
 */
export {
    asExplicitEnvelope,
    asValidationEnvelope,
    codeForStatus,
    describeBody,
    describeIssue,
    normalizeHttpException,
    FRAMEWORK_KEYS,
    GENERIC_STATUS_CODES,
    UNSPECIFIED_MESSAGE,
} from './envelope.js';
export type { ApiErrorEnvelope, EnvelopeVocabulary, NormalizedFailure } from './envelope.js';
