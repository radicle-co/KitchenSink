/**
 * THE CONTRACT BETWEEN THE SEEDER AND THE FLOWS — asserted in both directions, from disk.
 *
 * A deployed Maestro run creates its world through the API under RUN-SCOPED titles, and threads those
 * titles into the flows as `maestro test -e KEY=VALUE`. That makes the manifest's key set a contract
 * spanning a TypeScript package, a bash script and twenty-odd YAML files — three languages, none of which
 * can typecheck against the others.
 *
 * The two failure modes are asymmetric and both silent:
 *
 *   - a key the seeder emits that no flow reads is a fixture nobody needs — dead weight that looks like
 *     coverage;
 *   - a `${E2E_…}` a flow reads that the seeder does not emit renders on screen as the LITERAL TEXT
 *     `${E2E_RECIPE_LAMB}`, and the flow then fails to find it. That failure reads exactly like an app
 *     defect, on the tier least able to explain itself.
 *
 * So this asserts SET EQUALITY, and it discovers both sides rather than listing either.
 *
 * ⛔ The third rule is what proves the CONVERSION is finished. A flow still carrying a bare seed title is a
 * flow that will match whatever a previous run left behind, or nothing at all — the shared-fixture class
 * this whole change removes, surviving in a file nobody re-read.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURE_ENV_KEYS, SEED_WORLD } from '@kitchensink/e2e-seed';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FLOW_ROOT = 'packages/apps/commise/mobile/.maestro';

/** Every committed flow, repo-relative. */
function flowFiles(): readonly string[] {
    return execFileSync('git', ['ls-files', `${FLOW_ROOT}/**/*.yaml`, `${FLOW_ROOT}/*.yaml`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((line) => line.length > 0);
}

const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/** Every `${E2E_…}` a flow interpolates. Pure. */
export function interpolatedKeys(source: string): readonly string[] {
    return [...source.matchAll(/\$\{(E2E_[A-Z0-9_]+)\}/g)].map((match) => match[1] ?? '');
}

/** A flow still naming a seeded recipe by its bare, un-scoped title. Pure. */
export function findBareSeedTitles(
    files: readonly { readonly file: string; readonly source: string }[],
    baseTitles: readonly string[],
): readonly string[] {
    return files.flatMap(({ file, source }) =>
        baseTitles
            .filter((title) => {
                // A `${E2E_…}` reference is the CORRECT form and often sits beside the base title inside a
                // comment explaining what it is, so only lines outside comments count.
                const code = source
                    .split('\n')
                    .filter((line) => !line.trimStart().startsWith('#'))
                    .join('\n');

                return code.includes(title);
            })
            .map((title) => `${file} still names "${title}" literally — it must interpolate the run-scoped title`),
    );
}

describe('the fixture manifest and the Maestro flows agree on every variable', () => {
    const files = flowFiles().map((file) => ({ file, source: read(file) }));
    const declared = new Set<string>(Object.values(FIXTURE_ENV_KEYS));
    const used = new Set(files.flatMap(({ source }) => interpolatedKeys(source)));

    it('discovers the flows at all — a vacuous pass here would assert nothing below', () => {
        expect(files.length).toBeGreaterThan(30);
    });

    it('interpolates only variables the seeder emits', () => {
        // Anything else renders as its own literal text on screen and fails as if the app were broken.
        expect([...used].filter((key) => !declared.has(key)).sort()).toEqual([]);
    });

    it('has at least one flow read every variable the seeder emits', () => {
        expect([...declared].filter((key) => !used.has(key)).sort()).toEqual([]);
    });

    it('leaves no flow naming a seeded recipe by its bare title', () => {
        expect(
            findBareSeedTitles(
                files,
                SEED_WORLD.map((recipe) => recipe.baseTitle),
            ),
        ).toEqual([]);
    });
});

describe('the rules themselves detect the absence they exist to detect', () => {
    it('reads an interpolation, and ignores prose that merely mentions one', () => {
        expect(interpolatedKeys("- tapOn: '${E2E_RECIPE_LAMB}'")).toEqual(['E2E_RECIPE_LAMB']);
        expect(interpolatedKeys('- tapOn: E2E_RECIPE_LAMB')).toEqual([]);
    });

    it('flags a bare title in a command, and tolerates one inside a comment', () => {
        expect(
            findBareSeedTitles([{ file: 'a.yaml', source: "- tapOn: 'Herb Risotto'" }], ['Herb Risotto']),
        ).toHaveLength(1);
        expect(
            findBareSeedTitles(
                [{ file: 'a.yaml', source: '# the run-scoped Herb Risotto\n- tapOn: x' }],
                ['Herb Risotto'],
            ),
        ).toEqual([]);
    });
});
