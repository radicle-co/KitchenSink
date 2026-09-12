// @vitest-environment node
/**
 * Repo-wide guard: a workflow job that RUNS code from a CDK app's `infra/` folder installs that folder first.
 *
 * ## Why this exists
 *
 * The CDK apps live OUTSIDE the npm workspace, each with its own `node_modules` — `aws-cdk-lib`,
 * `@radicle-co/infra-shared` and the app's own `tsx` resolve from there and nowhere else. A job that installs
 * only the ROOT workspace and then runs `npx tsx packages/<svc>/infra/…` gets `ERR_MODULE_NOT_FOUND` for the
 * first CDK import. `.github/actions/infra-package` exists to make that impossible for the per-package jobs;
 * this guard covers the jobs that reach into an `infra/` folder WITHOUT going through it.
 *
 * Found on 2026-09-11 in two of them at once, both a job away from the action that would have installed it:
 *
 * - `_sandbox-preview.yml` › `gate` ran `infra/bin/printFoodHost.ts` after `npm ci` at the root. Every PR's
 *   "Decide whether this preview deploys" failed at `Cannot find package 'aws-cdk-lib'`, from 2026-09-08.
 * - `deploy-infra.yml` › `ecosystem-smoke` ran the same helper the same way. It runs only on a real deploy,
 *   so it had never failed yet — the first sign would have been a red post-deploy step on production.
 *
 * ## What counts as "needs an install", and why it is derived
 *
 * Not every `infra/` path does: `recipe-service/infra/smoke/deployedSmoke.ts` imports only `node:util` and
 * runs happily from the root. So the requirement is read from the CODE — the entrypoint's import closure
 * inside its own folder, asking whether anything in it imports a bare package that is neither a `node:`
 * builtin nor a workspace package — and a path under `infra/node_modules/` needs the install by definition.
 * An allow-list here would be the copy that goes stale the day the smoke gains an import.
 *
 * ⚠️ What it cannot see: a job that reaches an `infra/` folder INDIRECTLY, by running a test suite whose code
 * spawns it (the recipe-workers integration job's `workersAppSynth` spawned `infra/node_modules/.bin/tsx`).
 * Text in a `run:` body is the population; a child process three layers down is not.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ACTIONS_DIR, WORKFLOWS_DIR, withoutComments } from './cdkApps.js';
import { moduleSpecifiers, repoRoot, trackedFiles } from './serviceSources.js';

const INFRA_ACTION = './.github/actions/infra-package';

/**
 * A path into a CDK app's folder, split at the folder: `packages/services/food-service/infra` + `bin/x.ts`.
 *
 * ⚠️ Two shapes, and the order matters: `packages/infra/global` is a CDK folder that is NOT named `infra`, so
 * a single "ends in `/infra`" pattern reads it as `packages/infra` + `global/bin/app.ts` — a folder with no
 * `package.json` at all.
 */
const INFRA_PATH = /\b(packages\/infra\/[\w.-]+|packages\/(?:[\w.-]+\/)+?infra)\/([\w./-]+)/gu;

interface Step {
    readonly uses?: string;
    readonly run?: string;
    readonly 'working-directory'?: string;
    readonly with?: Record<string, unknown>;
}

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

/** The on-disk file a relative import in `from` names, trying the `.js`→`.ts` rewrite NodeNext uses. */
function resolveRelative(from: string, specifier: string): string | undefined {
    const base = path.resolve(path.dirname(from), specifier);

    return [base, base.replace(/\.js$/u, '.ts'), `${base}.ts`, path.join(base, 'index.ts')].find(
        (candidate) => candidate.endsWith('.ts') && existsSync(candidate),
    );
}

/**
 * The first package in `entry`'s import closure that only the folder's OWN install provides, or `undefined`.
 *
 * @param entry - Absolute path of the entrypoint a job runs.
 * @param workspace - Package names the root install provides.
 * @returns e.g. `aws-cdk-lib (via lib/FoodServiceStack.ts)`. Impure.
 * @sideEffect Reads source files.
 */
function needsOwnInstall(entry: string, workspace: ReadonlySet<string>): string | undefined {
    const seen = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
        const file = queue.shift() ?? '';

        if (seen.has(file)) {
            continue;
        }

        seen.add(file);

        for (const specifier of moduleSpecifiers({ file, contents: readFileSync(file, 'utf8') })) {
            if (specifier.startsWith('.')) {
                const next = resolveRelative(file, specifier);

                if (next !== undefined) {
                    queue.push(next);
                }
            } else if (!specifier.startsWith('node:') && !workspace.has(packageOf(specifier))) {
                return `${specifier} (via ${path.relative(repoRoot, file)})`;
            }
        }
    }

    return undefined;
}

