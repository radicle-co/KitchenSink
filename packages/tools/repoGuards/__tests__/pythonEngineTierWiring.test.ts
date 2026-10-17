// @vitest-environment node
/**
 * Repo-wide guard: an integration tier whose suites SPAWN the CRF Python engine must run in a CI job that
 * installs that engine — and that job must ASSERT the engine imports, so the tier cannot go quiet.
 *
 * ## The failure this closes
 *
 * A suite that drove the shipped local parse wiring, which runs the DEPLOYED
 * `packages/services/ingredient-parser/src/handler.py` as a subprocess, landed in a tier whose CI job installed no
 * `ingredient-parser-nlp`, so that job failed on EVERY run of its branch with
 *
 *     ModuleNotFoundError: No module named 'ingredient_parser'
 *
 * An absent engine is not a degraded run: `handlers/parseLine.ts` classifies everything an ENGINE throws as
 * TRANSIENT and re-throws BEFORE any landing (ADR-0026), so it is no run at all.
 *
 * `testTierWiring.test.ts` asks whether a tier is CALLED by CI. It cannot ask whether the runner it is
 * called on can actually execute it, and a tier CI calls but cannot run is a tier that does not exist
 * (`docs/CODING_STANDARDS.md` §7.1).
 *
 * ## Both sides are DISCOVERED
 *
 * - The **subjects** are integration tiers, not workspaces: every `vitest.integration.config.ts` whose suites, or
 *   a module they import transitively (source included), name a `python3` interpreter in code. A workspace whose
 *   source drives the engine from another tier only (a LOCAL e2e suite, which CI does not run) is not one.
 *   "A copy of a list cannot detect that the list is incomplete" (ADR-0025 §3).
 * - The **install** is recognised by its subject, `requirements.txt`, not by a step name: ADR-0025 calls that
 *   pin load-bearing three times over, and a step that installed a literal version would satisfy a name
 *   match while measuring against a different model.
 *
 * ## ⚠️ The honest limit
 *
 * This covers the INTEGRATION tier only, because those steps name their workspace
 * (`--workspace=@kitchensink/…`). The unit tier runs through a turbo filter expression, which does not name
 * one — `Test (services)` installs the engine for `crfEngineVersionParity.test.ts` and is correct today, but
 * that pairing is not derived here. Stated rather than papered over: a hole that announces itself is the
 * difference between this and a check that quietly covers less than a reader assumes.
 *
 * DESIGN PATTERN: Specification — a predicate over two independently discovered sets.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { type Reader, readTree, relativeImports } from './realDependencyReach.js';
import { configReach, tierConfigs, withoutTsComments } from './roleSplitSources.js';
import { repoRoot } from './serviceSources.js';

const CI_WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_ci.yml', import.meta.url));

/** The pin file every install of the engine must read, so a literal version cannot pass as an install. */
const REQUIREMENTS = 'packages/services/ingredient-parser/requirements.txt';

/** A `python3` interpreter named in code: what spawns the engine. */
const SPAWNS_PYTHON = /['"]python3['"]/u;

/** One workspace directory plus the manifest name CI would spell it with. */
interface Workspace {
    readonly directory: string;
    readonly name: string;
}

/**
 * Whether any of `entries`, or a module they import transitively, names a `python3` interpreter in code. Pure over
 * `read`.
 *
 * @param entries - The files a tier runs.
 * @param read - Reads a file, or answers `undefined` when there is none.
 * @returns `true` when the tier spawns the engine.
 */
function reachesEngine(entries: readonly string[], read: Reader): boolean {
    const seen = new Set<string>();
    const pending = [...entries];

    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        const text = seen.has(next) ? undefined : read(next);

        seen.add(next);

        if (text === undefined) {
            continue;
        }

        if (SPAWNS_PYTHON.test(withoutTsComments(text))) {
            return true;
        }

        pending.push(...relativeImports(next, text, read));
    }

    return false;
}

/**
 * Every package whose integration tier spawns the CRF engine, named as CI would address it.
 *
 * @returns The packages, by directory and manifest name.
 * @sideEffect Lists files through git and reads the working tree.
 */
