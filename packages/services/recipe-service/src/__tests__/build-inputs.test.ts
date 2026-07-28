/**
 * Guards what the PRODUCTION build compiles (and therefore what ships in the runtime image).
 *
 * The defect this exists for: `tsconfig.build.json` excluded `tests` and `src/**\/__tests__`, but NOT the
 * package-root `__tests__/integration/**` specs, the co-located `src/**\/__fixtures__` factories, or the
 * `src/__testing__` test double. So `npm run build` emitted 196 test artifacts into `dist` — including
 * `dist/__tests__/integration/**`, and (pulled in transitively by those specs, which is why excluding a
 * directory is not enough on its own) `dist/tests/support/**`, `dist/tests/e2e/harness.js` and
 * `dist/tests/global-setup.js`. The `Dockerfile` copies `dist` wholesale, so all of it shipped in the service
 * image, referencing devDependencies that are not installed there.
 *
 * The assertion is on the build PROGRAM, not on the config text: `tsc --listFilesOnly` resolves the same file
 * set the emit would, transitive imports included. Type errors in tests are still caught — `tsconfig.json` (the
 * typecheck project) includes every one of them, which the last case pins.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(import.meta.dirname, '../..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

/** Anything that exists only to test the service — never a production artifact. */
const TEST_ONLY = /(^|\/)(__tests__|__fixtures__|__mocks__|__testing__|tests)\//;

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
    it('compiles src only — no tests, fixtures or test doubles reach dist', () => {
        const leaked = programFiles('tsconfig.build.json').filter(
            (file) => TEST_ONLY.test(file) || /\.(test|spec)\.ts$/.test(file),
        );

        expect(leaked).toEqual([]);
    });

    it('still compiles the service entrypoint the image runs', () => {
        // The ECS task command is `node dist/src/main.js` (see the Dockerfile's CMD).
        expect(programFiles('tsconfig.build.json')).toContain(path.join('src', 'main.ts'));
    });
});

describe('typecheck project', () => {
    it('covers every test tier, so excluding them from the BUILD does not stop them being checked', () => {
        const files = programFiles('tsconfig.json');

        // Co-located unit specs…
        expect(files.some((file) => /^src\/.*\/__tests__\/.*\.test\.ts$/.test(file))).toBe(true);
        // …the package-root integration specs…
        expect(files.some((file) => file.startsWith(`__tests__${path.sep}`))).toBe(true);
        // …and the service e2e specs.
        expect(files.some((file) => file.startsWith(path.join('tests', 'e2e')))).toBe(true);
    });
});
