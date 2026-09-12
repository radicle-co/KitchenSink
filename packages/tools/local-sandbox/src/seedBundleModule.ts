/**
 * @module seedBundleModule — the contract `local:up` holds a catalog seed bundle to (curated catalog plan U7).
 *
 * `local:up` imports the seed function's own bundle from the synthesized asset and drives its core over a password
 * connection, because this package can import neither food-service's source nor `pg`. The bundle is code this package
 * did not build, so what it exports is read here rather than assumed.
 *
 * @pattern Adapter — a dynamically imported module onto a typed port
 */

/** A password connection to the local database. */
export interface LocalSeedConnection {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database: string;
}

/** Where a bundle and its database are. */
export interface LocalSeedTarget {
    readonly connection: LocalSeedConnection;
    /** The asset root: `<outDir>/asset.<hash>/`. */
    readonly bundleDir: string;
}

/** The two digests `describeSeedBundle` answers. */
export interface LocalSeedDescription {
    readonly assetSha: string;
    /** `null` for a database never seeded. */
    readonly ledgerSha: string | null;
}

/** What `applySeedBundle` answers, narrowed to what `local:up` reports. */
export interface LocalSeedApplied {
    readonly outcome: string;
    readonly changes: number;
}

/** The two calls the seed bundle's handler module exports for a caller with its own connection. */
export interface SeedBundleModule {
    readonly describeSeedBundle: (target: LocalSeedTarget) => Promise<LocalSeedDescription>;
    readonly applySeedBundle: (
        options: LocalSeedTarget & {
            readonly expectSeedSha: string;
            readonly log: (message: string, attributes: Readonly<Record<string, unknown>>) => void;
        },
    ) => Promise<LocalSeedApplied>;
}

/**
 * Read a value's own fields, or none for a value that is not an object.
 *
 * @param value - Anything.
 * @returns Its fields. Pure.
 */
function fieldsOf(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
}

/**
 * Narrow an export to a one-argument function. `typeof` proves only that it is callable; what it returns is parsed.
 *
 * @param value - The export.
 * @returns `true` for a function. Pure.
 */
function isCallable(value: unknown): value is (argument: unknown) => unknown {
    return typeof value === 'function';
}

/**
 * Parse what `describeSeedBundle` answered.
 *
 * @param value - The answer.
 * @returns The two digests.
 * @throws {Error} for any other shape. Pure.
 */
function parseDescription(value: unknown): LocalSeedDescription {
    const { assetSha, ledgerSha } = fieldsOf(value);

    if (typeof assetSha !== 'string' || (ledgerSha !== null && typeof ledgerSha !== 'string')) {
        throw new Error(`describeSeedBundle answered an unexpected shape: ${JSON.stringify(value)}`);
    }

    return { assetSha, ledgerSha };
}

/**
 * Parse what `applySeedBundle` answered.
 *
 * @param value - The answer.
 * @returns The outcome and the change count.
 * @throws {Error} for any other shape. Pure.
 */
function parseApplied(value: unknown): LocalSeedApplied {
    const { outcome, changes } = fieldsOf(value);

    if (typeof outcome !== 'string' || typeof changes !== 'number') {
        throw new Error(`applySeedBundle answered an unexpected shape: ${JSON.stringify(value)}`);
    }

    return { outcome, changes };
}

/**
 * Read the two calls out of an imported seed bundle module.
 *
 * @param modulePath - The module's path, for the message.
 * @param value - What `import()` returned.
 * @returns The two calls, each parsing what the bundle answers.
 * @throws {Error} naming the module and the first export that is missing or not a function.
 */
export function readSeedBundleModule(modulePath: string, value: unknown): SeedBundleModule {
    const refuse = (name: string): Error =>
        new Error(
            `${modulePath} does not export ${name} as a function, so local:up cannot seed the catalog with it. ` +
                'The seed handler re-exports its core for exactly this caller; restore that export.',
        );
    const { describeSeedBundle, applySeedBundle } = fieldsOf(value);

    if (!isCallable(describeSeedBundle)) {
        throw refuse('describeSeedBundle');
    }

    if (!isCallable(applySeedBundle)) {
        throw refuse('applySeedBundle');
    }

    return {
        describeSeedBundle: async (target) => parseDescription(await describeSeedBundle(target)),
        applySeedBundle: async (options) => parseApplied(await applySeedBundle(options)),
    };
}
