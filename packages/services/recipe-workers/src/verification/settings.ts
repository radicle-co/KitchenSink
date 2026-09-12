/**
 * THE TWO OPERATOR-CONTROLLED SETTINGS of the verification gate: the ceiling, and the model (ADR-0024 §3).
 *
 * DESIGN PATTERN: **Port + cached Adapter.** {@link createVerificationSettings} is a pure function of a loader
 * — clock injected, cache policy testable — and {@link createSsmSettingsLoader} is the only impure part.
 *
 * ## ⛔ WHY SSM AND NOT THE FUNCTION'S ENVIRONMENT
 *
 * R23 requires the ceiling be CONFIGURABLE, and ADR-0024 says why that matters: "baking it into the function's
 * environment would mean redeploying the worker stack to change it mid-incident". The model id is in SSM for
 * the same reason — the bake-off's entire purpose is to change it, and KTD-4 says outright that the model "ID
 * lives in SSM, never a constant".
 *
 * ## ⚠️ THE 60-SECOND TTL IS AN AMENDMENT TO ADR-0024, AND IT SERVES THE ADR'S OWN PREMISE
 *
 * The ADR says "read at Lambda cold start". Taken literally that is once per container — and with
 * `reservedConcurrency = 1` a container under a runaway never idles out, so the memoised value would be
 * stalest precisely during the incident the parameter exists to let an operator fix. A short TTL costs one
 * free standard-tier `GetParameters` per container per minute and makes "lower the ceiling mid-incident"
 * actually work. Recorded as a departure rather than shipped silently.
 *
 * ## ⛔ THE READ IS LAZY, NOT AT MODULE SCOPE
 *
 * A throw at module scope fails the Lambda INIT phase: no handler ran, so there is no structured log, no EMF
 * metric and no classification — layer 4 is blind while the queue drains to the DLQ. Read on first use inside
 * the handler, and the failure is a classifiable handler error that can log and meter before it throws.
 *
 * ## ⛔ NO DEFAULTS, IN EITHER DIRECTION
 *
 * Defaulting the ceiling HIGH removes the gate; defaulting it LOW denies every call. Defaulting the model id
 * bills a model nobody selected and outlives the very parameter change meant to move it. A misconfigured
 * stage stops, loudly. ⚠️ A ceiling of **zero** is accepted on purpose — it makes the headroom negative for
 * every call, i.e. it is the fastest brake an operator has, and refusing it as "invalid" would take that away.
 */
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';

/** The gate's operator-controlled settings. */
export interface VerificationSettings {
    /** The monthly ceiling, in micro-dollars. Zero is a valid kill switch. */
    readonly ceilingMicros: number;
    /** The Bedrock model id. Must be one the rate table prices, or `planReservation` fails closed. */
    readonly modelId: string;
}

/** Raised when the settings cannot be read or are unusable. Matching guard: {@link isVerificationSettingsError}. */
export class VerificationSettingsError extends Error {
    public constructor(reason: string, cause?: unknown) {
        super(`verification settings unusable: ${reason}`);
        this.name = 'VerificationSettingsError';
        this.cause = cause;
        Object.setPrototypeOf(this, VerificationSettingsError.prototype);
    }
}

/** Type guard for {@link VerificationSettingsError}. */
export function isVerificationSettingsError(error: unknown): error is VerificationSettingsError {
    return error instanceof VerificationSettingsError;
}

/** The raw parameter values, as strings, exactly as SSM returns them. */
export interface RawSettings {
    readonly ceiling?: string | undefined;
    readonly modelId?: string | undefined;
}

/**
 * Turn the two raw parameter strings into settings, or refuse.
 *
 * Pure, so every rejection above is a table test rather than an AWS round trip.
 *
 * @param raw - The parameter values.
 * @returns The parsed settings.
 * @throws {VerificationSettingsError} When either value is absent or unusable.
 */
export function parseSettings(raw: RawSettings): VerificationSettings {
    const modelId = raw.modelId?.trim() ?? '';

    if (modelId === '') {
        throw new VerificationSettingsError('the model id parameter is absent or empty');
    }

    const ceiling = raw.ceiling?.trim() ?? '';

    if (ceiling === '') {
        throw new VerificationSettingsError('the ceiling parameter is absent or empty');
    }

    const ceilingMicros = Number(ceiling);

    if (!Number.isSafeInteger(ceilingMicros) || ceilingMicros < 0) {
        // Fractional micro-dollars are not a thing, and a non-integer would make every headroom comparison a
        // float comparison — the one place this unit deliberately refuses floating point.
        throw new VerificationSettingsError(`the ceiling parameter is not a non-negative integer: ${ceiling}`);
    }

    return { ceilingMicros, modelId };
}

