/**
 * THE GENERATOR — assembles `@kitchensink/schema-recipe` from the service's authored `*.schema.ts` files.
 *
 * Direction of derivation, which must never be inverted: the service AUTHORS zod; this script COPIES it into
 * the leaf package; the copy is committed and guarded by regenerate-and-diff in CI. The schema package is
 * generated output — nothing in it is hand-edited, and `recipe-service` never imports it (that would close a
 * cycle in the turbo build graph, verified: turbo rejects it outright).
 *
 * WHY A COPY RATHER THAN A RE-EXPORT. A re-export would make the leaf depend on the service package, which
 * would drag NestJS, drizzle, `pg` and the AWS SDK into `@commise/web` and `@commise/mobile`. The copy is
 * what keeps the leaf a leaf — and it is exactly why the import restriction is enforced before anything is
 * written (see {@link assertNoForbiddenImports}).
 *
 * RUN IT WITH `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * `tsx` is a correct host here even though it cannot emit `design:paramtypes`: that limitation only breaks
 * NestJS dependency injection, and this script never boots the application — it reads source text, checks it,
 * and writes files. Nothing is imported from the schemas themselves, so no decorator metadata is needed.
 *
 * @sideEffect Reads the service's schema sources and WRITES the schema package plus a hash stamp.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { findViolations, formatViolations, type SchemaImportViolation } from './schema-imports.js';

/** Absolute path of the recipe-service package root. */
const SERVICE_ROOT = resolve(import.meta.dirname, '..');

/** Absolute path of the generated schema package. */
const SCHEMA_PACKAGE_ROOT = resolve(SERVICE_ROOT, '../../schemas/recipe');

/** Banner stamped at the head of every generated file, so a reader never mistakes one for source. */
const GENERATED_BANNER = [
    '/*',
    ' * ⚠️ GENERATED FILE — DO NOT EDIT.',
    ' *',
    ' * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the source and',
    ' * regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.',
    ' *',
    ' * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is',
    ' * discarded rather than shipped.',
    ' */',
].join('\n');

/** One authored schema module: where it came from, what it is called, and its text. */
interface AuthoredSchema {
    /** Path relative to the service root, e.g. `src/photos/photos.schema.ts`. */
    readonly servicePath: string;
    /** Flat module basename in the generated package, e.g. `photos.schema`. */
    readonly moduleName: string;
    /** Verbatim source text. */
    readonly source: string;
}

/**
 * Recursively collect every `*.schema.ts` file under a directory.
 *
 * @param directory - Absolute directory to walk.
 * @returns Absolute paths of the matching files, in stable sorted order.
 * @sideEffect Reads the filesystem.
 */
async function findSchemaFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const found: string[] = [];

    for (const entry of entries) {
        const full = join(directory, entry.name);

        if (entry.isDirectory()) {
            // Tests and fixtures never define the wire contract; skipping them keeps a fixture's throwaway
            // schema from being published as though it were part of the API.
            if (['__tests__', '__fixtures__', '__testing__', 'node_modules', 'dist'].includes(entry.name)) {
                continue;
            }

            found.push(...(await findSchemaFiles(full)));
        } else if (entry.name.endsWith('.schema.ts') && !entry.name.endsWith('.test.ts')) {
            found.push(full);
        }
    }

    return found.sort();
}

/**
 * Enforce the import restriction across every authored schema, failing with ALL violations at once.
 *
 * Reporting every breach rather than the first is deliberate: during migration a single file often reaches
 * for several service internals, and fixing them one CI run at a time wastes the author's day.
 *
 * @param schemas - The authored schemas to check.
 * @throws When any schema imports something outside the allowlist.
 */
