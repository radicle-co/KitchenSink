/**
 * CAN THIS REAPER STILL DO ITS JOB? (plan U18)
 *
 * ⛔ THE REAPER'S FAILURE MODE IS A CLEAN REPORT. It can drop a per-PR database only because the master
 * INHERITs each `<svc>_owner` outside prod (`dropDatabaseAuthority`). The bootstrap's master-login rollback
 * deliberately releases exactly those memberships — it is removing edges that could carry the master to
 * `rds_iam`, and by design it removes more than it can prove is needed. From that moment until the next
 * successful `DataStack` deploy, the reaper runs daily, drops nothing, and returns a census that looks
 * healthy. Every abandoned preview keeps billing and nothing says so.
 *
 * `bootstrapPass.ts` names that consequence in its own comment and calls it what it is: ADR-0005's tag sweep
 * that matched nothing and reported success. This module is the predicate that turns it into a signal.
 */
import { pathsToRole, type MembershipEdge } from '@kitchensink/db-schema-guard';

/**
 * The owner roles the master no longer holds by INHERITANCE, and so can no longer drop a database of.
 *
 * ⛔ INHERITANCE, NOT MEMBERSHIP. A `SET`-only membership lets the master `SET ROLE` to the owner, but
 * `DROP DATABASE` checks the CURRENT role's ownership — so a master that would have to `SET ROLE` first does
 * not have the authority at the moment the reaper issues its statement. Reading any membership row as
 * sufficient reports the disabled state as healthy, which is the direction that stays quiet.
 *
 * ⚠️ Transitive, because PostgreSQL membership is: a master inheriting a role that inherits the owner does
 * hold the owner's privileges, and reading only direct edges would report a working reaper as broken — the
 * false alarm that teaches its reader to ignore this signal.
 *
 * @param edges - The membership graph, as the role census read it.
 * @param master - The role the reaper connects as.
 * @param owners - The owner roles a drop depends on.
 * @returns The owners the master cannot drop for, in the order given. Pure.
 */
export function ownersTheMasterCannotDrop(
    edges: readonly MembershipEdge[],
    master: string,
    owners: readonly string[],
): readonly string[] {
    const inheriting = edges.filter((edge) => edge.inherit);

    return owners.filter((owner) => pathsToRole(inheriting, master, owner, (edge) => edge.inherit).length === 0);
}
