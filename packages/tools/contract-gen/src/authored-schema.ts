/**
 * DISCOVERY AND FINGERPRINTING of a service's authored wire schemas (`docs/CODING_STANDARDS.md` §15.2).
 *
 * The discovery rule is deliberately blunt — **every `src/**\/*.schema.ts` under the service is wire
 * contract** — because the alternative (an opt-in list of directories or a marker comment) is a rule a
 * contributor adding an endpoint can forget, and a forgotten schema is an unpublished contract that every
 * client then compiles against its own belief of. A blunt rule cannot be forgotten.
 *
 * The one relief valve is {@link SchemaDiscoveryOptions.excludeFiles}: EXACT relative paths, each carrying the
 * reason it is not wire contract. Exact paths rather than directory prefixes on purpose — excluding
 * `src/config/` would silently swallow a future wire schema that happened to live there, whereas excluding
 * `src/config/env.schema.ts` swallows precisely that one file and nothing else. Both services need it for the
 * same reason: their environment-variable schema is a genuine zod `*.schema.ts` that describes the process's
 * configuration, not its API, and publishing it would put the service's env-var inventory (and its churn)
 * into a package that web and mobile depend on.
 */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import type { ComposedSource } from './composed-sources.js';

/** Directory names never walked: tests and fixtures do not define the wire contract, and build output is not source. */
const SKIPPED_DIRECTORIES: readonly string[] = ['__tests__', '__fixtures__', '__testing__', 'node_modules', 'dist'];

/** One authored schema module: where it came from, what it is called in the leaf package, and its text. */
export interface AuthoredSchema {
    /** Path relative to the service root, POSIX-separated, e.g. `src/foods/foods.schema.ts`. */
    readonly servicePath: string;
    /** Flat module basename in the generated package, e.g. `foods.schema`. */
    readonly moduleName: string;
    /** Verbatim source text. */
    readonly source: string;
}

/** An authored `*.schema.ts` that is deliberately NOT part of the wire contract. */
export interface SchemaExclusion {
    /** Exact path relative to the service root, POSIX-separated. Matched by equality, never by prefix. */
    readonly servicePath: string;
    /** Why this file is not wire contract. Required, so the exclusion stays a reviewed decision. */
    readonly why: string;
}

/** Options for {@link discoverAuthoredSchemas}. */
export interface SchemaDiscoveryOptions {
    /** Exact-path exclusions. Anything not listed here is treated as wire contract. */
    readonly excludeFiles?: readonly SchemaExclusion[];
}

/**
 * Whether a directory entry name should be walked during discovery.
 *
 * @param name - The directory's own name (not a path).
 * @returns True when the walk should descend into it. Pure.
 */
export function isWalkableDirectory(name: string): boolean {
    return !SKIPPED_DIRECTORIES.includes(name);
}

/**
 * Whether a file name is an authored schema module.
 *
 * Excludes `*.schema.test.ts` explicitly: a test FOR a schema is not itself a schema, and copying one into
 * the leaf package would publish `vitest` imports to web and mobile.
 *
 * @param name - The file's own name (not a path).
 * @returns True when the file is an authored schema module. Pure.
 */
export function isAuthoredSchemaFile(name: string): boolean {
    return name.endsWith('.schema.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts');
}

/**
 * Recursively discover every authored wire schema under a service's `src/`.
 *
 * @param serviceRoot - Absolute path of the service package root.
 * @param options - Exact-path exclusions.
 * @returns The authored schemas, sorted by `servicePath` so traversal order can never affect the output.
 * @throws When an exclusion names a file that does not exist — a stale exclusion is how a renamed schema
 *   silently stops being published, so it fails loudly instead.
 * @sideEffect Reads the filesystem.
 */
export async function discoverAuthoredSchemas(
    serviceRoot: string,
    options: SchemaDiscoveryOptions = {},
): Promise<AuthoredSchema[]> {
    const excluded = options.excludeFiles ?? [];
    const files = await walk(join(serviceRoot, 'src'));
    const relativePaths = files.map((file) => relative(serviceRoot, file).replaceAll('\\', '/'));

    const stale = excluded.filter((entry) => !relativePaths.includes(entry.servicePath));

    if (stale.length > 0) {
        throw new Error(
            `Stale schema exclusion(s): ${stale.map((entry) => entry.servicePath).join(', ')}. ` +
                'The file no longer exists (renamed? deleted?). A stale exclusion is how a schema silently ' +
                'stops being published — fix the path or drop the entry.',
        );
    }

    const excludedPaths = new Set(excluded.map((entry) => entry.servicePath));

    const schemas = await Promise.all(
        relativePaths
            .filter((servicePath) => !excludedPaths.has(servicePath))
            .map(async (servicePath) => ({
                servicePath,
                moduleName: basenameWithoutExtension(servicePath),
                source: await readFile(join(serviceRoot, servicePath), 'utf8'),
            })),
    );

    return schemas.sort((left, right) => (left.servicePath < right.servicePath ? -1 : 1));
}

