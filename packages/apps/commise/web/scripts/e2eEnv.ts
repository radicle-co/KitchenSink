/**
 * The environment the local Playwright door reads, and the two numbers in it that a person sets.
 *
 * A bad value stops the run with a message naming the variable. `Number('abc')` is NaN, and a NaN lane count or stagger
 * would fail far from its cause, or read as "no limit".
 */
import type { Env } from '@kitchensink/e2e-plan/stampRun';

/** An unset variable and an empty one both mean "not given": a shell or a workflow that exports `X=` did not choose a value. */
const given = (env: Env, name: string): string | undefined => {
    const value = env[name];

    return value === undefined || value === '' ? undefined : value;
};

/**
 * `E2E_LANES`: how many lanes the caller asks for. The planner may give fewer.
 *
 * @param env - The caller's environment.
 * @returns A positive whole number, or undefined when not given.
 * @throws When the value is anything else.
 */
export function parseLaneRequest(env: Env): number | undefined {
    const text = given(env, 'E2E_LANES');

    if (text === undefined) {
        return undefined;
    }

    if (!/^[1-9]\d*$/u.test(text)) {
        throw new Error(`error: E2E_LANES must be a positive whole number, got ${JSON.stringify(text)}`);
    }

    return Number(text);
}

/** The gap between lane starts that keeps them from signing in to Clerk at once. */
const DEFAULT_STAGGER_SECONDS = 3;

/**
 * `E2E_LANE_STAGGER_SECONDS`: the gap between one lane starting and the next.
 *
 * @param env - The caller's environment.
 * @returns Seconds, zero or more; 3 when not given.
 * @throws When the value is not a plain non-negative number.
 */
export function parseStaggerSeconds(env: Env): number {
    const text = given(env, 'E2E_LANE_STAGGER_SECONDS');

    if (text === undefined) {
        return DEFAULT_STAGGER_SECONDS;
    }

    const seconds = /^\d+(?:\.\d+)?$/u.test(text) ? Number(text) : Number.NaN;

    if (!Number.isFinite(seconds)) {
        throw new Error(
            `error: E2E_LANE_STAGGER_SECONDS must be a number of seconds, zero or more, got ${JSON.stringify(text)}`,
        );
    }

    return seconds;
}