/** How the settings are fetched. Replaced wholesale in tests. */
export type SettingsLoader = () => Promise<VerificationSettings>;

/** A resolver that caches successes for a TTL. */
export interface VerificationSettingsResolver {
    /**
     * The current settings.
     *
     * @returns The settings, from cache when fresh.
     * @throws {VerificationSettingsError} When the underlying read fails. FAIL CLOSED — no call is made.
     * @sideEffect May issue one `GetParameters` request.
     */
    resolve(): Promise<VerificationSettings>;
}

/** Construction options — clock and TTL injected so the cache policy is testable without waiting. */
export interface VerificationSettingsOptions {
    readonly load: SettingsLoader;
    readonly ttlMs: number;
    readonly now: () => number;
}

/**
 * Wrap a loader in a TTL cache with single-flight.
 *
 * ⛔ ONLY SUCCESSES ARE CACHED. A cached failure would poison the container for a whole TTL after a
 * one-second SSM blip, turning a transient fault into a minute of denied verification per container.
 *
 * Single-flight matters less at `reservedConcurrency = 1` and is included anyway: the tier-4 rewrite shares
 * this module, and ADR-0024 explicitly allows the concurrency constant to be raised for throughput — at which
 * point every TTL expiry would otherwise become a stampede of `GetParameters` calls for one value.
 *
 * @param options - Loader, TTL and clock.
 * @returns The resolver.
 */
export function createVerificationSettings(options: VerificationSettingsOptions): VerificationSettingsResolver {
    let cached: { readonly value: VerificationSettings; readonly readAt: number } | undefined;
    let inFlight: Promise<VerificationSettings> | undefined;

    return {
        async resolve(): Promise<VerificationSettings> {
            if (cached !== undefined && options.now() - cached.readAt < options.ttlMs) {
                return cached.value;
            }

            inFlight ??= options
                .load()
                .then((value) => {
                    cached = { value, readAt: options.now() };

                    return value;
                })
                .catch((cause: unknown) => {
                    // ⛔ EVERY failure leaves here as the SAME type. The handler's one job on this path is
                    // "fail closed and retry", and it must not have to know which loader it was constructed
                    // with to recognise that — an unwrapped SDK error would fall through its `catch` and be
                    // classified as an unexpected fault, which is a different (and louder) outcome.
                    throw isVerificationSettingsError(cause)
                        ? cause
                        : new VerificationSettingsError('the settings loader failed', cause);
                })
                .finally(() => {
                    inFlight = undefined;
                });

            return inFlight;
        },
    };
}

/** Where the two parameters live, per stage. */
export interface SsmSettingsConfig {
    readonly stage: string;
    readonly region: string;
}

/** The SSM parameter name holding the ceiling, in micro-dollars. */
export const ceilingParameterName = (stage: string): string =>
    `/kitchensink/${stage}/recipe/verification-ceiling-micros`;

/** The SSM parameter name holding the Bedrock model id. */
export const modelParameterName = (stage: string): string => `/kitchensink/${stage}/recipe/verification-model-id`;

/**
 * The real loader: ONE `GetParameters` call for both names.
 *
 * One request rather than two, so there is one round trip, one failure mode and one thing for IAM to scope.
 *
 * @param config - Stage and region.
 * @returns The loader.
 * @sideEffect Issues an SSM `GetParameters` request.
 */
export function createSsmSettingsLoader(config: SsmSettingsConfig): SettingsLoader {
    const client = new SSMClient({ region: config.region });
    const ceilingName = ceilingParameterName(config.stage);
    const modelName = modelParameterName(config.stage);

    return async (): Promise<VerificationSettings> => {
        let values: Record<string, string>;

        try {
            const response = await client.send(new GetParametersCommand({ Names: [ceilingName, modelName] }));

            values = Object.fromEntries(
                (response.Parameters ?? []).map((parameter) => [parameter.Name ?? '', parameter.Value ?? '']),
            );
        } catch (cause) {
            throw new VerificationSettingsError('the parameter store could not be read', cause);
        }

        // `GetParameters` puts unknown names in `InvalidParameters` and returns 200, so an absent parameter is
        // a SUCCESSFUL response with a missing key — not an error. `parseSettings` is what refuses it.
        return parseSettings({ ceiling: values[ceilingName], modelId: values[modelName] });
    };
}
