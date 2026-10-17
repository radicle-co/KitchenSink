/**
 * The stages the remote search service is deployed at: `prod`, and a copy per pull request (`pr-{N}`), the same two
 * kinds food-service has. Food reads the search service at its own stage, so a stage food never runs at (`sandbox`,
 * `dev`, `local`) has no reader and is refused here, before anything is built.
 *
 * @pattern Parser — an untrusted CDK context or environment value in, a typed stage out
 * @module
 */

/** A per-pull-request preview stage. */
export type PreviewStage = `pr-${number}`;

/** A stage the service is deployed at. */
export type RemoteSearchStage = 'prod' | PreviewStage;

/** The persistent platform tier a stage rides (ADR-0006): prod rides prod, a preview rides sandbox. */
export type BaseStage = 'prod' | 'sandbox';

/** `pr-` and a pull request number, with no leading zero. */
const PREVIEW_STAGE = /^pr-[1-9][0-9]*$/u;

/**
 * Whether a value is a preview stage. Pure.
 *
 * @param value - Any value.
 * @returns True for `pr-{N}`.
 */
export function isPreviewStage(value: unknown): value is PreviewStage {
    return typeof value === 'string' && PREVIEW_STAGE.test(value);
}

/**
 * Parse the stage a deploy was asked for. Pure.
 *
 * @param raw - The `stage` context or `STAGE` value, as given.
 * @returns The stage.
 * @throws {Error} naming the value and the stages that exist, for any other value.
 */
export function parseRemoteSearchStage(raw: unknown): RemoteSearchStage {
    if (raw === 'prod' || isPreviewStage(raw)) {
        return raw;
    }

    throw new Error(
        `Refusing to synthesize the remote search service at stage ${JSON.stringify(raw) ?? 'undefined'}: it is ` +
            'deployed at prod and at a pull request preview (pr-{N}) only, the stages food-service reads it from.',
    );
}

/**
 * The platform tier a stage rides. Pure.
 *
 * @param stage - The stage.
 * @returns `prod` for prod, `sandbox` for a preview.
 */
export function baseStageOf(stage: RemoteSearchStage): BaseStage {
    return stage === 'prod' ? 'prod' : 'sandbox';
}
