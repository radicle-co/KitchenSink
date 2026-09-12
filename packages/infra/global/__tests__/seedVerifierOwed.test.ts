// @vitest-environment node
/**
 * ⛔ NO PIPELINE SEEDS THE CATALOG WHILE THE VERIFIER STILL OWES A COLUMN (curated catalog plan U6, KTD-3).
 *
 * The seed function applies a plan and then runs the verifier, which proves the catalog equals the committed bytes
 * independently of the seeder. That proof is built in sessions (V1 to V5), and until the last one lands some catalog
 * columns are compared by nothing: `OWED` in food's `verify/verifiedColumns.ts`, derived as every `compared` column
 * no session has covered. A seed applied in that window would report a verified catalog on a check that does not
 * look at those columns. So this gate fails while `OWED` is non-empty and any workflow, composite action or CI script
 * invokes `runSeed.sh` for anything but `manifest`.
 *
 * It is green today because nothing invokes it: curated catalog plan U3 adds the first `runSeed.sh run`, and may not
 * land before `OWED` is empty.
 *
 * The match fails CLOSED: any invocation whose subcommand is not literally `manifest` counts as a run, so a
 * subcommand read from a variable is caught rather than missed. Comment lines and path-filter list items are skipped,
 * and a `\`-continued command is joined first. What it cannot see is the script's path assembled at run time from
 * parts.
 *
 * DESIGN PATTERN: Specification module over a pure predicate ({@link seedRunsIn}), fired at fixture workflows below
 * as well as at the working tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { OWED } from '../../../services/food-service/src/foods/seed/verify/verifiedColumns.js';
import { presentFiles, repoRoot, type SourceFile } from './serviceSources.js';

/** The seed step's one definition, which is the subject and is not a caller of itself. */
const SEED_SCRIPT = '.github/scripts/runSeed.sh';

/**
 * An invocation of the seed script, and the word after it (the subcommand, quoted or not). The script's name must end
 * a word, so `hashFiles('…/runSeed.sh')` and other references inside an expression are not invocations.
 */
const SEED_INVOCATION = /runSeed\.sh["']?(?=\s|$)(?:[ \t]+["']?([^\s"']*))?/gu;

/** A YAML list item that is only the script's path: a path filter, which names the script and runs nothing. */
const PATH_REFERENCE = /^-\s*["']?[\w./-]*runSeed\.sh["']?$/u;

/** The one subcommand that reads the bundle and never reaches a database. */
const READ_ONLY_SUBCOMMAND = 'manifest';

/**
 * The lines of a workflow or script that invoke the seed for anything but `manifest`. Pure.
 *
 * @param source - One workflow, composite action or script.
 * @returns Each offending command, trimmed.
 */
export function seedRunsIn(source: SourceFile): readonly string[] {
    return source.contents
        .replace(/\\\r?\n/gu, ' ')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => !line.startsWith('#') && !PATH_REFERENCE.test(line))
        .filter((line) =>
            [...line.matchAll(SEED_INVOCATION)].some((match) => (match[1] ?? '') !== READ_ONLY_SUBCOMMAND),
        );
}

/**
 * Every pipeline source that could invoke the seed: workflows, composite actions and CI scripts.
 *
 * @returns Them, read. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function pipelineSources(): readonly SourceFile[] {
    return presentFiles(['.github'])
        .filter((file) => /\.(?:ya?ml|sh)$/u.test(file) && file !== SEED_SCRIPT)
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

/**
 * The gate: every seed run in the given sources, as `file: command`, when anything is owed. Pure.
 *
 * @param sources - The pipeline sources.
 * @param owed - The verifier's owed columns.
 */
function gateViolations(sources: readonly SourceFile[], owed: readonly string[]): readonly string[] {
    if (owed.length === 0) {
        return [];
    }

    return sources.flatMap((source) => seedRunsIn(source).map((command) => `${source.file}: ${command}`));
}

/** A deploy job that seeds, in the shape U3 will add. */
const CALLING_WORKFLOW: SourceFile = {
    file: 'fake/.github/workflows/deploy.yml',
    contents: `
jobs:
  seed:
    steps:
      - name: Seed the catalog
        run: bash .github/scripts/runSeed.sh run "$AWS_REGION" "$STACK" SeedFunctionName food "$BUNDLE"
`,
};

describe('the seed waits for the verifier', () => {
    it('reads the pipeline, so the gate below is not vacuous', () => {
        const files = pipelineSources().map((source) => source.file);

        expect(files.filter((file) => file.startsWith('.github/workflows/')).length).toBeGreaterThan(5);
        expect(files).toContain('.github/scripts/runMigrations.sh');
        expect(files).not.toContain(SEED_SCRIPT);
    });

    it('⛔ runs no seed while the verifier owes a column', () => {
        expect(gateViolations(pipelineSources(), OWED)).toEqual([]);
    });

    it('⛔ FAILS a workflow that seeds while a column is owed', () => {
        expect(gateViolations([CALLING_WORKFLOW], ['food.name'])).toEqual([
            'fake/.github/workflows/deploy.yml: run: bash .github/scripts/runSeed.sh run "$AWS_REGION" "$STACK" SeedFunctionName food "$BUNDLE"',
        ]);
    });

    it('lets the same workflow seed once nothing is owed', () => {
        expect(gateViolations([CALLING_WORKFLOW], [])).toEqual([]);
    });

    it.each<[string, string]>([
        [
            'a continued command',
            'run: |\n  bash .github/scripts/runSeed.sh \\\n    run "$REGION" "$STACK" Out food dist',
        ],
        ['a quoted script path', 'run: "$GITHUB_WORKSPACE/.github/scripts/runSeed.sh" run us-east-1 s o l d'],
        ['a quoted subcommand', "run: ./.github/scripts/runSeed.sh 'run' us-east-1 s o l d"],
        ['a subcommand from a variable', 'run: .github/scripts/runSeed.sh "$MODE" us-east-1 s o l d'],
        ['a bare invocation', 'run: .github/scripts/runSeed.sh'],
        [
            'a composite action step',
            'runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: runSeed.sh run r s o l d',
        ],
    ])('⛔ counts %s as a seed run', (_case, contents) => {
        expect(seedRunsIn({ file: 'fake.yml', contents })).toHaveLength(1);
    });

    it.each<[string, string]>([
        ['the read-only manifest subcommand', 'run: bash .github/scripts/runSeed.sh manifest "$BUNDLE"'],
        ['a quoted manifest subcommand', 'run: "./.github/scripts/runSeed.sh" "manifest" dist'],
        ['a comment that names the run', '# U3 adds: runSeed.sh run <region> <stack> <key> <label> <dir>'],
        ['the migration step', 'run: bash .github/scripts/runMigrations.sh run us-east-1 s o l d'],
        ['a path filter naming the script', "paths:\n  - '.github/scripts/runSeed.sh'\n  - .github/scripts/runSeed.sh"],
        ['a hash of the script', "key: seed-${{ hashFiles('.github/scripts/runSeed.sh') }}"],
    ])('does not count %s', (_case, contents) => {
        expect(seedRunsIn({ file: 'fake.yml', contents })).toEqual([]);
    });
});
