/**
 * Guards what the PRODUCTION build compiles (and therefore what ships in the runtime image).
 *
 * The defect this exists for: this package had no `tsconfig.build.json`, so `nest build` fell back to
 * `tsconfig.json` — which includes `tests/**` — and emitted 140 compiled test artifacts into `dist/`
 * alongside `dist/src`. Two real consequences: (1) a TEST-ONLY dependency could break the production build,
 * which actually happened when `tests/e2e/usda-adapter-http-contract.e2e.test.ts` began importing `undici`
 * and took the food k6 CI job down until the dep was declared; and (2) the `Dockerfile` copies `dist`
 * wholesale, so compiled e2e/integration tests shipped inside the service image referencing
 * devDependencies that are not installed there.
 *
 * The assertion is on the build PROGRAM, not on the config text: `tsc --listFilesOnly` resolves the same
 * file set the emit would, including files pulled in transitively by an import — which is how a test-only
 * support module leaks in even when the directory is excluded. Type errors in tests are still caught: the
 * TYPECHECK project (`tsconfig.json`) deliberately includes every test — the last case below pins that, so the
 * two projects cannot both stop covering them.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(import.meta.dirname, '..');
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

    return (
        stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            // Only this package's own sources can be a test leak; dependencies' `.d.ts` are not.
            .filter((file) => file.startsWith(packageRoot) && !file.includes('/node_modules/'))
            .map((file) => path.relative(packageRoot, file))
    );
}

describe('production build inputs', () => {
    it('compiles src only — no tests, fixtures, mocks or test doubles reach dist', () => {
        const leaked = programFiles('tsconfig.build.json').filter(
            (file) => TEST_ONLY.test(file) || /\.(test|spec)\.ts$/.test(file),
        );

        expect(leaked).toEqual([]);
    });

    it('still compiles the service entrypoints the image runs', () => {
        const files = programFiles('tsconfig.build.json');

        // The ECS task commands are `node dist/src/main.js`, `node dist/src/worker/main.js` and
        // `node dist/src/worker/change-refresh/main.js` — dropping any of these from the build would produce
        // an image that crash-loops at boot instead of a visible build failure.
        expect(files).toContain(path.join('src', 'main.ts'));
        expect(files).toContain(path.join('src', 'worker', 'main.ts'));
        expect(files).toContain(path.join('src', 'worker', 'change-refresh', 'main.ts'));
    });
});

describe('typecheck project', () => {
    it('covers every test, so excluding them from the BUILD does not stop them being checked', () => {
        const files = programFiles('tsconfig.json');

        // The out-of-`src` integration + e2e specs…
        expect(files.some((file) => file.startsWith(`tests${path.sep}`) && file.endsWith('.test.ts'))).toBe(true);
        // …AND the co-located unit specs, which were excluded here and so had NO static analysis at all.
        expect(files.some((file) => /^src\/.*\/__tests__\/.*\.test\.ts$/.test(file))).toBe(true);
    });
});
