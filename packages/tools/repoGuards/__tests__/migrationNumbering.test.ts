// @vitest-environment node
/**
 * Migrations are named `NNNN_snake_case.sql` and no two in one directory share a number, in any service.
 *
 * ## The collision this was written for
 *
 * Parallel worktrees each read a service's migrations directory, saw the same highest number, and took the next
 * one (recipe `0024` on 2026-08-22, recipe `0054` and food `0023` since). Both merged. Nothing failed: the
 * runner applies `*.sql` in FILENAME order and keys `schema_migrations` by filename, so two files numbered alike
 * both apply, in an order set by whatever follows the number, and the manifest digest still agrees.
 *
 * That is precisely why it needs a gate. The number is how a human reads the order, and two files claiming one
 * slot make "applied after 0023" ambiguous in review, in a runbook, and in any conversation about which change
 * landed first. The failure it eventually produces is not a crash — it is someone reasoning correctly from a
 * wrong ordering.
 *
 * ⚠️ Parallel agents make this the DEFAULT outcome rather than a rare accident: every one of them reads the
 * directory at the same moment and computes the same next number. This test is the CI control; the runner
 * (`@kitchensink/db-schema-guard`) refuses the same shapes at apply time, from the same predicate.
 *
 * ## Gaps are allowed
 *
 * The tree holds gaps today (food skips 0012, recipe skips 0038, identity starts at 0004), so a gap is not a
 * defect and is not refused. Only a duplicate number or a name outside `NNNN_snake_case.sql` is.
 *
 * ## Scope
 *
 * Every migrations directory under `packages/`, discovered from the tree rather than enumerated, so a service
 * that lands tomorrow is covered the day its first migration does. The first test pins the discovered set, so a
 * discovery that quietly stops finding a directory fails instead of passing over nothing.
 *
 * DESIGN PATTERN: Specification module — the verdict is `migrationNamingProblems`, one pure predicate shared with
 * the runner, fired at a deliberately-violating fake below as well as at the working tree.
 */
import path from 'node:path';

import { migrationNamingProblems } from '@kitchensink/db-schema-guard';
import { describe, expect, it } from 'vitest';

import { presentFiles } from './serviceSources.js';

/** Migration directories live under a service, at any depth (`src/db/…` and `src/database/…` both occur). */
const MIGRATION_PATH = /\/migrations\/[^/]+\.sql$/u;

/**
 * Migration filenames in the tree, grouped by the directory that holds them.
 *
 * @returns Directory → bare filenames. Impure.
 * @sideEffect Shells out to the version-control index and stats the working tree.
 */
function migrationsByDirectory(): ReadonlyMap<string, readonly string[]> {
    const grouped = new Map<string, string[]>();

    for (const file of presentFiles(['packages']).filter((candidate) => MIGRATION_PATH.test(candidate))) {
        const directory = path.posix.dirname(file);

        grouped.set(directory, [...(grouped.get(directory) ?? []), path.posix.basename(file)]);
    }

    return grouped;
}

describe('migration numbering', () => {
    it('discovers every service migrations directory', () => {
        expect(
            [...migrationsByDirectory().keys()].sort(),
            'the gate has stopped discovering, or a service gained or lost a migrations directory',
        ).toEqual([
            'packages/services/food-service/src/db/migrations',
            'packages/services/identity/src/database/migrations',
            'packages/services/recipe-service/src/database/migrations',
        ]);
    });

    it('gives every migration a well-formed name and its own sequence number', () => {
        expect(
            [...migrationsByDirectory()].flatMap(([directory, filenames]) =>
                migrationNamingProblems(filenames).map((problem) => ({ directory, ...problem })),
            ),
            'Two migrations claiming one number make "applied after N" ambiguous, and the runner would order them ' +
                'by an accident of spelling.',
        ).toEqual([]);
    });

    it('reports a contested number and a malformed name, and ignores gaps', () => {
        expect(
            migrationNamingProblems([
                '0001_first.sql',
                '0002_second.sql',
                '0002_also_second.sql',
                '0007_after_a_gap.sql',
                'x.sql',
            ]),
        ).toEqual([
            { kind: 'malformedName', file: 'x.sql' },
            { kind: 'duplicateNumber', number: '0002', files: ['0002_also_second.sql', '0002_second.sql'] },
        ]);
    });
});