function assertNoForbiddenImports(schemas: readonly AuthoredSchema[]): void {
    const violations: SchemaImportViolation[] = schemas.flatMap((schema) =>
        findViolations(schema.servicePath, schema.source),
    );

    if (violations.length > 0) {
        throw new Error(formatViolations(violations));
    }
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
 * Fingerprint the authored contract.
 *
 * Hashes the SOURCE TEXT of the authored schemas — path and contents, NUL-framed so a boundary shift cannot
 * collide, sorted by path so traversal order is irrelevant, and CRLF-normalized so a Windows checkout agrees
 * with CI. This is the value embedded in BOTH the service and the schema package.
 *
 * @param schemas - The authored schemas.
 * @returns Lower-case hex SHA-256 of the framed corpus. Pure.
 */
export function computeContractHash(schemas: readonly AuthoredSchema[]): string {
    const framed = [...schemas]
        .sort((left, right) => (left.servicePath < right.servicePath ? -1 : 1))
        .map((schema) => `${schema.servicePath}\u0000${schema.source.replaceAll('\r\n', '\n')}\u0000`)
        .join('');

    return createHash('sha256').update(framed, 'utf8').digest('hex');
}

/**
 * Generate the schema package.
 *
 * @sideEffect Deletes and rewrites the generated directories, and writes two hash stamps.
 */
async function main(): Promise<void> {
    const files = await findSchemaFiles(join(SERVICE_ROOT, 'src'));

    const schemas: AuthoredSchema[] = await Promise.all(
        files.map(async (file) => {
            const source = await readFile(file, 'utf8');
            const servicePath = relative(SERVICE_ROOT, file).replaceAll('\\', '/');
            const moduleName = file.slice(file.lastIndexOf('/') + 1).replace(/\.ts$/u, '');

            return { servicePath, moduleName, source };
        }),
    );

    if (schemas.length === 0) {
        throw new Error(
            'No *.schema.ts files found under src/. The generator would publish an EMPTY contract, which ' +
                'every consumer would then compile against successfully while believing the API has no shapes. ' +
                'Refusing to write.',
        );
    }

    // A flat target directory means two authored files with the same basename in different verticals would
    // silently overwrite each other, publishing one contract under the other's name.
    const duplicates = schemas
        .map((schema) => schema.moduleName)
        .filter((name, index, all) => all.indexOf(name) !== index);

    if (duplicates.length > 0) {
        throw new Error(
            `Duplicate schema module name(s): ${[...new Set(duplicates)].join(', ')}. The generated package ` +
                'is FLAT, so basenames must be unique across verticals. Rename one of them.',
        );
    }

    assertNoForbiddenImports(schemas);

    const generatedSrc = join(SCHEMA_PACKAGE_ROOT, 'src');
    const schemasDir = join(generatedSrc, 'schemas');

    // Remove the previous generation so a DELETED authored schema disappears from the package. Without this
    // the leaf would keep publishing a shape the service no longer serves — drift in the opposite direction.
    await rm(schemasDir, { recursive: true, force: true });
    await mkdir(schemasDir, { recursive: true });

    for (const schema of schemas) {
        const body = flattenSiblingImports(schema.source);
        const header = `${GENERATED_BANNER}\n// Source: packages/services/recipe-service/${schema.servicePath}\n\n`;

        await writeFile(join(schemasDir, `${schema.moduleName}.ts`), header + body, 'utf8');
    }

    const exports = schemas.map((schema) => `export * from './schemas/${schema.moduleName}.js';`).join('\n');

    await writeFile(join(generatedSrc, 'schemas.ts'), `${GENERATED_BANNER}\n\n${exports}\n`, 'utf8');

    await writeFile(
        join(generatedSrc, 'types.ts'),
        `${GENERATED_BANNER}\n\n// The inferred types, re-exported type-only for consumers that want types alone.\nexport type * from './schemas.js';\n`,
        'utf8',
    );

    const hash = computeContractHash(schemas);
    const stamp = (context: string): string =>
        [
            GENERATED_BANNER,
            '',
            '/**',
            ` * Fingerprint of the recipe service's authored wire contract (${context}).`,
            ' *',
            ' * SHA-256 over the authored `*.schema.ts` sources. The generator writes this value into BOTH the',
            ' * service and the schema package, so a consumer pinned to an older schema package can detect that the',
            ' * service it is talking to has moved ahead of it.',
            ' */',
            `export const CONTRACT_HASH = '${hash}';`,
            '',
        ].join('\n');

    await writeFile(join(generatedSrc, 'contract-hash.ts'), stamp('schema package copy'), 'utf8');

    await writeFile(
        join(generatedSrc, 'index.ts'),
        [
            GENERATED_BANNER,
            '',
            "export * from './schemas.js';",
            "export { CONTRACT_HASH } from './contract-hash.js';",
            '',
        ].join('\n'),
        'utf8',
    );

    const serviceStamp = join(SERVICE_ROOT, 'src/contract/contract-hash.ts');

    await mkdir(dirname(serviceStamp), { recursive: true });
    await writeFile(serviceStamp, stamp('service-embedded copy'), 'utf8');

    process.stdout.write(
        `contract:generate — ${schemas.length} schema module(s), CONTRACT_HASH=${hash.slice(0, 12)}…\n` +
            schemas.map((schema) => `  ${schema.servicePath}\n`).join(''),
    );
}

await main();
