/**
 * What a changed file means for the tests: the policy that turns "this file changed" into "run those tests".
 *
 * ## The rule that governs every line here
 *
 * Skipping a test that a change needs is the failure that matters; running too many only costs time. So every
 * case this module cannot attribute widens the run, and the only thing that selects ZERO is a short, explicit list
 * of paths that cannot change a test result.
 */
import picomatch from 'picomatch';

import type { Reached } from './reachability.js';
import type { Pick, TierSelection } from './selection.js';

export type TierName = 'web' | 'mobile';

/** What one changed file means. */
export type FileImpact =
    /** It cannot change a test result. */
    | { readonly kind: 'irrelevant' }
    /** It changes the environment every test runs in, which the import graph cannot see. */
    | { readonly kind: 'global'; readonly reason: string }
    /** The import graph reaches no screen and no test from it. */
    | { readonly kind: 'unreached' }
    /** The import graph reaches these, per tier. A tier whose graph does not hold the file is absent. */
    | { readonly kind: 'reaches'; readonly tiers: Partial<Record<TierName, Reached>> };

const IRRELEVANT = picomatch(['docs/**', 'specs/**', '**/*.md'], { dot: true });

const GLOBAL: readonly { readonly matches: (path: string) => boolean; readonly reason: string }[] = [
    {
        matches: picomatch('packages/services/**', { dot: true }),
        reason: 'service source: the specs run against the local stack, and the import graph cannot see into a service',
    },
    {
        matches: picomatch('packages/schemas/**', { dot: true }),
        reason: 'wire schema: the specs run against the local stack, and the import graph cannot see into a service',
    },
    {
        matches: picomatch('packages/clients/**', { dot: true }),
        reason: 'service client: the specs run against the local stack, and the import graph cannot see into a service',
    },
    { matches: picomatch('**/turbo.json', { dot: true }), reason: 'turbo configuration' },
    { matches: picomatch('**/playwright.config.*', { dot: true }), reason: 'Playwright configuration' },
    { matches: picomatch('**/.maestro/config.yaml', { dot: true }), reason: 'Maestro configuration' },
    { matches: (path) => !path.includes('/'), reason: 'root configuration' },
];

/**
 * Settles a path from its name alone, if its name settles it.
 *
 * @param path - Repo-relative path.
 * @returns `irrelevant` or `global`, or undefined when only the import graph can say.
 */
export function classifyPath(path: string): Extract<FileImpact, { kind: 'irrelevant' | 'global' }> | undefined {
    if (IRRELEVANT(path)) {
        return { kind: 'irrelevant' };
    }

    const hit = GLOBAL.find((rule) => rule.matches(path));

    return hit === undefined ? undefined : { kind: 'global', reason: hit.reason };
}

export interface SelectTierInput {
    readonly tier: TierName;
    readonly impacts: ReadonlyMap<string, FileImpact>;
    /** Test id to the screens it passes through. A row of `*` names every screen. */
    readonly coverage: ReadonlyMap<string, ReadonlySet<string>>;
    readonly screens: readonly string[];
    readonly fullSuite: boolean;
}

/** A row of `*` is every screen. */
const rowScreens = (row: ReadonlySet<string>, screens: readonly string[]): ReadonlySet<string> =>
    row.has('*') ? new Set(screens) : row;

/**
 * Decides one tier's selection from what each changed file means.
 *
 * An exhaustive switch over {@link FileImpact}: a new kind of impact is a compile error here, not a quiet gap.
 *
 * @param input - The tier, the impacts, and the coverage table.
 * @returns Everything, with a reason per change that forced it, or the tests that cover what changed.
 */
export function selectTier(input: SelectTierInput): TierSelection {
    if (input.fullSuite) {
        return { kind: 'all', reasons: ['FULL_SUITE=1'] };
    }

    const widening: string[] = [];
    const reasonsFor = new Map<string, string[]>();

    const choose = (id: string, reason: string): void => {
        reasonsFor.set(id, [...(reasonsFor.get(id) ?? []), reason]);
    };

    for (const [file, impact] of [...input.impacts].sort(([a], [b]) => a.localeCompare(b))) {
        switch (impact.kind) {
            case 'irrelevant':
                break;
            case 'global':
                widening.push(`${file}: ${impact.reason}`);
                break;
            case 'unreached':
                widening.push(`${file}: no screen or test imports it, so the import graph cannot say what it affects`);
                break;

            case 'reaches': {
                const reached = impact.tiers[input.tier];

                if (reached === undefined) {
                    break;
                }

                if (reached.roots.length > 0) {
                    widening.push(`${file} reaches ${reached.roots.join(', ')}, which every screen runs through`);
                }

                for (const id of reached.tests) {
                    choose(id, `${file} is part of it`);
                }

                for (const [id, row] of input.coverage) {
                    const shared = [...rowScreens(row, input.screens)].filter((screen) => reached.screens.has(screen));

                    if (shared.length > 0) {
                        choose(id, `${file} reaches ${shared.sort().join(', ')}`);
                    }
                }

                break;
            }
        }
    }

    if (widening.length > 0) {
        return { kind: 'all', reasons: widening };
    }

    const picks: Pick[] = [...reasonsFor]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, reasons]) => ({ id, because: reasons.join('; ') }));

    return { kind: 'some', picks };
}
