/**
 * The local stack's facts, read from their one home. `localMaestro.sh` states the AVD, the service origins, the LocalStack
 * address and the service process patterns, and `local_maestro_settings` prints them as `KEY=value` lines. This module
 * parses that output at the boundary, so the lane TypeScript holds none of the values (lead decision 3, 2026-11-08;
 * `bin/__tests__/localSettings.test.ts` holds both sides equal and refuses a copied literal).
 *
 * @pattern Parser — zod at the bash boundary, the "parse, don't validate" shape
 */
import { z } from 'zod';

export interface LocalSettings {
    readonly avd: string;
    /** The origins the app is built with: what the DEVICE addresses, on loopback. */
    readonly recipeOrigin: string;
    readonly identityOrigin: string;
    readonly foodOrigin: string;
    readonly localstack: string;
    /** The parse worker's command line, as `pgrep -f` matches it. */
    readonly workerPattern: RegExp;
    /** A queue consumer's command line, as `pgrep -f` matches it. */
    consumerPattern(name: string): RegExp;
}

const compiles = (source: string): boolean => {
    try {
        new RegExp(source, 'u');

        return true;
    } catch {
        return false;
    }
};

/** A pattern both `pgrep -f` (ERE) and a JS RegExp read; it must compile here. */
const pattern = z.string().refine(compiles, { message: 'is not a pattern' });

/** A consumer pattern: it has a `{name}` slot, and compiles once a name fills it (a bare `{` does not compile). */
const consumerPattern = z
    .string()
    .refine((source) => source.includes('{name}'), { message: 'has no {name} slot' })
    .refine((source) => compiles(source.replace('{name}', 'name')), { message: 'is not a pattern' });

/** An HTTP origin. A bare `z.url()` reads `localhost:3001` as a URL whose scheme is `localhost:`. */
const origin = z.url({ protocol: /^https?$/u });

const schema = z
    .object({
        LOCAL_MAESTRO_AVD: z.string().min(1),
        LOCAL_MAESTRO_RECIPE_ORIGIN: origin,
        LOCAL_MAESTRO_IDENTITY_ORIGIN: origin,
        LOCAL_MAESTRO_FOOD_ORIGIN: origin,
        LOCAL_MAESTRO_LOCALSTACK: origin,
        LOCAL_MAESTRO_WORKER_PATTERN: pattern,
        LOCAL_MAESTRO_CONSUMER_PATTERN: consumerPattern,
    })
    .strict();

/**
 * Parse `local_maestro_settings`' output.
 *
 * @param text - `KEY=value` lines; a value runs to the end of its line.
 * @returns The settings.
 * @throws When a line is not `KEY=value`, a key repeats, a fact is missing or unknown, or a value does not parse.
 */
export function parseLocalSettings(text: string): LocalSettings {
    const entries = new Map<string, string>();

    for (const line of text.split('\n').filter((entry) => entry !== '')) {
        const equals = line.indexOf('=');

        if (equals <= 0) {
            throw new Error(`local_maestro_settings printed a line that is not KEY=value: '${line}'`);
        }

        const key = line.slice(0, equals);

        if (entries.has(key)) {
            throw new Error(`local_maestro_settings printed ${key} twice`);
        }

        entries.set(key, line.slice(equals + 1));
    }

    const parsed = schema.safeParse(Object.fromEntries(entries));

    if (!parsed.success) {
        throw new Error(`local_maestro_settings did not parse: ${z.prettifyError(parsed.error)}`);
    }

    const facts = parsed.data;

    return {
        avd: facts.LOCAL_MAESTRO_AVD,
        recipeOrigin: facts.LOCAL_MAESTRO_RECIPE_ORIGIN,
        identityOrigin: facts.LOCAL_MAESTRO_IDENTITY_ORIGIN,
        foodOrigin: facts.LOCAL_MAESTRO_FOOD_ORIGIN,
        localstack: facts.LOCAL_MAESTRO_LOCALSTACK,
        workerPattern: new RegExp(facts.LOCAL_MAESTRO_WORKER_PATTERN, 'u'),
        // A consumer name comes from the stack's plan; anything but a word character or a hyphen is dropped so the name
        // cannot change the pattern around it.
        consumerPattern: (name) =>
            new RegExp(facts.LOCAL_MAESTRO_CONSUMER_PATTERN.replace('{name}', name.replace(/[^\w-]/gu, '')), 'u'),
    };
}
