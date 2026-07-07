import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { z } from 'zod';

import { type Environment, type LoadConfigOptions, ssmConfigSchema } from './config.types.js';

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
 * Whether the second argument is a {@link LoadConfigOptions} object rather than a raw env-var source.
 * SSM-related keys never appear as environment-variable names (which are UPPER_SNAKE), so their
 * presence unambiguously selects the async SSM-capable path. Pure.
 */
function isLoadConfigOptions(value: unknown): value is LoadConfigOptions {
    return (
        typeof value === 'object' &&
        value !== null &&
        ('ssmFallback' in value || 'ssm' in value || 'environment' in value)
    );
}

/** Parse `env` against `schema`, throwing an aggregated {@link ConfigValidationError} on failure. Pure. */
function parseOrThrow<Schema extends z.ZodTypeAny>(schema: Schema, env: Record<string, unknown>): z.infer<Schema> {
    const result = schema.safeParse(env);

    if (!result.success) {
        throw new ConfigValidationError(result.error);
    }

    return result.data;
}

/** The unique top-level keys implicated by a Zod validation error (the vars to try to backfill). Pure. */
function missingKeysFromError(error: z.ZodError): string[] {
    const keys = new Set<string>();

    for (const issue of error.issues) {
        const [first] = issue.path;

        if (typeof first === 'string' && first.length > 0) {
            keys.add(first);
        }
    }

    return [...keys];
}

/**
 * Fetch the given keys from SSM Parameter Store at `/{prefix}/{environment}/{KEY}`, returning a map of
 * the resolved (env-var-name → value) pairs. Keys with no matching parameter are simply absent from
 * the result (the re-validation then reports them as still-missing).
 *
 * @sideEffect Performs a single `GetParameters` network call against AWS SSM.
 */
async function fetchFromSsm(
    keys: string[],
    ssm: z.infer<typeof ssmConfigSchema>,
    environment: string,
): Promise<Record<string, string>> {
    if (keys.length === 0) {
        return {};
    }

    const client = new SSMClient({ region: ssm.region });
    const nameForKey = (key: string): string => `${ssm.prefix}/${environment}/${key}`;

    const response = await client.send(
        new GetParametersCommand({
            Names: keys.map(nameForKey),
            WithDecryption: ssm.withDecryption,
        }),
    );

    const resolved: Record<string, string> = {};

    for (const parameter of response.Parameters ?? []) {
        const key = parameter.Name?.split('/').pop();

        if (key !== undefined && key.length > 0 && parameter.Value !== undefined) {
            resolved[key] = parameter.Value;
        }
    }

    return resolved;
}

/**
 * Async loader implementing the {@link LoadConfigOptions} contract: validate `process.env` and, when
 * `ssmFallback` is enabled, backfill any missing required vars from SSM before re-validating.
 *
 * @sideEffect Reads `process.env`; may perform a single SSM `GetParameters` call.
 */
async function loadConfigAsync<Schema extends z.ZodTypeAny>(
    schema: Schema,
    options: LoadConfigOptions,
): Promise<z.infer<Schema>> {
    const env: Record<string, unknown> = { ...process.env };
    const first = schema.safeParse(env);

    if (first.success) {
        return first.data;
    }

    // Without SSM fallback there is nothing more to try — fail fast with the aggregated error.
    if (!options.ssmFallback) {
        throw new ConfigValidationError(first.error);
    }

    const ssm = ssmConfigSchema.parse(options.ssm ?? {});
    const environment: Environment | string = options.environment ?? (env['NODE_ENV'] as string | undefined) ?? 'development';
    const fetched = await fetchFromSsm(missingKeysFromError(first.error), ssm, environment);

    return parseOrThrow(schema, { ...env, ...fetched });
}

/**
 * Validate a source of environment variables against a Zod config schema, returning the parsed, typed
 * config.
 *
 * Two shapes, distinguished by the second argument:
 * - `loadConfig(schema, env?)` — **synchronous** validation of an explicit env source (defaults to
 *   `process.env`). This is the primary boot-time path; any missing/invalid value fails fast with an
 *   aggregated {@link ConfigValidationError}.
 * - `loadConfig(schema, options)` — **async** validation of `process.env` with an optional SSM
 *   fallback (per {@link LoadConfigOptions}): a required var absent from the environment is resolved
 *   from AWS SSM Parameter Store at `/{prefix}/{environment}/{KEY}` before re-validation.
 *
 * Accepts any `ZodType` (not just `ZodObject`) so composite schemas built with `.and()` — such as
 * {@link import('./config.types.js').apiConfigSchema}, whose either/or DB-connection union makes it a
 * `ZodIntersection` — are supported.
 *
 * @sideEffect Reads `process.env` when no explicit source is provided; the options form may perform a
 *   single SSM `GetParameters` call.
 */
export function loadConfig<Schema extends z.ZodTypeAny>(schema: Schema, options: LoadConfigOptions): Promise<z.infer<Schema>>;

export function loadConfig<Schema extends z.ZodTypeAny>(schema: Schema, env?: Record<string, unknown>): z.infer<Schema>;

export function loadConfig<Schema extends z.ZodTypeAny>(
    schema: Schema,
    source?: Record<string, unknown> | LoadConfigOptions,
): z.infer<Schema> | Promise<z.infer<Schema>> {
    if (isLoadConfigOptions(source)) {
        return loadConfigAsync(schema, source);
    }

    return parseOrThrow(schema, source ?? process.env);
}
