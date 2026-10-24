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

/**
 * The catalog seed asset's build (curated catalog plan U3, KTD-4) carries the same two duties for its own inputs: it
 * refuses a seed with no data or a verifier with no SQL, and it refuses BEFORE it empties its output, so a broken
 * checkout replaces nothing. Behaviour is `food-service/tests/seedAssetBuild.integration.test.ts`; this pins the order
 * in the source of every seed builder, found by name.
 */
const SEED_REFUSALS = ['dataFiles.length === 0', 'sqlFiles.length === 0'] as const;
const SEED_EMPTYING = 'rmSync(outdir';

/** Every service's seed asset builder, found rather than listed. */
function seedBuilders(): readonly string[] {
    return globSync('packages/services/*/seedAssetBuild.mjs', { cwd: REPO_ROOT, ignore: '**/node_modules/**' }).sort();
}

/**
 * Why a seed builder's source would ship or wipe an asset it should refuse. Pure.
 *
 * @param source - The builder's text.
 * @returns One sentence per missing or late refusal.
 */
function seedBuilderViolations(source: string): readonly string[] {
    const emptying = source.indexOf(SEED_EMPTYING);

    return SEED_REFUSALS.flatMap((refusal) => {
        const at = source.indexOf(refusal);

        if (at === -1) {
            return [`no '${refusal}' refusal`];
        }

        return emptying !== -1 && at > emptying ? [`'${refusal}' is checked only after the output is emptied`] : [];
    });
}

describe('seed asset build integrity', () => {
    it('finds the seed builders by discovery', () => {
        expect(seedBuilders().length).toBeGreaterThanOrEqual(1);
    });

    it('⛔ every seed builder refuses an empty seed or verifier before it empties its output', () => {
        const findings = seedBuilders().flatMap((builder) =>
            seedBuilderViolations(readFileSync(path.join(REPO_ROOT, builder), 'utf8')).map(
                (finding) => `${builder}: ${finding}`,
            ),
        );

        expect(findings).toEqual([]);
    });

    it.each<[string, string, readonly string[]]>([
        [
            'refusals after the emptying',
            `rmSync(outdir, { recursive: true });\nif (dataFiles.length === 0) {}\nif (sqlFiles.length === 0) {}`,
            [
                "'dataFiles.length === 0' is checked only after the output is emptied",
                "'sqlFiles.length === 0' is checked only after the output is emptied",
            ],
        ],
        ['no SQL refusal', `if (dataFiles.length === 0) {}\nrmSync(outdir);`, ["no 'sqlFiles.length === 0' refusal"]],
        ['both refusals first', `if (dataFiles.length === 0) {}\nif (sqlFiles.length === 0) {}\nrmSync(outdir);`, []],
    ])('judges a builder with %s', (_case, source, expected) => {
        expect(seedBuilderViolations(source)).toStrictEqual(expected);
    });
});
