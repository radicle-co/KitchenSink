/**
 * ⛔ THE ACCEPTANCE CRITERION for a rule `docs/CODING_STANDARDS.md` §7 states and nothing enforced: a test
 * tier that is not CALLED BY CI does not exist.
 *
 * ## The failure this closes
 *
 * §7 requires each non-unit tier to have its own config, its own `package.json` script, exclusion from the
 * default `test` globs, AND a CI step — because CI invokes these tiers per-workspace BY NAME rather than
 * discovering them. Every clause is load-bearing, and the last one has no backstop: a workspace can gain a
 * perfectly good `test:integration` script that no workflow ever runs, and nothing goes red. The suite is
 * simply never executed, which reads exactly like a passing suite from the outside.
 *
 * The global infra package spent this whole PR in the opposite failure — six `*.integration.test.ts` files
 * sitting in `__tests__/`, where the DEFAULT unit glob picked them up. They ran, but as unit tests, in
 * parallel with the real unit files. One of them bundles Lambda handlers and writes `dist-lambda/` into the
 * package root; `cdkNagTemplateParity.test.ts` synthesizes the platform twice and requires the two templates
 * to be byte-identical. The bundle landing between those synths broke the ADR-0002 no-prod-diff proof on a
 * diff nobody wrote. Splitting them into a real tier fixes that — and immediately creates the risk this file
 * guards, because the split is what makes CI wiring necessary in the first place.
 *
 * ## What is asserted, and why it is the workflow rather than the script
 *
 * The direction that matters is script → CI. A script with no caller is invisible; a caller with no script
 * fails loudly on the next run, so it needs no test. CI names workspaces two ways — `--workspace=@scope/name`
 * and `--workspace=packages/path/to/pkg` — and both are legitimate, so both are accepted here rather than
 * forcing a cosmetic convention on the workflow.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const CI_WORKFLOW = join(REPO_ROOT, '.github/workflows/_ci.yml');

interface Workspace {
    /** The package's `name` field, as `--workspace=@scope/name` would spell it. */
    readonly name: string;
    /** Its repo-relative directory, as `--workspace=packages/…` would spell it. */
    readonly directory: string;
}

/**
 * Every workspace declaring a `test:integration` script.
 *
 * Walks `packages/` rather than reading the root `workspaces` globs so a package added outside the declared
 * globs still gets caught — the point is to find scripts nobody is running.
 */
function workspacesWithIntegrationScript(directory: string, depth = 0): readonly Workspace[] {
    if (depth > 4) {
        return [];
    }

    const found: Workspace[] = [];

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
            continue;
        }

        const child = join(directory, entry.name);

        if (entry.isDirectory()) {
            found.push(...workspacesWithIntegrationScript(child, depth + 1));
            continue;
        }

        if (entry.name !== 'package.json') {
            continue;
        }

        const manifest = JSON.parse(readFileSync(child, 'utf8')) as {
            name?: string;
            scripts?: Record<string, string>;
        };

        if (manifest.scripts?.['test:integration'] && manifest.name) {
            found.push({ name: manifest.name, directory: relative(REPO_ROOT, directory).replaceAll('\\', '/') });
        }
    }

    return found;
}

describe('every integration tier is called by CI', () => {
    const workspaces = workspacesWithIntegrationScript(PACKAGES_DIR);
    const ci = readFileSync(CI_WORKFLOW, 'utf8');

    it('finds the integration tiers at all — the discovery half', () => {
        // Anchors the analyzer: if the walk breaks or the script is renamed, every assertion below would
        // pass vacuously over an empty list. This is the check that stops "no violations" from meaning
        // "nothing was looked at".
        expect(workspaces.length).toBeGreaterThanOrEqual(9);
        expect(workspaces.map((workspace) => workspace.name)).toContain('@kitchensink/infra-global');
    });

    it.each(workspacesWithIntegrationScript(PACKAGES_DIR).map((workspace) => [workspace.name, workspace]))(
        '%s is run by a step in _ci.yml',
        (_name, workspace) => {
            const byName = ci.includes(`--workspace=${(workspace as Workspace).name}`);
            const byPath = ci.includes(`--workspace=${(workspace as Workspace).directory}`);

            expect(
                byName || byPath,
                `${(workspace as Workspace).name} declares a \`test:integration\` script that no _ci.yml step ` +
                    `runs. CI invokes these tiers by name, so the suite never executes — which looks exactly ` +
                    `like a passing suite. Add a step running \`npm run test:integration ` +
                    `--workspace=${(workspace as Workspace).name}\`.`,
            ).toBe(true);
        },
    );
});
