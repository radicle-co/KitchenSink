/**
 * Named barrel for the golden-record merge layer (feature 003, Phase 6 — MOD-016/MOD-017/MOD-019).
 * Re-exports the pure merge engine + its types, the merge-boundary sanitizer, and the merge→persist
 * service the Phase-5 worker and Phase-4 `PATCH`-resolve call. Named-only (no `export *`) per the
 * project's barrel convention. NOT wired into a NestJS module here (that is the API/worker slice).
 */

export { GoldenRecordMergeEngine, blendCandidates, mergeCandidates, normalizeName } from './merge-engine.js';
export type {
    GoldenRecordDraft,
    MergeCandidate,
    MergeOutcome,
    MergeResult,
    MergedContributingSource,
    MergedNutrient,
    MergedPortion,
    MergedScalar,
} from './merge-engine.js';

export { sanitizeCandidates } from './merge-sanitize.js';

export { MergeAndPersistService } from './merge-and-persist.service.js';
export type { PersistResult, ResolveAndPersistInput, ResolveFromPicksInput } from './merge-and-persist.service.js';
