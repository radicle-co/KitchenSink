/**
 * Guards what the PRODUCTION build compiles (and therefore what ships in the Lambda asset).
 *
 * This package was the least-bad of the four swept in this change — its `tsconfig.build.json` already pins
 * `include` to `src/**\/*.ts` and excludes the co-located specs — but it still emitted
 * `dist/handlers/__fixtures__/messages.*`, a test-only message factory, into the deployed asset. Same class of
 * defect, so it gets the same guard rather than being left as the one package where the pattern does not hold.
 *
 * The assertion is on the build PROGRAM, not on the config text: `tsc --listFilesOnly` resolves the same file
 * set the emit would, transitive imports included. Type errors in the specs are still caught — `tsconfig.json`
 * (the typecheck project) keeps including them, which the last case pins.
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
 * Every file the given project would compile, including transitive imports.
 *
 * @sideEffect Spawns `tsc --listFilesOnly` (resolution only — it neither typechecks nor emits).
 */
function programFiles(project: string): readonly string[] {
    const stdout = execFileSync(process.execPath, [tsc, '--listFilesOnly', '-p', project], {
        cwd: packageRoot,
        encoding: 'utf8',
    });

    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((file) => file.startsWith(packageRoot) && !file.includes('/node_modules/'))
        .map((file) => path.relative(packageRoot, file));
}

describe('production build inputs', () => {
    it('compiles src only — no tests, fixtures or mocks reach the Lambda asset', () => {
        const leaked = programFiles('tsconfig.build.json').filter(
            (file) => TEST_ONLY.test(file) || /\.(test|spec)\.ts$/.test(file),
        );

        expect(leaked).toEqual([]);
    });

    it('still compiles every handler the CDK stack references', () => {
        const files = programFiles('tsconfig.build.json');

        for (const handler of [
            'version-archive-worker',
            'account-erasure-worker',
            'archive-sweeper',
            'erasure-sweeper',
            'erasure-orphan-sweeper',
        ]) {
            expect(files).toContain(path.join('src', 'handlers', `${handler}.ts`));
        }
    });
});

describe('typecheck project', () => {
    it('covers the specs, so excluding them from the BUILD does not stop them being checked', () => {
        const files = programFiles('tsconfig.json');

        // Co-located unit specs…
        expect(files.some((file) => /^src\/.*\/__tests__\/.*\.test\.ts$/.test(file))).toBe(true);
        // …and the package-root LocalStack integration specs.
        expect(files.some((file) => file.startsWith(`__tests__${path.sep}`))).toBe(true);
    });
});
