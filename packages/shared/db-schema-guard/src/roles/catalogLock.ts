/**
 * The session advisory lock every master-connected pass over the ROLE CATALOG holds — the role-model bootstrap's and
 * the per-PR reaper's — so no two of them ever interleave (ADR-0039).
 *
 * ⛔ Nothing else serializes them. CloudFormation orders the bootstrap's custom resources, but the provider framework
 * re-invokes the handler on a transport error while the first invocation may still be running, and two passes
 * interleaving is a lock-out: A reads "the master is not in the app role", B joins it for the recreate, A grants
 * `rds_iam` to the app role. Taken with `pg_advisory_lock` on the maintenance database, held for the whole pass, and
 * released before the session closes.
 */
export const ROLE_CATALOG_LOCK_KEY = 7_412_200_228_220_039;

/**
 * How long a pass waits for {@link ROLE_CATALOG_LOCK_KEY} before giving up.
 *
 * ⛔ `pg_advisory_lock` waits FOREVER by default, and this lock is held for a whole pass — so a run killed
 * mid-flight leaves its backend holding it until TCP keepalive notices, and every recovery door (the next
 * deploy, the reaper) queues behind it with nothing to read, at exactly the moment the role model may be
 * half-applied. Bounding the wait turns that from an unexplained hang into a stated failure.
 *
 * ⚠️ The value is chosen against the CALLER'S budget, not in the abstract: the bootstrap Lambda's timeout is
 * 600s, so this must be comfortably under it or the bound never fires and the Lambda dies first — which is
 * the hang it exists to prevent. Same figure and same reasoning as `applyMigrations`' migration lock.
 */
export const ROLE_CATALOG_LOCK_TIMEOUT_MS = 240_000;