function engineSpawningIntegrationTiers(): readonly Workspace[] {
    return tierConfigs('vitest.integration.config.ts')
        .filter((config) => reachesEngine(configReach(config), readTree))
        .map((config) => {
            const directory = path.posix.dirname(config);
            const manifest: { readonly name?: unknown } = JSON.parse(
                readFileSync(path.join(repoRoot, directory, 'package.json'), 'utf8'),
            );

            return { directory, name: typeof manifest.name === 'string' ? manifest.name : directory };
        });
}

/** One CI job, reduced to its name and its raw YAML body. */
interface CiJob {
    /** The job id, as `_ci.yml` spells it — so a failure names the block to open. */
    readonly name: string;
    /** Every line of the job, verbatim. */
    readonly body: string;
}

/**
 * Read `_ci.yml` down to `<job id>` → the job's raw text.
 *
 * Parsed from the raw text rather than through a YAML library: what matters is the literal shell CI
 * executes, and a re-serialised document is one transformation away from that. Only keys under the top-level
 * `jobs:` mapping are jobs, so the scan starts there — `on:`'s children sit at the same indent.
 *
 * @returns One entry per job, in file order. Impure.
 * @sideEffect Reads the workflow file.
 */
function ciJobs(): readonly CiJob[] {
    const lines = readFileSync(CI_WORKFLOW, 'utf8').split('\n');
    const jobs: { name: string; lines: string[] }[] = [];
    let inJobs = false;

    for (const line of lines) {
        if (/^jobs:\s*$/u.test(line)) {
            inJobs = true;
            continue;
        }

        if (!inJobs) {
            continue;
        }

        const job = /^ {4}([A-Za-z0-9_-]+):\s*$/u.exec(line);

        if (job !== null) {
            jobs.push({ name: job[1] ?? '', lines: [] });
            continue;
        }

        jobs.at(-1)?.lines.push(line);
    }

    return jobs.map(({ name, lines: body }) => ({ name, body: body.join('\n') }));
}

/**
 * Escape a string for literal use inside a regular expression.
 *
 * @param value - The literal.
 * @returns The escaped form. Pure.
 */
function escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * The `npm run test:integration` invocation for one workspace, in every spelling CI uses.
 *
 * ⚠️ A THIRD SPELLING, and it is why this matcher is not simply `--workspace=`. A tier whose subject lives
 * in a package OUTSIDE the npm workspace cannot be addressed by `--workspace=` at all — npm does not know the
 * package — so CI runs it with `working-directory:` plus a bare script. The ingredient-parser packaging and
 * handler tiers are exactly that: they exercise `infra/lib/*`, which became its own package when CDK left the
 * workspace, and they moved with it.
 *
 * ⛔ Missing this spelling does not weaken the guard loudly, it FAILS IT — `running.length` falls to zero and
 * the suite says "no CI job runs this tier". That is the safe direction, but the invariant it protects is
 * unaffected by where the tier lives: the tier still spawns the CRF engine, so the engine must still be
 * installed first, in the same job. Widening the spelling keeps that assertion pointed at the tier.
 *
 * ⚠️ Still ANCHORED to this package's own tree, including subdirectories — `packages/services/ingredient-parser`
 * matches `packages/services/ingredient-parser/infra` but not a sibling. A bare `npm run test:integration`
 * accepted from any directory would let an unrelated job satisfy this workspace's obligation.
 *
 * @param workspace - The workspace.
 * @returns A matcher for that invocation. Pure.
 */
function integrationInvocation({ name, directory }: Workspace): RegExp {
    const byWorkspaceFlag = `test:integration\\s+--workspace=(?:${escapeForRegExp(name)}|${escapeForRegExp(directory)})(?:\\s|$)`;
    const byWorkingDirectory = `working-directory:\\s*${escapeForRegExp(directory)}(?:/\\S+)?\\s*\\n\\s*run:\\s*npm run test:integration(?:\\s|$)`;

    return new RegExp(`(?:${byWorkspaceFlag})|(?:${byWorkingDirectory})`, 'u');
}

