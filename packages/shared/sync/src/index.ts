/**
 * @module @kitchensink/sync — the package export.
 *
 * A barrel ONLY because it is the target of this package's `exports` entry (the repo's one sanctioned use).
 */
export { drain, type DrainReport, type SendResult, type Sender } from './drainer.js';
export {
    classifyFailure,
    remedyFor,
    scopeOf,
    type FailureClass,
    type FailureScope,
    type Remedy,
    type SyncFailure,
} from './itemStatus.js';
export { appendIntent, drainOrder, supersede, type OutboxLog } from './outboxLog.js';
export {
    createMemoryOutboxStore,
    loadOutbox,
    saveOutbox,
    storeKeyFor,
    type LoadedOutbox,
    type OutboxStore,
} from './outboxStore.js';
export { projectOptimistic, type LocalProjection, type ServerFacts } from './projection.js';
export {
    LOCAL_REF_PREFIX,
    isLocalRef,
    mintLocalRef,
    resolveRef,
    substituteRefs,
    type ResolutionMap,
} from './references.js';
export {
    LOCAL_SCHEMA_VERSION,
    type Intent,
    type IntentKind,
    type LocalRef,
    type OutboxRecord,
    type RecordState,
    type SyncEntity,
} from './record.js';
