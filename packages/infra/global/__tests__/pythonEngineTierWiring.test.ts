// @vitest-environment node
/**
 * Repo-wide guard: an integration tier whose subject SPAWNS the CRF Python engine must run in a CI job that
 * installs that engine — and that job must ASSERT the engine imports, so the tier cannot go quiet.
 *
 * ## The failure this closes
 *
 * `localParsePath.integration.test.ts` drives the shipped local parse wiring, which runs the DEPLOYED
 * `packages/services/ingredient-parser/src/handler.py` as a subprocess. It landed with no CI step installing
 * `ingredient-parser-nlp`, so `integration-recipe-workers` failed on EVERY run of its branch with
 *
 *     ModuleNotFoundError: No module named 'ingredient_parser'
 *
 * The suite's own header claimed this was survivable — "the CRF leg answers ABSENCE … and the line still
 * lands" — and that claim is false against the shipped code. `handlers/parseLine.ts` classifies everything an
 * ENGINE throws as TRANSIENT and re-throws BEFORE any landing, deliberately: ADR-0026's 2026-08-31 update
 * puts "a CRF invocation failure" in the transient set precisely so an outage cannot become a line's
 * permanent answer. So an absent engine is not a degraded run, it is no run at all.
 *
 * `integrationTierWiring.test.ts` asks whether a tier is CALLED by CI. It cannot ask whether the runner it is
 * called on can actually execute it, and a tier CI calls but cannot run is a tier that does not exist
 * (`docs/CODING_STANDARDS.md` §7.1).
 *
 * ## Both sides are DISCOVERED
 *
 * - The **subjects** are workspaces whose tracked sources either contain a `.py` file or spawn `python3`.
 *   That resolves to `ingredient-parser` (it owns `handler.py`), `recipe-workers` (`localCrfEngine.ts`) and
 *   `cookbook-import` (`crfProcess.ts`, `crfEngine.ts`) — measured, with no false positives — and a fourth
 *   workspace that starts driving the engine is covered the day it does, rather than the day someone
 *   remembers to edit a list. "A copy of a list cannot detect that the list is incomplete" (ADR-0025 §3).
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

import { presentFiles, repoRoot } from './serviceSources.js';

const CI_WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_ci.yml', import.meta.url));

/** The pin file every install of the engine must read, so a literal version cannot pass as an install. */
const REQUIREMENTS = 'packages/services/ingredient-parser/requirements.txt';

/** One workspace directory plus the manifest name CI would spell it with. */
interface Workspace {
    readonly directory: string;
    readonly name: string;
}

/**
 * Every workspace whose own sources need a Python interpreter carrying the CRF engine.
 *
 * @returns The workspaces, by directory and manifest name. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function pythonDependentWorkspaces(): readonly Workspace[] {
    const manifests = presentFiles(['packages/**/package.json']).filter((file) => !file.includes('/dist/'));
    const found: Workspace[] = [];

    for (const manifest of manifests) {
        const directory = path.posix.dirname(manifest);
        const sources = presentFiles([`${directory}/**`]).filter(
            (file) => !file.includes('/node_modules/') && !file.includes('/dist/'),
        );
        // A nested workspace's files would otherwise be attributed to its parent directory.
        const own = sources.filter(
            (file) =>
                !manifests.some((other) => other !== manifest && file.startsWith(`${path.posix.dirname(other)}/`)),
        );
        const needsPython = own.some(
            (file) =>
                file.endsWith('.py') ||
                (/\.(?:ts|mts|cts|js|mjs)$/u.test(file) &&
                    !file.includes('__tests__/') &&
                    !file.includes('.test.') &&
                    /['"]python3['"]/u.test(readFileSync(path.join(repoRoot, file), 'utf8'))),
        );

        if (!needsPython) {
            continue;
        }

        const { name } = JSON.parse(readFileSync(path.join(repoRoot, manifest), 'utf8')) as { name?: string };

        if (name !== undefined) {
            found.push({ directory, name });
        }
    }

    return found;
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
 * The `npm run test:integration --workspace=…` invocation for one workspace, in either spelling CI uses.
 *
 * @param workspace - The workspace.
 * @returns A matcher for that invocation. Pure.
 */
function integrationInvocation({ name, directory }: Workspace): RegExp {
    return new RegExp(
        `test:integration\\s+--workspace=(?:${escapeForRegExp(name)}|${escapeForRegExp(directory)})(?:\\s|$)`,
        'u',
    );
}

describe('an integration tier that spawns the CRF engine runs where the engine exists', () => {
    it('discovers the python-dependent workspaces at all — a guard over an empty set proves nothing', () => {
        expect(
            pythonDependentWorkspaces()
                .map((workspace) => workspace.name)
                .toSorted(),
        ).toStrictEqual([
            '@kitchensink/cookbook-import',
            '@kitchensink/ingredient-parser',
            '@kitchensink/recipe-workers',
        ]);
    });

    it.each(pythonDependentWorkspaces())(
        '$name — every CI job running its integration tier installs the engine first',
        (workspace) => {
            const invocation = integrationInvocation(workspace);
            const running = ciJobs().filter((job) => invocation.test(job.body));

            expect(
                running.length,
                `no CI job runs the ${workspace.name} integration tier — integrationTierWiring.test.ts owns that rule`,
            ).toBeGreaterThan(0);

            for (const job of running) {
                const install = job.body.indexOf(REQUIREMENTS);
                const invoked = invocation.exec(job.body)?.index ?? -1;

                expect(
                    install,
                    `job \`${job.name}\` runs the ${workspace.name} integration tier, whose subject spawns the CRF Python engine, but never installs it — that tier fails with \`ModuleNotFoundError: No module named 'ingredient_parser'\` on every run. Add \`python3 -m pip install --user --requirement ${REQUIREMENTS}\` plus its importability assertion.`,
                ).toBeGreaterThan(-1);
                expect(
                    install,
                    `job \`${job.name}\` installs the CRF engine AFTER running the ${workspace.name} integration tier`,
                ).toBeLessThan(invoked);
            }
        },
    );

    it.each(pythonDependentWorkspaces())(
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
