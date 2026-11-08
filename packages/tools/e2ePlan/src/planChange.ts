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
    /**
     * Whether the file PROVABLY belongs to the other platform: it sits in the other app's folder, or it is a web
     * leaf whose `.native` twin this tier's graph holds (or the reverse). A file this tier's graph does not hold and
     * that is not provably the other platform's is NOT assumed unaffecting.
     */
    readonly belongsToOtherPlatform: (file: string) => boolean;
    /** The files of this tier's graph that SHIP and import the file. Test files are not in the graph, nor are specs. */
    readonly shippingImportersOf: (file: string) => readonly string[];
    /** Blind spots of this tier's graphs. Any means the graph cannot be trusted to be complete. */
    readonly problems: readonly string[];
}

export interface Models {
    readonly web: TierModel;
    readonly mobile: TierModel;
    /**
     * Repo-relative folders of the packages a service or a test tool depends on, derived from the manifests. The web
     * specs and the flows run against a stack built from these, and no import graph of an app sees into them.
     */
    readonly serviceDirs: readonly string[];
    /**
     * Whether the file is test support: it lives where test support lives AND neither graph holds a file that ships
     * and imports it. A path alone never decides it.
     */
    readonly isTestSupport: (file: string) => boolean;
}

const isEmpty = (reached: Reached): boolean => reached.screens.size + reached.tests.size + reached.roots.length === 0;

function impactOf(file: string, models: Models): FileImpact {
    const folder = models.serviceDirs.find((dir) => file.startsWith(`${dir}/`));

    if (folder !== undefined) {
        return {
            kind: 'global',
            reason: `${folder} is used by a service or a test tool, which no app graph sees into`,
        };
    }

    // Test support (a package `testing` export, a `__fixtures__` folder) that no shipped file imports cannot change what
    // a screen does, so it is irrelevant, UNLESS a spec or flow imports it: then the tests that import it are the tests
    // the change affects. The shipping-importer check cannot see that, because it leaves the tests' own importers out.
    const support = models.isTestSupport(file);

    if (support && ![models.web, models.mobile].some((tier) => (tier.reachFile(file)?.tests.size ?? 0) > 0)) {
        return { kind: 'irrelevant' };
    }

    const tiers: Partial<Record<TierName, Reached>> = {};
    const unattributed: TierName[] = [];

    for (const model of [models.web, models.mobile]) {
        const reached = model.reachFile(file);

        if (reached !== undefined) {
            tiers[model.name] = reached;
        } else if (!support && !model.belongsToOtherPlatform(file)) {
            unattributed.push(model.name);
        }
    }

    const useful = Object.values(tiers).some((reached) => !isEmpty(reached));

    return useful ? { kind: 'reaches', tiers, unattributed } : { kind: 'unreached' };
}

/**
 * Plans the end-to-end run for a change.
 *
 * Fails SAFE: a selector that throws returns the full suite with a warning, never an empty plan.
 *
 * @param files - Repo-relative changed files.
 * @param loadModels - Builds the tier models; called only if a file cannot be settled by its path.
 * @param options - `fullSuite` forces everything. `onEmpty` says what no changed files means: `full` (the default)
 * because an empty set looks exactly like a wrong base ref, which must never read as "nothing changed"; `nothing`
 * only against a stamp, where it is the answer (see `onEmptyOf`).
 * @returns The plan.
 */
export async function planChange(
    files: readonly string[],
    loadModels: () => Promise<Models>,
    options: { readonly fullSuite: boolean; readonly onEmpty?: 'full' | 'nothing' },
): Promise<Plan> {
    if (options.fullSuite) {
        return fullPlan('FULL_SUITE=1');
    }

    if (files.length === 0 && (options.onEmpty ?? 'full') === 'full') {
        return fullPlan('no changed files: the base may be wrong');
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
