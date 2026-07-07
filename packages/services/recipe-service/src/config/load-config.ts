import { z } from 'zod';

/**
 * Thrown when `process.env` fails validation against a config schema. Aggregates **all** Zod issues
 * into a single message so a boot-time misconfiguration surfaces every missing/invalid value at once
 * rather than one-at-a-time.
 */
export class ConfigValidationError extends Error {
    public readonly issues: z.ZodError['issues'];

    constructor(error: z.ZodError) {
        const summary = error.issues
            .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n');
        super(`Invalid recipe-service configuration:\n${summary}`);
        this.name = 'ConfigValidationError';
        this.issues = error.issues;
        Object.setPrototypeOf(this, ConfigValidationError.prototype);
    }
}

/** Type guard for {@link ConfigValidationError}. */
export function isConfigValidationError(error: unknown): error is ConfigValidationError {
    return error instanceof ConfigValidationError;
}

/**
 * Validate a source of environment variables against a Zod config schema, returning the parsed,
 * typed config. Defaults to `process.env`; the whole environment is checked up front so any
 * missing/invalid value fails fast with an aggregated {@link ConfigValidationError}.
 *
 * Accepts any `ZodType` (not just `ZodObject`) so composite schemas built with `.and()` — such as
 * {@link import('./config.types.js').apiConfigSchema}, whose either/or DB-connection union makes it a
 * `ZodIntersection` — are supported.
 *
 * @sideEffect Reads `process.env` when no explicit source is provided.
 */
export function loadConfig<Schema extends z.ZodTypeAny>(
    schema: Schema,
    env: Record<string, unknown> = process.env,
): z.infer<Schema> {
    const result = schema.safeParse(env);

    if (!result.success) {
        throw new ConfigValidationError(result.error);
    }

    return result.data;
}
