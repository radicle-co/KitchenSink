/**
 * Guards what the PRODUCTION build compiles (and therefore what ships in the Lambda asset).
 *
 * The defect this exists for: `build` ran `tsc -p tsconfig.json`, whose only include is `src/**\/*.ts` —
 * which sweeps in the co-located `src/**\/__tests__/*.test.ts` specs. `tsc` emitted 80 compiled test
 * artifacts into `dist/`, and every handler's CDK `Code.fromAsset(dist)` ships that whole directory, so the
 * deployed Lambda packages carried compiled unit tests importing `vitest` (a devDependency that is not in the
 * asset). Dead weight in a size-limited artifact, and test code inside a production deployable.
 *
 * The assertion is on the build PROGRAM, not on the config text: `tsc --listFilesOnly` resolves the same file
 * set the emit would, including files pulled in transitively by an import. Type errors in the co-located specs
 * are still caught — the TYPECHECK project (`tsconfig.json`) keeps including them, which the last case pins,
 * so the two projects cannot both stop covering them.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(import.meta.dirname, '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

/** Anything that exists only to test the handlers — never a production artifact. */
const TEST_ONLY = /(^|\/)(__tests__|__fixtures__|__mocks__|tests)\//;

/**
 * `tsc --listFilesOnly` costs ~18s on a CI runner (well under a second of that is this package's own
 * files — it is program construction). Memoised per project so the three assertions below spawn it ONCE
 * rather than three times; without this the guards alone added ~54s per service to `turbo run test` and
 * blew vitest's 5s default, which is what turned CI red.
 */
const PROGRAM_CACHE = new Map<string, readonly string[]>();

/** Generous because the cost is process spawn + program construction, not our own code. */
const TSC_TIMEOUT_MS = 120_000;

/**
 * Every file the given project would compile, including transitive imports.
 *
 * @sideEffect Spawns `tsc --listFilesOnly` (resolution only — it neither typechecks nor emits).
 */
function programFiles(project: string): readonly string[] {
    const cached = PROGRAM_CACHE.get(project);

    if (cached !== undefined) {
        return cached;
    }

    const stdout = execFileSync(process.execPath, [tsc, '--listFilesOnly', '-p', project], {
        cwd: packageRoot,
        encoding: 'utf8',
        // Kill a wedged tsc rather than hanging the suite until vitest's own timeout fires.
        timeout: TSC_TIMEOUT_MS,
    });

    const files = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((file) => file.startsWith(packageRoot) && !file.includes('/node_modules/'))
        .map((file) => path.relative(packageRoot, file));

    PROGRAM_CACHE.set(project, files);

    return files;
}

describe('production build inputs', () => {
    it(
        'compiles src only — no tests, fixtures or mocks reach the Lambda asset',
        () => {
            const leaked = programFiles('tsconfig.build.json').filter(
                (file) => TEST_ONLY.test(file) || /\.(test|spec)\.ts$/.test(file),
            );

            expect(leaked).toEqual([]);
        },
        TSC_TIMEOUT_MS,
    );

    it(
        'still compiles every handler the CDK stack references',
        () => {
            const files = programFiles('tsconfig.build.json');

            // Each WebhooksStack function names `handlers/<name>.handler`; a handler dropped from the build is an
            // asset that is missing at runtime rather than a visible build failure.
            for (const handler of [
                'identityWebhook',
                'deletion-worker',
                'reconciliation',
                'tombstone-sweep',
                'erasure-reconciliation',
                'log-forwarder',
                'migrate',
            ]) {
                expect(files).toContain(path.join('src', 'handlers', `${handler}.ts`));
            }
        },
        TSC_TIMEOUT_MS,
    );
});

describe('typecheck project', () => {
    it(
        'covers the co-located specs, so excluding them from the BUILD does not stop them being checked',
        () => {
            const files = programFiles('tsconfig.json');

            expect(files.some((file) => /^src\/.*\/__tests__\/.*\.test\.ts$/.test(file))).toBe(true);
        },
        TSC_TIMEOUT_MS,
    );
});
