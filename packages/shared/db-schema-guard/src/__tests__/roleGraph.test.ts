import { describe, expect, it } from 'vitest';

import {
    edgeConfersMembership,
    everyMembershipRow,
    lockOutPredicate,
    pathsToRole,
    type MembershipEdge,
} from '../roles/roleGraph.js';

/** An edge that grants membership the ordinary way. */
function edge(
    member: string,
    role: string,
    flags: Partial<Omit<MembershipEdge, 'member' | 'role'>> = {},
): MembershipEdge {
    return { member, role, admin: false, inherit: true, set: true, ...flags };
}

describe('edgeConfersMembership', () => {
    it('counts an edge carrying INHERIT or SET', () => {
        expect(edgeConfersMembership(edge('a', 'b'))).toBe(true);
        expect(edgeConfersMembership(edge('a', 'b', { inherit: false }))).toBe(true);
        expect(edgeConfersMembership(edge('a', 'b', { set: false }))).toBe(true);
    });

    it('does NOT count an ADMIN-only edge — the one PostgreSQL 16+ adds for a role a CREATEROLE user creates', () => {
        expect(edgeConfersMembership(edge('a', 'b', { admin: true, inherit: false, set: false }))).toBe(false);
    });
});

describe('lockOutPredicate', () => {
    it('every-row counts an ADMIN-only row — the conservative reading of the rds_iam precedence rule', () => {
        // Step 0 found the master holds NO ADMIN-only row at all, so it could not settle whether RDS's rule counts
        // one — and PostgreSQL's own `is_member_of_role` (ROLERECURSE_MEMBERS) does. A lock-out is not
        // recoverable from inside the VPC; a refusal is an outage. So the safe reading is the default.
        const adminOnly = edge('a', 'b', { admin: true, inherit: false, set: false });

        expect(lockOutPredicate('every-row')(adminOnly)).toBe(true);
        expect(everyMembershipRow(adminOnly)).toBe(true);
    });

    it('inherit-or-set is the relaxed reading, named so a caller must choose it', () => {
        expect(lockOutPredicate('inherit-or-set')).toBe(edgeConfersMembership);
    });
});

describe('pathsToRole', () => {
    it('finds a direct membership', () => {
        expect(pathsToRole([edge('master', 'rds_iam')], 'master', 'rds_iam')).toEqual([['master', 'rds_iam']]);
    });

    it('finds a NESTED membership — the shape AWS says still forces IAM auth', () => {
        const edges = [edge('master', 'food_app'), edge('food_app', 'rds_iam')];

        expect(pathsToRole(edges, 'master', 'rds_iam')).toEqual([['master', 'food_app', 'rds_iam']]);
    });

    it('finds every path, through the owner and through the app', () => {
        const edges = [
            edge('master', 'food_owner'),
            edge('food_owner', 'rds_iam'),
            edge('master', 'food_app'),
            edge('food_app', 'rds_iam'),
        ];

        expect(pathsToRole(edges, 'master', 'rds_iam')).toEqual(
            expect.arrayContaining([
                ['master', 'food_owner', 'rds_iam'],
                ['master', 'food_app', 'rds_iam'],
            ]),
        );
        expect(pathsToRole(edges, 'master', 'rds_iam')).toHaveLength(2);
    });

    it('⛔ walks an ADMIN-only edge BY DEFAULT — the master holding ADMIN on a login role is counted', () => {
        const edges = [
            edge('master', 'food_app', { admin: true, inherit: false, set: false }),
            edge('food_app', 'rds_iam'),
        ];

        expect(pathsToRole(edges, 'master', 'rds_iam')).toEqual([['master', 'food_app', 'rds_iam']]);
    });

    it('skips an ADMIN-only edge only when the relaxed predicate is passed explicitly', () => {
        const edges = [
            edge('master', 'food_app', { admin: true, inherit: false, set: false }),
            edge('food_app', 'rds_iam'),
        ];

        expect(pathsToRole(edges, 'master', 'rds_iam', edgeConfersMembership)).toEqual([]);
    });

    it('is empty when there is no path — the only safe answer for the master', () => {
        const edges = [
            edge('master', 'food_owner'),
            edge('food_migrator', 'food_owner'),
            edge('food_migrator', 'rds_iam'),
        ];

        expect(pathsToRole(edges, 'master', 'rds_iam')).toEqual([]);
    });

    it('terminates on a cycle', () => {
        const edges = [edge('a', 'b'), edge('b', 'a'), edge('b', 'c')];

        expect(pathsToRole(edges, 'a', 'c')).toEqual([['a', 'b', 'c']]);
    });

    it('does not treat a role as a path to itself', () => {
        expect(pathsToRole([], 'rds_iam', 'rds_iam')).toEqual([]);
    });
});