describe('what spawns the CRF engine', () => {
    it.each<[string, Readonly<Record<string, string>>, boolean]>([
        ['a suite that spawns it', { 'pkg/tests/a.integration.test.ts': "execFileSync('python3', ['-c', p]);" }, true],
        [
            'a source module the suite imports, two levels down',
            {
                'pkg/tests/a.integration.test.ts': "import { parse } from '../src/parse.js';",
                'pkg/src/parse.ts': "import { spawn } from './engine.js';",
                'pkg/src/engine.ts': 'export const spawn = () => execFile("python3", [script]);',
            },
            true,
        ],
        [
            'a test helper the suite imports',
            {
                'pkg/tests/a.integration.test.ts': "import { engine } from './support/engine.js';",
                'pkg/tests/support/engine.ts': "export const engine = () => spawnSync('python3', []);",
            },
            true,
        ],
        [
            'a source module the suite does NOT import',
            {
                'pkg/tests/a.integration.test.ts': "import { x } from '../src/x.js';",
                'pkg/src/x.ts': 'export const x = 1;',
            },
            false,
        ],
        ['an interpreter named only in a comment', { 'pkg/tests/a.integration.test.ts': "// needs 'python3'" }, false],
        [
            'an import of a module that does not exist',
            { 'pkg/tests/a.integration.test.ts': "import './gone.js';" },
            false,
        ],
        [
            'an import cycle with no interpreter',
            {
                'pkg/tests/a.integration.test.ts': "import { b } from '../src/b.js';",
                'pkg/src/b.ts': "import { a } from './a.js';",
                'pkg/src/a.ts': "import { b } from './b.js';",
            },
            false,
        ],
    ])('%s', (_case, files, expected) => {
        expect(reachesEngine(['pkg/tests/a.integration.test.ts'], (file) => files[file])).toBe(expected);
    });
});

describe('an integration tier that spawns the CRF engine runs where the engine exists', () => {
    it('discovers the engine-spawning integration tiers at all — a guard over an empty set proves nothing', () => {
        expect(
            engineSpawningIntegrationTiers()
                .map((workspace) => workspace.name)
                .toSorted(),
        ).toStrictEqual(['@kitchensink/cookbook-import', '@kitchensink/ingredient-parser-infra']);
    });

    it.each(engineSpawningIntegrationTiers())(
        '$name — every CI job running its integration tier installs the engine first',
        (workspace) => {
            const invocation = integrationInvocation(workspace);
            const running = ciJobs().filter((job) => invocation.test(job.body));

            expect(
                running.length,
                `no CI job runs the ${workspace.name} integration tier — testTierWiring.test.ts owns that rule`,
            ).toBeGreaterThan(0);

            for (const job of running) {
                const install = job.body.indexOf(REQUIREMENTS);
                const invoked = invocation.exec(job.body)?.index ?? -1;

                expect(
                    install,
                    `job \`${job.name}\` runs the ${workspace.name} integration tier, whose suites spawn the CRF Python engine, but never installs it — that tier fails with \`ModuleNotFoundError: No module named 'ingredient_parser'\` on every run. Add \`python3 -m pip install --user --requirement ${REQUIREMENTS}\` plus its importability assertion.`,
                ).toBeGreaterThan(-1);
                expect(
                    install,
                    `job \`${job.name}\` installs the CRF engine AFTER running the ${workspace.name} integration tier`,
                ).toBeLessThan(invoked);
            }
        },
    );

    it.each(engineSpawningIntegrationTiers())(
        '$name — that job OBSERVES the engine importing, so the tier cannot skip in silence',
        (workspace) => {
            // A successful `pip install` is not a working engine: it can land a distribution whose native
            // extension will not load, and these suites guard on availability so a developer without the
            // engine is not blocked. Without an observation CI would then report a green run of a tier it
            // skipped — the vacuity failure `crfEngineVersionParity.test.ts` was written after.
            const invocation = integrationInvocation(workspace);

            for (const job of ciJobs().filter((entry) => invocation.test(entry.body))) {
                expect(
                    job.body,
                    `job \`${job.name}\` installs the CRF engine but never observes it, so a broken install reads as a skipped tier`,
                ).toMatch(/import ingredient_parser|ingredient-parser-nlp'\)/u);
            }
        },
    );
});
