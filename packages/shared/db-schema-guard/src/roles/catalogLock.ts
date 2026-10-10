/**
 * How long a pass waits for the role-catalog lock before giving up.
 *
 * ⛔ `pg_advisory_lock` waits FOREVER by default, and this lock is held for a whole pass — so a run killed
 * mid-flight leaves its backend holding it until TCP keepalive notices, and every recovery door (the next
 * deploy, the reaper) queues behind it with nothing to read, at exactly the moment the role model may be
 * half-applied. Bounding the wait turns that from an unexplained hang into a stated failure.
 *
 * ⚠️ The value is chosen against the CALLERS' budgets, not in the abstract: the bootstrap Lambda's timeout is 600s and
 * the reaper's is 300s, so this must sit under both or the bound never fires and the Lambda dies first — which is the
 * hang it exists to prevent. Same figure and same reasoning as `applyMigrations`' migration lock.
 */
export const ROLE_CATALOG_LOCK_TIMEOUT_MS = 240_000;
