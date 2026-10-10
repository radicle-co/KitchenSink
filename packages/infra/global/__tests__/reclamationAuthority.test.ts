// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES, type MembershipEdge } from '@kitchensink/db-schema-guard';

import { ownersTheMasterCannotDrop } from '../src/db-reaper/reclamationAuthority.js';

const MASTER = 'identity_app';

/** An inheriting membership — the shape `DROP DATABASE` authority actually depends on. */
function inherits(member: string, role: string): MembershipEdge {
    return { member, role, admin: false, inherit: true, set: true };
}

const EVERY_OWNER = [DATABASE_ROLES.identity.owner, DATABASE_ROLES.food.owner, DATABASE_ROLES.recipe.owner];

/**
 * ⛔ THE FAILURE THIS DETECTS IS THE ONE THAT REPORTS SUCCESS (plan U18).
 *
 * The reaper can drop a per-PR database only because the master INHERITs each `<svc>_owner` outside prod. The
 * bootstrap's master-login rollback deliberately releases exactly those memberships — it is removing edges
 * that could carry the master to `rds_iam`, and it removes more than it can prove is needed. From that moment
 * until the next successful `DataStack` deploy, the reaper runs on schedule, drops nothing, and reports a
 * clean census: every abandoned preview keeps billing and nothing says so.
 *
 * That is ADR-0005's tag sweep that matched nothing and reported success, one layer down, and
 * `bootstrapPass.ts` names it in its own comment. This is the predicate that turns it into a signal.
 */
describe('whether the reaper can still drop what it is for', () => {
    it('⛔ names every owner the master no longer inherits — the disabled state, detected', () => {
        const edges = [inherits(MASTER, DATABASE_ROLES.identity.owner)];

        expect(ownersTheMasterCannotDrop(edges, MASTER, EVERY_OWNER)).toEqual([
            DATABASE_ROLES.food.owner,
            DATABASE_ROLES.recipe.owner,
        ]);
    });

    it('is silent when the master inherits all of them', () => {
        const edges = EVERY_OWNER.map((owner) => inherits(MASTER, owner));

        expect(ownersTheMasterCannotDrop(edges, MASTER, EVERY_OWNER)).toEqual([]);
    });

    /**
     * ⛔ `INHERIT` IS THE QUESTION, not membership. A `SET`-only membership lets the master `SET ROLE` to the
     * owner, and `DROP DATABASE` checks the CURRENT role's ownership — so a master that has to `SET ROLE`
     * first does not have the authority at the moment the reaper issues its statement. Reading any membership
     * row as sufficient would report the disabled state as healthy, which is the direction that stays quiet.
     */
    it('⛔ does not accept a SET-only membership as drop authority', () => {
        const setOnly: MembershipEdge = {
            member: MASTER,
            role: DATABASE_ROLES.food.owner,
            admin: false,
            inherit: false,
            set: true,
        };

        expect(ownersTheMasterCannotDrop([setOnly], MASTER, [DATABASE_ROLES.food.owner])).toEqual([
            DATABASE_ROLES.food.owner,
        ]);
    });

    /**
     * ⚠️ Membership is TRANSITIVE in PostgreSQL: a master that inherits a role which inherits the owner holds
     * the owner's privileges. Reading only direct edges would report a working reaper as disabled — the false
     * alarm that teaches its reader to ignore this signal.
     */
    it('follows an inherited chain rather than only direct edges', () => {
        const edges = [inherits(MASTER, 'intermediate'), inherits('intermediate', DATABASE_ROLES.food.owner)];

        expect(ownersTheMasterCannotDrop(edges, MASTER, [DATABASE_ROLES.food.owner])).toEqual([]);
    });

    it('answers every owner when the graph is empty — a census that read nothing is not a clean bill', () => {
        expect(ownersTheMasterCannotDrop([], MASTER, EVERY_OWNER)).toEqual(EVERY_OWNER);
    });
});
