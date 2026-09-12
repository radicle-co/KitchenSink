// @vitest-environment node
/**
 * Guard: **the relaxed lock-out reading (`inherit-or-set`) is spelled only where it is defined and in the
 * vanilla-PostgreSQL test harness** — never by anything that runs against RDS.
 *
 * ## Why
 *
 * Whether RDS's `rds_iam` precedence rule counts an ADMIN-only `pg_auth_members` row is unmeasured (ADR-0039), and
 * PostgreSQL's own `is_member_of_role` does count it. So every lock-out question is answered with EVERY row
 * (`every-row`, the default), and a refusal is the worst outcome. The relaxed reading exists only because a vanilla
 * PostgreSQL stand-in master holds its ADMIN as rows RDS confers without one. A production caller passing it would
 * quietly trade a refusal for a possible lock-out of the master — so it may not appear anywhere else.
 */
import { describe, expect, it } from 'vitest';

import { productionSources, readSource, withoutTsComments } from './roleSplitSources.js';

/** The production files allowed to name the relaxed reading. */
const ALLOWED: readonly string[] = [
    // Its definition: the `LockOutEdges` union and `lockOutPredicate`.
    'packages/shared/db-schema-guard/src/roles/roleGraph.ts',
    // The integration tiers' stand-in master — a test fixture that happens to live in a package's `src/`.
    'packages/tools/service-test-harness/src/rdsLikeDatabase.ts',
];

describe('the relaxed lock-out reading', () => {
    it('is named only by its definition and the vanilla-PostgreSQL harness', () => {
        const users = productionSources().filter((path) =>
            /['"`]inherit-or-set['"`]/u.test(withoutTsComments(readSource(path))),
        );

        expect(users).toEqual([...ALLOWED].sort());
    });
});
