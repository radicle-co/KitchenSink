/**
 * Named barrel for the Fargate fan-out/merge consumer (Phase 5 — MOD-004). Named-only (no `export *`)
 * per the project's barrel convention.
 */
export { FoodConsumerService } from './food-consumer.service.js';
export type { FoodConsumerDeps, ProcessDisposition } from './food-consumer.service.js';
export { WorkerRuntime, FETCH_QUEUED_CHANNEL } from './worker-runtime.js';
export type { WorkerRuntimeDeps, ListenSession } from './worker-runtime.js';
export { acquireWorkerLock, releaseWorkerLock, WORKER_LOCK_CLASS, WORKER_LOCK_OBJECT } from './worker-lock.js';
export type { LockSession } from './worker-lock.js';
export { backoffSeconds, isRetryBudgetExhausted, MAX_FAILURE_ATTEMPTS } from './backoff.js';
export { ConsoleWorkerLogger, SilentWorkerLogger } from './worker-logger.js';
export type { WorkerLogger, LogContext } from './worker-logger.js';
