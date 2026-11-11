/**
 * Which packages a change asks the fast tiers (unit and integration tests, lint, typecheck, format) to run: the policy
 * that turns "these files changed" into "seed these packages, or run the whole tier" (ADR-0091).
 *
 * It mirrors `impactPolicy.ts`, the end-to-end selector, in its one rule: skipping a check a change needs is the
 * failure that matters, so a path this module cannot attribute widens the run to the whole tier. Its lists differ on
 * purpose. A test file or a repo guard selects nothing for a Playwright spec and everything for its own package here.
 *
 * Dependents are NOT computed here. The graph adapter (`checkScopeGraph.ts`) hands the seeds to turbo's own `...pkg`
 * filter, which walks the package graph; hand-rolling that walk would be a second copy of a fact turbo already owns.
 *
 * @pattern Specification — one pure predicate per path, composed into a tier decision
 * @pattern Visitor — exhaustive switch over the {@link PathImpact} union
 */
import picomatch from 'picomatch';

import type { Pick } from './selection.js';

/** A workspace package: its name and its repo-relative folder. */
export interface Workspace {
    readonly name: string;
    readonly dir: string;
}

/** What turbo's resolved task definition says about one package's task. */
export interface TaskFacts {
    readonly package: string;
    /** `cache: false` marks a task whose real inputs turbo cannot hash; it always runs. */
    readonly cache: boolean;
    /** Declared `$TURBO_ROOT$` inputs, as repo-relative globs. */
    readonly outsideInputs: readonly string[];
}

/** Where the change came from: a list of files, or an instruction to run everything. */
export type ChangeSource =
    { readonly kind: 'full'; readonly reason: string } | { readonly kind: 'files'; readonly files: readonly string[] };

/**
 * A seed package and why. `dependents` says whether what depends on it is selected too: true when a file IN it changed,
 * false when only its own task is affected (a declared outside input, or a task that always runs).
 */
export interface Seed extends Pick {
    readonly dependents: boolean;
}

/** The tier's answer: every package that has the task, or these seed packages. */
export type TaskScope =
    | { readonly kind: 'all'; readonly reasons: readonly string[] }
    | { readonly kind: 'some'; readonly seeds: readonly Seed[] };

type PathImpact =
    | { readonly kind: 'irrelevant' }
    | { readonly kind: 'global'; readonly reason: string }
    | { readonly kind: 'owned'; readonly by: string };

/**
 * The selector's own source. A change to the rule that decides what runs is checked by running everything.
 */
export const SELECTOR_SOURCES: readonly string[] = [
    'packages/tools/e2ePlan/src/checkScope*.ts',
    'packages/tools/e2ePlan/bin/checkScope.ts',
    'packages/tools/e2ePlan/src/gitChangeSet.ts',
    'packages/tools/e2ePlan/src/worktreeSnapshot.ts',
];

const SELF = picomatch([...SELECTOR_SOURCES]);

const TURBO_CONFIG = picomatch('**/turbo.json', { dot: true });

/** Prose outside every package. Inside a package a markdown file may be read by its tests, so it is owned there. */
const OUTSIDE_PROSE = picomatch('**/*.md', { dot: true });

const isUnder = (path: string, dir: string): boolean => path.startsWith(`${dir}/`);

/**
 * The workspace that owns a path: the deepest workspace folder that contains it. A folder nested inside a workspace
 * that is not one itself (a service's `infra/`, with its own `package.json`) belongs to the workspace around it,
 * because no other workspace can import it.
 *
 * @param path - Repo-relative path.
 * @param workspaces - Every workspace.
 * @returns The owner's name, or undefined when no workspace contains the path.
 */
function ownerOf(path: string, workspaces: readonly Workspace[]): string | undefined {
    let best: Workspace | undefined;

    for (const workspace of workspaces) {
        if (isUnder(path, workspace.dir) && (best === undefined || workspace.dir.length > best.dir.length)) {
            best = workspace;
        }
    }

    return best?.name;
}

function classify(path: string, workspaces: readonly Workspace[]): PathImpact {
    if (SELF(path)) {
        return { kind: 'global', reason: 'the selector itself changed' };
    }

    if (TURBO_CONFIG(path)) {
        return { kind: 'global', reason: 'turbo configuration' };
    }

    const owner = ownerOf(path, workspaces);

    if (owner !== undefined) {
        return { kind: 'owned', by: owner };
    }

    if (OUTSIDE_PROSE(path)) {
        return { kind: 'irrelevant' };
    }

    return {
        kind: 'global',
        reason: 'outside every package (a root config, the lockfile, a workflow, a script or a docs asset), so the package graph cannot say what it affects',
    };
}

export interface ScopeTaskInput {
    readonly change: ChangeSource;
    readonly workspaces: readonly Workspace[];
    /** One entry per package that defines the task. */
    readonly facts: readonly TaskFacts[];
}

/**
 * Decides one task's scope from the change.
 *
 * Seeds are: the owner of every changed file; every package whose task declares an outside input that changed; every
 * package whose task turbo cannot cache. A declared outside input that changed is attributed to its task instead of
 * widening, because the declaration is exactly the statement "this task reads that file".
 *
 * @param input - The change, the workspaces and the task's facts.
 * @returns `all` with a reason per widening file, or the seed packages with why each was chosen.
 */
export function scopeTask(input: ScopeTaskInput): TaskScope {
    if (input.change.kind === 'full') {
        return { kind: 'all', reasons: [input.change.reason] };
    }

    const widening: string[] = [];
    const because = new Map<string, { reasons: string[]; dependents: boolean }>();

    const choose = (id: string, reason: string, dependents: boolean): void => {
        const entry = because.get(id);

        because.set(id, {
            reasons: [...(entry?.reasons ?? []), reason],
            dependents: dependents || entry?.dependents === true,
        });
    };

    const declared = input.facts.map((fact) => ({
        package: fact.package,
        matches: picomatch([...fact.outsideInputs], { dot: true }),
    }));

    for (const file of [...input.change.files].sort()) {
        const readers = declared.filter((entry) => entry.matches(file));

        for (const reader of readers) {
            choose(reader.package, `${file} is a declared input of its task`, false);
        }

        const impact = classify(file, input.workspaces);

        switch (impact.kind) {
            case 'irrelevant':
                break;
            case 'owned':
                choose(impact.by, `${file} is in it`, true);
                break;
            case 'global':
                if (readers.length === 0) {
                    widening.push(`${file}: ${impact.reason}`);
                }

                break;

            default: {
                const unhandled: never = impact;

                widening.push(`${file}: an impact the selector does not know (${JSON.stringify(unhandled)})`);
            }
        }
    }

    if (widening.length > 0) {
        return { kind: 'all', reasons: widening };
    }

    for (const fact of input.facts) {
        if (!fact.cache) {
            choose(fact.package, 'turbo cannot cache it, so it always runs', false);
        }
    }

    return {
        kind: 'some',
        seeds: [...because]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, entry]) => ({ id, because: entry.reasons.join('; '), dependents: entry.dependents })),
    };
}
