/**
 * @module json — the JSON value type and the two narrowing helpers every reader of a template or a policy document in
 * this package shares, so each module does not restate them.
 */

/** A parsed JSON/YAML value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A JSON object. */
export type JsonObject = { [key: string]: Json };

/**
 * Whether a value is a JSON object (not null, not an array).
 *
 * @returns The narrowing. Pure.
 */
export const isRecord = (value: unknown): value is JsonObject =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A field that CloudFormation and IAM accept as one value or a list, as a list: a list stays, a single value is
 * wrapped, an absent field is empty.
 *
 * @returns The list. Pure.
 */
export const toList = (value: Json | undefined): Json[] => {
    if (Array.isArray(value)) {
        return value;
    }

    return value === undefined ? [] : [value];
};
