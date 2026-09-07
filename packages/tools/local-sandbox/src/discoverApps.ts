/**
 * @module discoverApps — which CDK apps exist, derived from the repo's own statement of how to synth them.
 *
 * ⛔ THE INVENTORY IS THE `cdk synth` SCRIPTS, NOT A GLOB OF `cdk.out`. The first version of this package
 * read whatever synthesised templates happened to be on disk. On 2026-08-27 that meant **3 templates**
 * — three prod service stacks left in `./cdk.out` by an unrelated `cdk synth` hours earlier — from which it
 * reported `SERVICES=events,lambda,logs,sns` and no database. Synthesising the global app alone yields 95
 * resources including the RDS instance, both queues, both buckets, both secrets and the DynamoDB table.
 *
 * The failure mode was the worst kind available: not a refusal, but a confident paste-able answer that was
 * mostly wrong, and silently dependent on what someone had run that morning.
 *
 * ⚠️ Scripts rather than `infra/bin/app.ts` files, because the file says an app EXISTS while the script says
 * how to RUN it — and in this repo those differ on purpose. Some apps synth through `npx tsx`, some run as
 * compiled `node dist/bin/app.js` (ADR-0013), and some prepend a Lambda bundle step. Copying the invocation
 * into this package would be a second representation of it; reading the script is not.
 */

/** A package manifest, reduced to what this module reads. */
export interface PackageManifest {
    /** Directory the manifest was read from, repo-relative. */
    readonly dir: string;
    /** The parsed `package.json`. */
    readonly json: {
        readonly name?: unknown;
        readonly scripts?: Readonly<Record<string, unknown>> | undefined;
        /** This repo's per-package markers; see {@link CdkApp.localSynthSkip}. */
        readonly kitchensink?: unknown;
    };
}

/** One CDK app the repo knows how to synthesise. */
export interface CdkApp {
    /** Workspace package name. */
    readonly packageName: string;
    /** Repo-relative directory the synth command must run in. */
    readonly packageDir: string;
    /** The npm script that synthesises it. */
    readonly script: string;
    /**
     * The `--app` argument, verbatim.
     *
     * ⚠️ `undefined` when the script runs `cdk synth` but its `--app` could not be read. That is REPORTED,
     * never dropped: an app silently leaving the inventory is the exact defect this module replaces.
     */
    readonly appCommand: string | undefined;
    /**
     * The reason this app's manifest gives for leaving it out of a LOCAL synth, or `undefined`.
     *
     * ⛔ The ONE sanctioned way out of the local inventory, and it is a DECLARATION rather than an inference.
     * `up.ts` refuses to start when an app does not synthesise — "a hole in the inventory is
     * indistinguishable from 'that infrastructure does not exist'" — and that refusal must stay. What it
     * cannot express is an app whose synth needs a toolchain a local sandbox has no business requiring:
     * `ingredient-parser`'s `infra:synth` runs `bundle:lambda` first, which pip-installs ~90 MB of arm64
     * wheels (ADR-0025), so a developer with no python3, no pip or no network could not start the sandbox
     * AT ALL once that step was wired in.
     *
     * ⚠️ A declared skip is not a swallowed failure. Any OTHER synth failure still refuses the run, and
     * `up.ts` prints every skip under "what is NOT covered" beside `localSupport.ts`'s `unsupported` entries
     * — the same distinction that file draws between a stated non-coverage and a gap.
     */
    readonly localSynthSkip: string | undefined;
}

/** `--app '<command>'`, single- or double-quoted as the scripts in this repo spell it. */
const APP_ARGUMENT = /--app\s+(?:'([^']+)'|"([^"]+)")/u;

/**
 * Read the local-sandbox skip a manifest declares.
 *
 * @param json - The parsed manifest.
 * @returns The reason, or `undefined` when the package declares none. Pure.
 * @throws When a skip is declared with a blank reason — "skipped" and "forgotten" must never look the same.
 */
function localSynthSkipOf(json: PackageManifest['json']): string | undefined {
    const marker = (json.kitchensink as { localSandbox?: { skipSynth?: unknown } } | undefined)?.localSandbox;
    const reason = marker?.skipSynth;

    if (reason === undefined) {
        return undefined;
    }

    if (typeof reason !== 'string' || reason.trim() === '') {
        throw new Error(
            `${String(json.name)}: kitchensink.localSandbox.skipSynth must carry a REASON. An app leaving the ` +
                'local inventory without one is indistinguishable from an app nobody noticed was missing.',
        );
    }

    return reason;
}

/**
 * Derive the CDK app inventory from package manifests.
 *
 * @param manifests - Every workspace manifest, already read.
 * @returns One entry per app, sorted by package name so the output is stable to diff. Pure.
 */
export function discoverApps(manifests: readonly PackageManifest[]): readonly CdkApp[] {
    return manifests
        .flatMap((manifest) => {
            const { name, scripts } = manifest.json;

            if (typeof name !== 'string' || scripts === undefined) {
                return [];
            }

            // The FIRST synth script wins. Two is a repo smell; insertion order at least makes the choice
            // reproducible rather than arbitrary.
            const entry = Object.entries(scripts).find(
                ([, command]) => typeof command === 'string' && command.includes('cdk synth'),
            );

            if (entry === undefined) {
                return [];
            }

            const [script, command] = entry as [string, string];
            const matched = APP_ARGUMENT.exec(command);

            return [
                {
                    packageName: name,
                    packageDir: manifest.dir,
                    script,
                    appCommand: matched?.[1] ?? matched?.[2],
                    localSynthSkip: localSynthSkipOf(manifest.json),
                },
            ];
        })
        .sort((left, right) => left.packageName.localeCompare(right.packageName));
}

/** One app held back from a local synth, with the reason its manifest gave. */
export interface SkippedApp {
    readonly packageName: string;
    readonly reason: string;
}

/** The apps to synthesise locally, and the ones deliberately held back. */
export interface LocalSynthPartition {
    readonly synthesise: readonly CdkApp[];
    readonly skipped: readonly SkippedApp[];
}

/** How to partition. */
export interface LocalSynthOptions {
    /**
     * Synthesise everything, declared skips included — `LOCAL_SANDBOX_SYNTH_ALL=1`.
     *
     * ⚠️ The opt-in is what keeps a skip an ergonomic default rather than a permanent blind spot: a
     * developer who HAS the toolchain can always ask for the complete inventory.
     */
    readonly includeAll: boolean;
}

/**
 * Split the inventory into what a local run will synthesise and what it deliberately will not.
 *
 * @param apps - Every app the repo declares.
 * @param options - Whether to override the declared skips.
 * @returns The partition, both halves in the input's (package-name) order. Pure.
 */
export function partitionForLocalSynth(apps: readonly CdkApp[], options: LocalSynthOptions): LocalSynthPartition {
    if (options.includeAll) {
        return { synthesise: apps, skipped: [] };
    }

    return {
        synthesise: apps.filter((app) => app.localSynthSkip === undefined),
        skipped: apps.flatMap((app) =>
            app.localSynthSkip === undefined ? [] : [{ packageName: app.packageName, reason: app.localSynthSkip }],
        ),
    };
}
