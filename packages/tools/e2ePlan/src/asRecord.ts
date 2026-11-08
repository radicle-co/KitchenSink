/**
 * Reads an unknown value as a record of unknown values.
 *
 * @param value - Anything parsed from JSON or YAML.
 * @returns The value when it is a plain object, else an empty record. An array is not a record: its keys are indexes.
 */
export const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : {};
