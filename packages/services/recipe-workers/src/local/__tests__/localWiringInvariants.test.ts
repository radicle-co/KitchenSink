/**
 * Two structural guards on the LOCAL parse wiring. Both DERIVE their sides; neither enumerates.
 *
 * ## 1. The `dev` script must supply what the worker requires
 *
 * `readLocalParseLineConfig` refuses to start without `DATABASE_URL`, `RECIPE_PARSE_QUEUE_URL` and
 * `SQS_ENDPOINT` — and it is the ONLY thing that says which those are. A guard that restated the list here
 * would be a copy, and this repository has the scars: `esbuild.mjs`'s entry points and two guard tests
 * "both enumerated the same five names… a copy of a list cannot detect that the list is incomplete." So the
 * required set is read out of the config reader's own source, and the supplied set out of the env file the
 * `dev` script names — which is itself read from `package.json`, not typed here.
 *
 * ⚠️ This is the sibling of `localQueueNameParity.test.ts`, which already covers the VALUE of the queue URL
 * (it discovers "every tracked `.env.development`", so the file this guard checks joined that check the
 * moment it was committed). What that guard cannot see is a variable the worker needs and the file omits.
 *
 * ## 2. Nothing under `src/local/**` may reach a deployed bundle
 *
 * The offline Bedrock substitute answers without calling a model. It refuses a deployed stage at
 * construction, and it imports no AWS SDK value — but the strongest statement available is that a deploy
 * artefact cannot CONTAIN it. `esbuild.mjs` names the entry points it bundles; this walks their relative
 * imports transitively and asserts `src/local/` is not reachable. It enumerates neither side.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * An environment read with NO fallback — which is precisely what "required" means in the config reader.
 *
 * ⚠️ The negative lookahead is the whole rule: `env['STAGE'] ?? …` is defaulted and must not be demanded of
 * the env file, while `env['DATABASE_URL']` has nowhere to fall through to. Reading the `required` block by
 * name instead would break the moment that local is renamed; reading the SHAPE of the expression does not.
 */
const REQUIRED_ENV = /env\['([A-Z0-9_]+)'\](?!\s*\?\?)/gu;

/** `--env-file=<path>` in an npm script. */
const ENV_FILE_ARGUMENT = /--env-file=(\S+)/u;

/** `NAME=value` in a dotenv file. */
const ENV_ASSIGNMENT = /^\s*([A-Z0-9_]+)\s*=/gmu;

/** A relative import specifier — the only kind that can pull another file of ours into a bundle. */
const RELATIVE_IMPORT = /from\s+'(\.[^']+)'/gu;

/** The `entryPoints` array in `esbuild.mjs`, which is what the CDK ships. */
const ENTRY_POINTS = /const entryPoints = \[([\s\S]*?)\];/u;

const packageJson = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
};

describe('the local dev script supplies what the local worker requires', () => {
    const devScript = packageJson.scripts?.['dev'] ?? '';

    it('has a dev script that loads an env file', () => {
        expect(devScript, 'recipe-workers has no `dev` script — nothing drains the parse queue locally').not.toBe('');
        expect(ENV_FILE_ARGUMENT.exec(devScript)?.[1]).toBeDefined();
    });

    it('⛔ declares every variable the config reader refuses to start without', () => {
        const reader = readFileSync(path.join(PACKAGE_ROOT, 'src', 'local', 'localParseLine.ts'), 'utf8');
        const required = [...reader.matchAll(REQUIRED_ENV)].map(([, name]) => name as string);
        const envFile = ENV_FILE_ARGUMENT.exec(devScript)?.[1] as string;
        const declared = new Set(
            [...readFileSync(path.join(PACKAGE_ROOT, envFile), 'utf8').matchAll(ENV_ASSIGNMENT)].map(
                ([, name]) => name as string,
            ),
        );

        // Neither side may go vacuous: a regex that stopped matching would make this assertion pass by
        // finding nothing to check, which is how a guard silently retires itself.
        expect(required.length, 'the config reader no longer states its required variables here').toBeGreaterThan(0);
        expect(declared.size, `${envFile} declares nothing`).toBeGreaterThan(0);
        // ⛔ NEGATIVE CONTROL for the lookahead: `STAGE` is read WITH a fallback, so it is not required. If
        // it appeared here the rule would have collapsed to "every environment read", and the guard would
        // then demand entries for variables that have perfectly good defaults.
        expect(required, 'a DEFAULTED read was counted as required — the lookahead has stopped working').not.toContain(
            'STAGE',
        );
        expect(
            required.filter((name) => !declared.has(name)),
            `${envFile} omits a variable the worker refuses to start without, so \`npm run dev\` fails at boot`,
        ).toEqual([]);
    });
});

/**
 * Every module a bundle entry point can reach, following relative imports.
 *
 * @param entry - The entry file, package-relative.
 * @returns Package-relative paths, including the entry. Impure.
 * @sideEffect Reads the source tree.
 */
function reachableFrom(entry: string): ReadonlySet<string> {
    const seen = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
        const current = queue.pop() as string;

        if (seen.has(current)) {
            continue;
        }

        seen.add(current);

        const absolute = path.join(PACKAGE_ROOT, current);

        if (!existsSync(absolute)) {
            continue;
        }

        for (const [, specifier] of readFileSync(absolute, 'utf8').matchAll(RELATIVE_IMPORT)) {
            // Written `.js` (NodeNext) and resolved as `.ts` on disk — the repo's own import convention.
            const resolved = path.join(path.dirname(current), (specifier as string).replace(/\.js$/u, '.ts'));
            queue.push(resolved);
        }
    }

    return seen;
}

describe('the local wiring can never ride a deploy', () => {
    const entryPoints = [
        ...(ENTRY_POINTS.exec(readFileSync(path.join(PACKAGE_ROOT, 'esbuild.mjs'), 'utf8'))?.[1] ?? '').matchAll(
            /'([^']+)'/gu,
        ),
    ].map(([, entry]) => entry as string);

    it('reads the bundled entry points from esbuild.mjs itself', () => {
        expect(entryPoints.length, 'the entryPoints array could not be read — this guard is vacuous').toBeGreaterThan(
            0,
        );
        expect(entryPoints).toContain('src/handlers/parseLine.ts');
    });

    it('⛔ no bundled handler reaches src/local/', () => {
        const offenders = entryPoints.flatMap((entry) =>
            [...reachableFrom(entry)]
                .filter((module_) => module_.startsWith(path.join('src', 'local')))
                .map((module_) => `${entry} -> ${module_}`),
        );

        expect(
            offenders,
            'a deployed Lambda bundle would carry the offline Bedrock substitute — an answer produced ' +
                'without calling a model, inside a function whose role holds the only bedrock:InvokeModel ' +
                'grant (ADR-0024 layer 4b).',
        ).toEqual([]);
    });

    it('⛔ NEGATIVE CONTROL: the walk really does follow imports several hops deep', () => {
        // Without this the assertion above would pass on a `reachableFrom` that returned only its entry.
        const reachable = reachableFrom('src/local/main.ts');

        expect(reachable).toContain(path.join('src', 'local', 'localParseLine.ts'));
        // main -> localParseLine -> parseLine (a handler) -> parsing/gatedLlm: three hops.
        expect(reachable).toContain(path.join('src', 'handlers', 'parseLine.ts'));
        expect(reachable).toContain(path.join('src', 'parsing', 'gatedLlm.ts'));
    });
});
