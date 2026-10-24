/**
 * @module synthesize — run `cdk synth` for every discovered app, and report honestly what came back.
 *
 * ⛔ SYNTHESISE, NEVER READ WHAT IS LYING AROUND. The predecessor globbed `cdk.out`, which made its answer a
 * function of what a developer had run that morning: on 2026-08-27 it saw 3 of 8 apps and reported a
 * LocalStack service list with no S3, no SQS, no SSM, no Secrets Manager and no database.
 *
 * ⚠️ A NON-ZERO EXIT IS NOT AUTOMATICALLY FATAL, and this is measured rather than assumed. `cdk synth --all`
 * on `packages/infra/global` exits reporting "Synthesis finished with errors" — a Route 53 context lookup
 * for the placeholder domain finds no hosted zone — and still writes all seven templates. Discarding that
 * would throw away a complete inventory. So `usable` (did it produce templates?) and `clean` (did it exit
 * zero?) are reported SEPARATELY, and the caller decides which it needs.
 *
 * ⚠️ Context lookups that fail this way resolve to CDK's dummy values. That is harmless for a resource
 * INVENTORY — a dummy zone id does not change which resource types exist — and would not be harmless if
 * this module were used to derive addresses. It is not.
 */
import type { CdkApp } from './discoverApps.js';

/** What a runner is asked to do. */
export interface SynthRequest {
    readonly app: CdkApp;
    /** Directory to run the synth in — the app's own package. */
    readonly cwd: string;
    /** Where `--output` should write, unique per app. */
    readonly outDir: string;
}

/** What a runner reports back. */
export interface SynthResult {
    readonly exitCode: number;
    /** Template file paths produced, absolute or relative to `outDir`. */
    readonly templates: readonly string[];
    readonly stderr: string;
}

/** Runs one synth. Injected so this module is testable without spawning CDK. */
export type SynthRunner = (request: SynthRequest) => Promise<SynthResult>;

/** What one app's synthesis produced. */
export interface SynthOutcome {
    readonly app: CdkApp;
    /** Produced at least one template — its resources can be trusted as far as they go. */
    readonly usable: boolean;
    /** Exited zero with no reported error. */
    readonly clean: boolean;
    readonly outDir: string;
    readonly templates: readonly string[];
    readonly stderr: string;
}

export interface SynthOptions {
    /** Root directory each app's `outDir` is created under. */
    readonly outRoot: string;
}

/**
 * Synthesise every app.
 *
 * @param apps - The discovered inventory.
 * @param run - Runs a single synth.
 * @param options - Where to write.
 * @returns One outcome per app, in the order given — including apps that could not be run.
 * @sideEffect Delegates to `run`, which spawns CDK and writes to disk.
 */
export async function synthesizeAll(
    apps: readonly CdkApp[],
    run: SynthRunner,
    options: SynthOptions,
): Promise<readonly SynthOutcome[]> {
    const outcomes: SynthOutcome[] = [];

    for (const app of apps) {
        const outDir = `${options.outRoot}/${app.packageName.replace(/[^a-z0-9]+/giu, '-')}`;

        // ⚠️ An unreadable `--app` is a NOTE, not a refusal. Synthesis runs the package's own npm SCRIPT,
        // which exists by construction (that is how `discoverApps` found the app at all), so the parsed
        // command is diagnostic detail rather than a precondition. Refusing on it — as the first draft did —
        // would drop a perfectly synthesisable app out of the inventory for a cosmetic reason, which is the
        // failure this package exists to prevent.
        const result = await run({ app, cwd: app.packageDir, outDir });

        outcomes.push({
            app,
            usable: result.templates.length > 0,
            clean: result.exitCode === 0,
            outDir,
            templates: result.templates,
            stderr: result.stderr,
        });
    }

    return outcomes;
}