/** Whether a step installs the given infra folder. */
function installs(step: Step, directory: string): boolean {
    if (step.uses === INFRA_ACTION) {
        return step.with?.['directory'] === directory;
    }

    const run = step.run ?? '';

    if (!/\bnpm\s+(?:ci|install)\b/u.test(run)) {
        return false;
    }

    // The loop form `prod-deploy.yml` uses — `for app in <globs>; do npm install --prefix "${app}"` — installs
    // every folder its globs match, so expand them rather than asking for the literal path.
    const loop = /\bfor\s+(\w+)\s+in\s+([^;\n]+?)\s*;\s*do\b/u.exec(run);

    if (loop !== null && new RegExp(`--prefix\\s+"?\\$\\{?${loop[1] ?? ''}\\}?"?`, 'u').test(run)) {
        const patterns = (loop[2] ?? '').split(/\s+/u).filter((pattern) => pattern !== '');

        if (patterns.some((pattern) => globSync(pattern, { cwd: repoRoot }).includes(directory))) {
            return true;
        }
    }

    return (
        step['working-directory'] === directory ||
        run.includes(`--prefix ${directory}`) ||
        run.includes(`--prefix "${directory}"`) ||
        new RegExp(`\\bcd\\s+"?${directory.replaceAll('/', '\\/')}"?`, 'u').test(run)
    );
}

interface Use {
    readonly id: string;
    readonly directory: string;
    readonly reason: string;
    readonly installed: boolean;
}

/** Every job step that runs something from an `infra/` folder that needs that folder's own install. */
/**
 * Every ordered step list a runner executes: each workflow JOB, and each composite ACTION's `runs.steps`.
 *
 * ⚠️ The action is not optional. `recipe-schema` died in `.github/actions/infra-package`'s food-origin step —
 * the same class as the two workflow jobs, one layer down — and a scan of workflows alone passed it.
 */
function stepLists(): readonly { readonly label: string; readonly steps: readonly Step[] }[] {
    const workflows = trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml'))
        .flatMap((file) => {
            const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                jobs?: Record<string, { steps?: Step[] }>;
            } | null;

            return Object.entries(doc?.jobs ?? {}).map(([job, definition]) => ({
                label: `${path.basename(file)} › ${job}`,
                steps: definition.steps ?? [],
            }));
        });
    const actions = trackedFiles(ACTIONS_DIR)
        .filter((file) => /\/action\.ya?ml$/u.test(file))
        .map((file) => {
            const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as { runs?: { steps?: Step[] } } | null;

            return { label: path.dirname(file), steps: doc?.runs?.steps ?? [] };
        });

    return [...workflows, ...actions];
}

function infraUses(): readonly Use[] {
    const workspace = workspacePackageNames();

    return stepLists().flatMap(({ label, steps }) => {
        return steps.flatMap((step, index) =>
            [...withoutComments(step.run ?? '').matchAll(INFRA_PATH)].flatMap((match) => {
                const directory = match[1] ?? '';
                const rest = match[2] ?? '';
                const body = match.input;
                const lineBefore = body.slice(body.lastIndexOf('\n', match.index) + 1, match.index);

                // ⚠️ EXECUTED, not merely mentioned. `prod-deploy.yml`'s flag table, the stack probe in
                // `sandbox-identity-deploy.yml` and `sandbox-up.yml`'s verify targets all NAME an
                // entrypoint as data — the last resolves it through the generated manifest and never
                // synthesizes — so a mention is not a use. A path runs when `tsx`/`node` is handed it,
                // or when it IS a binary under `node_modules/.bin`.
                if (!rest.startsWith('node_modules/') && !/\b(?:tsx|node)\s+["']?$/u.test(lineBefore)) {
                    return [];
                }

                const entry = path.join(repoRoot, directory, rest);
                const reason = rest.startsWith('node_modules/')
                    ? rest
                    : rest.endsWith('.ts') && existsSync(entry)
                      ? needsOwnInstall(entry, workspace)
                      : undefined;

                if (reason === undefined) {
                    return [];
                }

                return [
                    {
                        id: `${label} › ${rest}`,
                        directory,
                        reason,
                        // Installed by an EARLIER step, or earlier in THIS step's own body — a later
                        // install cannot help.
                        installed:
                            steps.slice(0, index).some((earlier) => installs(earlier, directory)) ||
                            installs({ ...step, run: body.slice(0, match.index) }, directory),
                    },
                ];
            }),
        );
    });
}

describe('a job that runs infra/ code installs that infra/ folder first', () => {
    const uses = infraUses();

    it('finds the uses at all', () => {
        // Non-vacuity: the helper is run from several workflows, so zero means the scanner broke.
        expect(uses.length).toBeGreaterThanOrEqual(3);
    });

    it('does not demand an install for code that needs none', () => {
        // The negative control: the recipe smoke imports only `node:` builtins. If the closure walk ever
        // stopped discriminating, this would appear in `uses` and the guard would demand installs everywhere.
        expect(
            needsOwnInstall(
                path.join(repoRoot, 'packages/services/recipe-service/infra/smoke/deployedSmoke.ts'),
                workspacePackageNames(),
            ),
        ).toBeUndefined();
        expect(
            needsOwnInstall(
                path.join(repoRoot, 'packages/services/food-service/infra/bin/printFoodHost.ts'),
                workspacePackageNames(),
            ),
        ).toMatch(/aws-cdk-lib|@radicle-co\/infra-shared/u);
    });

    it.each(uses.map((use) => [use.id, use] as const))('%s', (_id, use) => {
        expect(
            use.installed,
            `needs ${use.directory}'s own install (${use.reason}), and no earlier step provides it`,
        ).toBe(true);
    });
});
