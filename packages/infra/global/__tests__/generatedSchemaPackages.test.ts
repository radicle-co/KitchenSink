// @vitest-environment node
/**
 * Repo-wide guard on the shape of a GENERATED wire-contract package (`docs/CODING_STANDARDS.md` §15.2).
 *
 * `packages/schemas/*` is generator output that happens to be committed. Two properties follow from that, and
 * both were violated by config that looked deliberate:
 *
 *  1. **It is not a lint or format target.** Each package carried an `eslint.config.js` and a `.prettierignore`
 *     while declaring NO `lint` or `format:check` script — measured: `turbo run lint format:check
 *     --filter='./packages/schemas/*'` reports "No tasks were executed". Worse, the `.prettierignore` justified
 *     itself with a false claim ("Without this file, `npm run lint` fails on emitted dist/"): there is no lint
 *     script to fail, and the ROOT `.prettierignore` already covers `dist` and `packages/schemas/*\/openapi.yaml`.
 *     Dead config that states a wrong reason is worse than no config, because the next reader believes it.
 *
 *     The decision recorded in each package's README is that these packages are NOT style-checked: the authored
 *     sources are linted and formatted in the service that owns them, and a formatter rewriting the generated
 *     `src/` would read as contract drift and red layer 2 until the generator was re-run. This test is what keeps
 *     the config from coming back with the scripts still absent — the state that is neither posture.
 *
 *  2. **`typecheck` and `build` DO run**, because generated zod that no longer compiles is a generation bug.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const schemasRoot = path.join(repoRoot, 'packages/schemas');

/** Every generated contract package directory name. */
const schemaPackages = readdirSync(schemasRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(schemasRoot, entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort();

/** Read a schema package's manifest scripts. */
function scriptsOf(name: string): Record<string, string> {
    const manifest = JSON.parse(readFileSync(path.join(schemasRoot, name, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
    };

    return manifest.scripts ?? {};
}

describe('the generated wire-contract packages', () => {
    it('finds every generated contract package, so the assertions below are not vacuous', () => {
        expect(schemaPackages).toStrictEqual(['food', 'identity', 'recipe']);
    });

    // Either state is coherent: a package with lint/format scripts AND their config, or a package with neither.
    // The state this rules out is config with no script — which is what shipped, with a false justification.
    it.each(schemaPackages)('%s declares no lint/format script and carries no lint/format config', (name) => {
        const scripts = scriptsOf(name);
        const styleScripts = ['lint', 'format', 'format:check'].filter((script) => scripts[script] !== undefined);
        const styleConfig = ['eslint.config.js', 'eslint.config.mjs', '.prettierignore', '.prettierrc'].filter((file) =>
            existsSync(path.join(schemasRoot, name, file)),
        );

        expect(
            [...styleScripts, ...styleConfig],
            'a generated package is not a style target: keep both empty, or wire both — never config with no script',
        ).toStrictEqual([]);
    });

    it.each(schemaPackages)('%s still builds and typechecks, because generated zod must compile', (name) => {
        const scripts = scriptsOf(name);

        expect(scripts['build']).toBeDefined();
        expect(scripts['typecheck']).toBeDefined();
    });

    // The root ignore is what actually keeps prettier off the generated documents, and it is load-bearing: a
    // reformatted `openapi.yaml` reads as contract drift and reds the gate until the generator is re-run. It was
    // also the fact the deleted per-package `.prettierignore` files got wrong.
    it('leaves the generated documents ignored by the ROOT prettier config', () => {
        const rootIgnore = readFileSync(path.join(repoRoot, '.prettierignore'), 'utf8');

        expect(rootIgnore).toContain('packages/schemas/*/openapi.yaml');
        expect(rootIgnore).toContain('dist');
    });
});
