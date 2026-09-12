// @vitest-environment node
/**
 * Repo-wide guard: an infra package whose code resolves a WORKSPACE package gets the root workspace installed
 * by the CI job that checks it.
 *
 * ## Why this exists
 *
 * The CDK apps sit OUTSIDE the npm workspace, and `.github/actions/infra-package` installs only the package's
 * own directory unless the caller passes `workspace-install: 'true'`. Nothing in that directory's install
 * provides `@kitchensink/*` — so a package that imports one, or whose `tsconfig.json` extends
 * `@kitchensink/typescript`, fails `tsc` in CI while passing on every developer machine, where the root
 * `node_modules` is always there to be found by walking up.
 *
 * That is exactly what happened to `infra — global`: 27 `TS2307`s on every run from 2026-09-08, starting
 * with `File '@kitchensink/typescript/base.json' not found`. The Typecheck failure skipped the package's
 * unit Test step, so none of its guards ever executed in CI, and the eight package jobs that `needs:` it
 * were skipped with it. It was invisible because the failure looked like a type error, not a missing
 * install.
 *
 * ## Derived on both sides
 *
 * The workspace package names come from the root manifest's own `workspaces` globs, and the imports from
 * each infra package's own sources — so a new workspace dependency, or a new infra job, is covered the day
 * it is written without anyone updating a list here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { WORKFLOWS_DIR } from './cdkApps.js';
import { moduleSpecifiers, presentFiles, repoRoot } from './serviceSources.js';

const INFRA_WORKFLOW = path.join(repoRoot, WORKFLOWS_DIR, 'deploy-infra.yml');
const INFRA_ACTION = './.github/actions/infra-package';

/** Every package name the root workspace provides. */
function workspacePackageNames(): ReadonlySet<string> {
    const { workspaces } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        workspaces: readonly string[];
    };

    return new Set(
        workspaces
            .flatMap((pattern) => globSync(`${pattern}/package.json`, { cwd: repoRoot }))
            .map(
                (manifest) =>
                    (JSON.parse(readFileSync(path.join(repoRoot, manifest), 'utf8')) as { name?: string }).name,
            )
            .filter((name): name is string => name !== undefined),
    );
}

/** The package a bare specifier names: `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
function packageOf(specifier: string): string {
    const parts = specifier.split('/');

    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/**
 * The workspace packages an infra package reaches, with the file that reaches each.
 *
 * Sources AND `tsconfig.json`'s `extends` — the latter is the one that broke `global`, and it is not an
 * import, so a specifier scan alone would have missed the very case this guard was written for.
 */
function workspaceReach(directory: string, workspace: ReadonlySet<string>): readonly string[] {
    const reached: string[] = [];
    const tsconfig = path.join(repoRoot, directory, 'tsconfig.json');
    const extendsText = (() => {
        try {
            return (JSON.parse(readFileSync(tsconfig, 'utf8')) as { extends?: string | string[] }).extends;
        } catch {
            return undefined;
        }
    })();

    for (const target of [extendsText ?? []].flat()) {
        if (workspace.has(packageOf(target))) {
            reached.push(`tsconfig.json extends ${target}`);
        }
    }

    for (const file of presentFiles([`${directory}/**/*.ts`, `${directory}/**/*.mts`])) {
        if (file.includes('/cdk.out/') || file.includes('/dist/')) {
            continue;
        }

        const contents = readFileSync(path.join(repoRoot, file), 'utf8');

        for (const specifier of moduleSpecifiers({ file, contents })) {
            if (!specifier.startsWith('.') && workspace.has(packageOf(specifier))) {
                reached.push(`${path.relative(directory, file)} imports ${specifier}`);
            }
        }
    }

    return reached;
}

interface InfraJob {
    readonly job: string;
    readonly directory: string;
    readonly workspaceInstall: boolean;
}

/** Every job in the infra workflow that runs the infra-package action, with what it asks of it. */
function infraJobs(): readonly InfraJob[] {
    const doc = parse(readFileSync(INFRA_WORKFLOW, 'utf8')) as {
        jobs: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
    };

    return Object.entries(doc.jobs).flatMap(([job, definition]) =>
        (definition.steps ?? [])
            .filter((step) => step.uses === INFRA_ACTION)
            .map((step) => ({
                job,
                directory: String(step.with?.['directory'] ?? ''),
                workspaceInstall: String(step.with?.['workspace-install'] ?? 'false') === 'true',
            })),
    );
}

describe('every infra job installs the root workspace when its package reaches into it', () => {
    const workspace = workspacePackageNames();

    it('reads the workspace at all', () => {
        // Non-vacuity: an empty set makes every package look self-contained and every job pass.
        expect(workspace.has('@kitchensink/typescript')).toBe(true);
    });

    it('finds the infra jobs at all', () => {
        expect(infraJobs().length).toBeGreaterThanOrEqual(8);
    });

    it('is not vacuous: at least one package does reach the workspace', () => {
        // Without this, a scanner that found nothing would pass every job below.
        expect(infraJobs().some(({ directory }) => workspaceReach(directory, workspace).length > 0)).toBe(true);
    });

    it.each(infraJobs().map((job) => [job.job, job] as const))('%s', (_name, job) => {
        const reach = workspaceReach(job.directory, workspace);

        if (reach.length > 0) {
            expect(
                job.workspaceInstall,
                `${job.job} (${job.directory}) reaches the workspace but never installs it:\n  ${reach.slice(0, 5).join('\n  ')}`,
            ).toBe(true);
        }
    });
});