/**
 * Recursively collect every authored schema file under a directory.
 *
 * @param directory - Absolute directory to walk.
 * @returns Absolute paths of the matching files.
 * @sideEffect Reads the filesystem.
 */
async function walk(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const found: string[] = [];

    for (const entry of entries) {
        const full = join(directory, entry.name);

        if (entry.isDirectory()) {
            if (isWalkableDirectory(entry.name)) {
                found.push(...(await walk(full)));
            }
        } else if (isAuthoredSchemaFile(entry.name)) {
            found.push(full);
        }
    }

    return found;
}

/**
 * The flat module name a `servicePath` is published under.
 *
 * @param servicePath - A POSIX-separated relative path, e.g. `src/foods/foods.schema.ts`.
 * @returns The basename with the `.ts` extension removed, e.g. `foods.schema`. Pure.
 */
export function basenameWithoutExtension(servicePath: string): string {
    return servicePath.slice(servicePath.lastIndexOf('/') + 1).replace(/\.ts$/u, '');
}

/**
 * Find flat module names claimed by more than one authored schema.
 *
 * The generated package is FLAT, so two authored files with the same basename in different verticals would
 * silently overwrite each other — publishing one contract under the other's name.
 *
 * @param schemas - The authored schemas.
 * @returns Each duplicated module name once, in sorted order. Empty when every name is unique. Pure.
 */
export function findDuplicateModuleNames(schemas: readonly AuthoredSchema[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const schema of schemas) {
        if (seen.has(schema.moduleName)) {
            duplicates.add(schema.moduleName);
        }

        seen.add(schema.moduleName);
    }

    return [...duplicates].sort();
}

/**
 * Rewrite sibling schema imports to their flat form.
 *
 * Generation FLATTENS every authored schema into one directory, so a specifier that resolved in the service
 * tree must be re-pointed or the copy will not compile. The import restriction already limits sibling
 * specifiers to `./<name>.schema.js`, which is flat and needs no change — this exists so that if the
 * restriction is ever relaxed to permit deep sibling paths, the flattening stays correct.
 *
 * @param source - The authored source text.
 * @returns The text with every relative `*.schema.js` specifier reduced to its flat basename. Pure.
 */
export function flattenSiblingImports(source: string): string {
    return source.replace(/(['"])(\.\.?\/[^'"]*?\/)?([a-z0-9][a-z0-9-]*\.schema\.js)\1/gu, '$1./$3$1');
}

/**
 * Fingerprint the authored contract AND the composed sources its shapes are built from.
 *
 * Hashes the SOURCE TEXT of both corpora — key and contents, NUL-framed so a boundary shift cannot collide,
 * sorted by key so traversal order is irrelevant, and CRLF-normalized so a Windows checkout agrees with CI. This
 * is the value embedded in BOTH the service and the schema package (drift layer 3).
 *
 * ⚠️ `composed` is REQUIRED and has NO default. Defaulting it to `[]` would be a one-character change and is
 * exactly the defect this parameter exists to fix: the fingerprint used to cover only the authored files, so
 * changing `recipeDetailSchema`'s definition inside `@kitchensink/recipe-core` altered the wire shape — measurably,
 * `openapi.yaml` gained a required property — while the hash stood still. A caller that omits the composed corpus
 * must fail to COMPILE rather than quietly recreate the blind hash. See `./composed-sources.ts` for the
 * reachability rule, the measured reproduction, and what is deliberately not followed.
 *
 * The two corpora cannot collide in the framing: an authored key is a service-relative path (`src/…`), a composed
 * key is a package name followed by a package-relative path (`@scope/pkg/src/…`).
 *
 * @param schemas - The authored schemas.
 * @param composed - The transitively reachable composed sources, from `collectComposedSources`. EMPTY for a
 *   service whose import allowlist is zod-only (food, identity), whose fingerprint is therefore identical to what
 *   it was before composed sources were counted at all.
 * @returns Lower-case hex SHA-256 of the framed corpus. Pure.
 */
export function computeContractHash(schemas: readonly AuthoredSchema[], composed: readonly ComposedSource[]): string {
    const entries: { readonly key: string; readonly source: string }[] = [
        ...schemas.map((schema) => ({ key: schema.servicePath, source: schema.source })),
        ...composed.map((source) => ({ key: source.key, source: source.source })),
    ];

    const framed = entries
        .sort((left, right) => (left.key < right.key ? -1 : 1))
        .map((entry) => `${entry.key}\u0000${entry.source.replaceAll('\r\n', '\n')}\u0000`)
        .join('');

    return createHash('sha256').update(framed, 'utf8').digest('hex');
}
