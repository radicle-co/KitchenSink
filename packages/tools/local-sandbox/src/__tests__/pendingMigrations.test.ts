/**
 * Repo-wide guard: `local:up` is RE-RUNNABLE, because a local stack is something you bring up repeatedly.
 *
 * ⛔ WHY THIS EXISTS. The first version applied every `.sql` file on every run, against a docker volume that
 * `local:down` deliberately preserves (`down` without `-v`). The first run applied 53 files and succeeded;
 * the second died on the first one:
 *
 *     migration FAILED kitchensink_food_dev 0000_food_schema.sql
 *     ERROR:  type "food_status" already exists
 *
 * So the command worked exactly once per volume, and its failure mode was an error about a type name that
 * says nothing about the real cause.
 *
 * The deployed runner does not re-apply anything — ADR-0022's Trigger runs a runner that records what it has
 * applied. This mirrors that with the same table name, so the local behaviour and the deployed behaviour are
 * the same rule rather than two different ones that happen to agree.
 */
import { describe, expect, it } from 'vitest';

import { pendingMigrations } from '../pendingMigrations.js';

describe('pendingMigrations', () => {
    it('returns every file when nothing has been applied', () => {
        expect(pendingMigrations(['0000_a.sql', '0001_b.sql'], [])).toStrictEqual(['0000_a.sql', '0001_b.sql']);
    });

    it('skips what is already recorded', () => {
        expect(pendingMigrations(['0000_a.sql', '0001_b.sql'], ['0000_a.sql'])).toStrictEqual(['0001_b.sql']);
    });

    it('returns nothing when everything is applied — the second `local:up`', () => {
        expect(pendingMigrations(['0000_a.sql'], ['0000_a.sql'])).toStrictEqual([]);
    });

    it('preserves FILENAME ORDER, which is the migration order', () => {
        // ⛔ Not the order the directory listing or the applied set happens to be in. `0000_`, `0001_`, … is
        // the contract the deployed runner uses, and a migration applied out of order is a corrupt schema.
        const files = ['0002_c.sql', '0000_a.sql', '0010_d.sql', '0001_b.sql'].sort();

        expect(pendingMigrations(files, [])).toStrictEqual(['0000_a.sql', '0001_b.sql', '0002_c.sql', '0010_d.sql']);
    });

    it('ignores a recorded name that no longer exists on disk', () => {
        // A migration deleted from the branch is not a reason to refuse; it is simply not pending.
        expect(pendingMigrations(['0001_b.sql'], ['0000_gone.sql', '0001_b.sql'])).toStrictEqual([]);
    });
});
