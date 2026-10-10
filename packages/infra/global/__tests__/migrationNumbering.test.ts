// @vitest-environment node
/**
 * Two migrations may not share a sequence number, in any service.
 *
 * ## The collision this was written for
 *
 * U5/U6 and U14 ran in parallel worktrees on 2026-08-22. Each read
 * `packages/services/recipe-service/src/database/migrations/`, saw `0023` as the highest, and took `0024`.
 * Both merged. Nothing failed: the runner applies `*.sql` in FILENAME order and keys `schema_migrations` by
 * filename, so two files numbered `0024` both apply, deterministically, and the tree stays green.
 *
 * That is precisely why it needs a gate. The number is how a human reads the order, and two files claiming
 * one slot make "applied after 0023" ambiguous in review, in a runbook, and in any conversation about which
 * change landed first. The failure it eventually produces is not a crash — it is someone reasoning correctly
 * from a wrong ordering.
 *
 * ⚠️ Parallel agents make this the DEFAULT outcome rather than a rare accident: every one of them reads the
 * directory at the same moment and computes the same next number. The dispatch brief that asks each to
 * "declare which number you claimed" is a mitigation, not a control — it depends on someone reconciling the
 * declarations. This is the control.
 *
 * ## Scope
 *
 * Every service's migration directory, discovered rather than enumerated, so a service that lands tomorrow is
 * covered the day its first migration does. The number is the leading digits of the filename; a file that
 * does not start with digits is reported separately rather than silently skipped, because an unnumbered
 * migration has no place in an ordered sequence either.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link collisionsIn} is a pure verdict over a
 * list of filenames, fired at a deliberately-violating fake below as well as at the working tree.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles } from './serviceSources.js';

/** Migration directories live under a service, at any depth (`src/db/…` and `src/database/…` both occur). */
const MIGRATION_PATH = /\/migrations\/[^/]+\.sql$/u;

/** A number claimed by more than one migration in one directory. */
interface Collision {
    /** The directory holding the clash, repo-relative. */
    readonly directory: string;
    /** The contested sequence number, as written. */
    readonly number: string;
    /** The filenames claiming it, sorted. */
    readonly files: readonly string[];
}

/**
 * Group migration filenames by their leading sequence number and report every number claimed twice.
 *
 * @param directory - Repo-relative directory the files live in, used only for reporting.
 * @param filenames - Bare filenames within it.
 * @returns One entry per contested number, sorted. Pure.
 */
function collisionsIn(directory: string, filenames: readonly string[]): readonly Collision[] {
    const byNumber = new Map<string, string[]>();

    for (const filename of filenames) {
        const number = /^(\d+)/u.exec(filename)?.[1];

        if (number !== undefined) {
            byNumber.set(number, [...(byNumber.get(number) ?? []), filename]);
        }
    }

    return [...byNumber.entries()]
        .filter(([, files]) => files.length > 1)
        .map(([number, files]) => ({ directory, number, files: [...files].sort() }))
        .sort((a, b) => a.number.localeCompare(b.number));
}

/**
 * Migration filenames in the tree, grouped by the directory that holds them.
 *
 * @returns Directory → bare filenames. Impure.
 * @sideEffect Shells out to git and stats the working tree.
 */
function migrationsByDirectory(): ReadonlyMap<string, readonly string[]> {
    const grouped = new Map<string, string[]>();

    for (const file of presentFiles(['packages/services']).filter((candidate) => MIGRATION_PATH.test(candidate))) {
        const directory = path.posix.dirname(file);

        grouped.set(directory, [...(grouped.get(directory) ?? []), path.posix.basename(file)]);
    }

    return grouped;
}

describe('migration numbering', () => {
    it('gives every migration in a directory its own sequence number', () => {
        const directories = migrationsByDirectory();

        expect(directories.size, 'no migration directory found — the gate has stopped discovering').toBeGreaterThan(0);

        expect(
            [...directories].flatMap(([directory, filenames]) => collisionsIn(directory, filenames)),
            'Two migrations claiming one number make "applied after N" ambiguous to every human reader. ' +
                'Parallel agents produce this by default, because each reads the directory at the same moment ' +
                'and computes the same next number.',
        ).toEqual([]);
    });

    it('numbers every migration', () => {
        const unnumbered = [...migrationsByDirectory()].flatMap(([directory, filenames]) =>
            filenames.filter((filename) => !/^\d/u.test(filename)).map((filename) => `${directory}/${filename}`),
        );

        expect(unnumbered, 'An unnumbered migration has no place in an ordered sequence.').toEqual([]);
    });

    it('reports a contested number and ignores distinct ones', () => {
        expect(
            collisionsIn('fake/migrations', [
                '0001_first.sql',
                '0002_second.sql',
                '0002_also_second.sql',
                '0003_third.sql',
            ]),
        ).toEqual([
            { directory: 'fake/migrations', number: '0002', files: ['0002_also_second.sql', '0002_second.sql'] },
        ]);
    });
});
