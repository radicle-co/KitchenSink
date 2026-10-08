/**
 * @module @kitchensink/sync — the package export.
 *
 * A barrel ONLY because it is the target of this package's `exports` entry (the repo's one sanctioned use).
 */
export {
    MAX_INLINE_WAIT_MS,
    drain,
    type DrainJournal,
    type DrainOptions,
    type DrainReport,
    type SendResult,
    type Sender,
} from './drainer.js';
export {
    classifyFailure,
    remedyFor,
    scopeOf,
    type FailureClass,
    type FailureScope,
    type Remedy,
    type SyncFailure,
} from './itemStatus.js';
export {
    EMPTY_OUTBOX,
    appendIntent,
    claimForSending,
    drainOrder,
    markSending,
    recoverInterrupted,
    settle,
    supersede,
    type OutboxLog,
    type Settlement,
} from './outboxLog.js';
export { createOutboxMutator, outboxMutatorFor, type OutboxMutator } from './outboxMutator.js';
export {
    createMemoryOutboxStore,
    loadOutbox,
    parseOutbox,
    quarantineKeyFor,
    saveOutbox,
    storeKeyFor,
    type LoadedOutbox,
    type OutboxStore,
} from './outboxStore.js';
export { appendToQuarantine } from './quarantine.js';
export { createSerialQueue, type SerialQueue } from './serialQueue.js';
export { createWebStorageStore, type WebStorageLike } from './webStorageStore.js';
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
