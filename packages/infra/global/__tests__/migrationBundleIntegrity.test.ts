/**
 * Repo-wide guard: every bundler that ships migrations REFUSES to ship an empty set.
 *
 * ## The failure
 *
 * A Lambda bundle whose `migrations/` directory is empty produces a runner that connects, finds nothing to
 * apply, and returns `applied: []` — indistinguishable from a database that was already current. That is
 * the silent success ADR-0022 exists to remove, arriving through the build rather than through ordering.
 * It is not hypothetical: identity's own comment records the copy step being found broken only because a
 * check happened to run against a stale directory that still held yesterday's files.
 *
 * ⛔ IT ENUMERATES NOTHING. The bundlers come from the filesystem and are filtered to the ones that
 * actually copy `.sql`, so a fourth service that ships migrations is covered the day it lands. A
 * hand-written list of the three that exist today would be a copy of a list, and
 * `natEgressConsumers.test.ts` already records what happens to those: a copy of a list cannot detect that
 * the list is incomplete.
 *
 * ⚠️ It also pins the refusal's POSITION — before the copy loop, not after. A refusal that runs afterwards
 * still fails the build, but only having already wiped and recreated the output directory, so the failure
 * arrives with the previous bundle's migrations already destroyed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Every service bundler that copies `.sql` migrations into its Lambda asset, found rather than listed. */
function migrationBundlers(): readonly string[] {
    return globSync('packages/services/*/esbuild.mjs', { cwd: REPO_ROOT, ignore: '**/node_modules/**' })
        .filter((bundler) => readFileSync(path.join(REPO_ROOT, bundler), 'utf8').includes("endsWith('.sql')"))
        .sort();
}

describe('migration bundle integrity', () => {
    it('finds the bundlers by discovery, and there are enough of them to be a real check', () => {
        // ⛔ Anti-vacuity. A glob or filter that matched nothing would make every assertion below pass
        // silently — the exact shape of guard this repo treats as coverage theatre.
        expect(migrationBundlers().length).toBeGreaterThanOrEqual(3);
    });

    it('refuses an empty migration set in EVERY bundler that ships one', () => {
        const permissive = migrationBundlers().filter(
            (bundler) => !readFileSync(path.join(REPO_ROOT, bundler), 'utf8').includes('sqlFiles.length === 0'),
        );

        expect(
            permissive,
            `these bundlers would ship a migration Lambda carrying no migrations at all:\n${permissive.join('\n')}`,
        ).toEqual([]);
    });

    it('refuses BEFORE copying, so a failed build has not already emptied the output directory', () => {
        const late = migrationBundlers().filter((bundler) => {
            const source = readFileSync(path.join(REPO_ROOT, bundler), 'utf8');

            return source.indexOf('sqlFiles.length === 0') > source.indexOf('copyFileSync(join(migrationsSrc');
        });

        expect(late, `these bundlers refuse an empty set only after copying:\n${late.join('\n')}`).toEqual([]);
    });
});
