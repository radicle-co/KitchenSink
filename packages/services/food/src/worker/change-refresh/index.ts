/**
 * Named barrel for the change-driven refresh scheduled task (Phase 7 — MOD-020/ARCH-018). Named-only
 * (no `export *`) per the project's barrel convention.
 */
export { ChangeRefreshConsumer, SVC_CHANGE_REFRESH } from './change-refresh.consumer.js';
export type { ChangeRefreshConsumerDeps, ChangeRefreshResult } from './change-refresh.consumer.js';
