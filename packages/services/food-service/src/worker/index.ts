/**
 * Named barrel for the Fargate fan-out/merge consumer (Phase 5 — MOD-004). Named-only (no `export *`)
 * per the project's barrel convention.
 */
export { FoodConsumerService } from './foodConsumer.service.js';
export type { FoodConsumerDeps, ProcessDisposition } from './foodConsumer.service.js';
export { WorkerRuntime, FETCH_QUEUED_CHANNEL } from './WorkerRuntime.js';
export type { WorkerRuntimeDeps, ListenSession } from './WorkerRuntime.js';
export { acquireWorkerLock, releaseWorkerLock, WORKER_LOCK_CLASS, WORKER_LOCK_OBJECT } from './workerLock.js';
export type { LockSession } from './workerLock.js';
export { backoffSeconds, isRetryBudgetExhausted, MAX_FAILURE_ATTEMPTS } from './backoff.js';
export { ConsoleWorkerLogger, SilentWorkerLogger } from './workerLogger.js';
export type { WorkerLogger, LogContext } from './workerLogger.js';
