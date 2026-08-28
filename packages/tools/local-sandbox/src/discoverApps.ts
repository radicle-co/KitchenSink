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
}

/** `--app '<command>'`, single- or double-quoted as the scripts in this repo spell it. */
const APP_ARGUMENT = /--app\s+(?:'([^']+)'|"([^"]+)")/u;

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
                },
            ];
        })
        .sort((left, right) => left.packageName.localeCompare(right.packageName));
}
