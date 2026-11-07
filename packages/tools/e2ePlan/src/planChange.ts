/**
 * Turns the list of changed files into a plan: which end-to-end tests to run.
 *
 * The models of the two tiers (the import graphs, the registries) are expensive to build and are built only when a
 * changed file needs them: a documentation-only or service-only change is settled by its path alone.
 */
import { classifyPath, selectTier, type FileImpact, type TierName } from './impactPolicy.js';
import type { Reached } from './reachability.js';
import { fullPlan, type Plan } from './selection.js';

/** Everything the selector knows about one tier. */
export interface TierModel {
    readonly name: TierName;
    readonly screens: readonly string[];
    /** Every test of the tier. */
    readonly tests: readonly string[];
    /** Test id to the screens it passes through. */
    readonly coverage: ReadonlyMap<string, ReadonlySet<string>>;
    /** What a change to the file reaches in this tier, or undefined when this tier's graphs do not hold the file. */
    readonly reachFile: (file: string) => Reached | undefined;
    /** Blind spots of this tier's graphs. Any means the graph cannot be trusted to be complete. */
    readonly problems: readonly string[];
}

export interface Models {
    readonly web: TierModel;
    readonly mobile: TierModel;
}

const isEmpty = (reached: Reached): boolean => reached.screens.size + reached.tests.size + reached.roots.length === 0;

function impactOf(file: string, models: Models): FileImpact {
    const tiers = { web: models.web.reachFile(file), mobile: models.mobile.reachFile(file) };
    const useful = Object.values(tiers).some((reached) => reached !== undefined && !isEmpty(reached));

    return useful ? { kind: 'reaches', tiers: tiers } : { kind: 'unreached' };
}

/**
 * Plans the end-to-end run for a change.
 *
 * Fails SAFE: a selector that throws returns the full suite with a warning, never an empty plan.
 *
 * @param files - Repo-relative changed files.
 * @param loadModels - Builds the tier models; called only if a file cannot be settled by its path.
 * @param options - `fullSuite` forces everything.
 * @returns The plan.
 */
export async function planChange(
    files: readonly string[],
    loadModels: () => Promise<Models>,
    options: { readonly fullSuite: boolean },
): Promise<Plan> {
    if (options.fullSuite) {
        return fullPlan('FULL_SUITE=1');
    }

    const impacts = new Map<string, FileImpact>();
    const unsettled = files.filter((file) => {
        const settled = classifyPath(file);

        if (settled !== undefined) {
            impacts.set(file, settled);
        }

        return settled === undefined;
    });

    if (unsettled.length === 0) {
        return selectBoth(impacts, undefined);
    }

    let models: Models;

    try {
        models = await loadModels();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        const settled = selectBoth(impacts, undefined);
        const reasons = [
            ...(settled.web.kind === 'all' ? settled.web.reasons : []),
            `the selector could not build its model: ${message}`,
        ];

        return {
            web: { kind: 'all', reasons },
            mobile: { kind: 'all', reasons },
            warnings: [`the selector failed (${message}); running everything`],
        };
    }

    for (const file of unsettled) {
        impacts.set(file, impactOf(file, models));
    }

    return selectBoth(impacts, models);
}

function selectBoth(impacts: ReadonlyMap<string, FileImpact>, models: Models | undefined): Plan {
    const tier = (name: TierName) => {
        const model = models?.[name];
        const selection = selectTier({
            tier: name,
            impacts,
            coverage: model?.coverage ?? new Map(),
            screens: model?.screens ?? [],
            fullSuite: false,
        });

        return model !== undefined && model.problems.length > 0
            ? { kind: 'all' as const, reasons: model.problems.map((problem) => `import graph incomplete: ${problem}`) }
            : selection;
    };

    return { web: tier('web'), mobile: tier('mobile'), warnings: [] };
}
