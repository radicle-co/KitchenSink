/**
 * THE GENERATOR — assembles `@kitchensink/schema-<service>` from a service's authored `*.schema.ts` files.
 *
 * Direction of derivation, which must never be inverted: the service AUTHORS zod; this copies it into the leaf
 * package; the copy is committed and guarded by regenerate-and-diff in CI. The schema package is generated
 * output — nothing in it is hand-edited, and the service never imports it (that would close a cycle in the
 * turbo build graph).
 *
 * WHY A COPY RATHER THAN A RE-EXPORT. A re-export would make the leaf depend on the service package, which
 * would drag NestJS, drizzle, `pg` and the AWS SDK into `@commise/web` and `@commise/mobile`. The copy is what
 * keeps the leaf a leaf — and it is exactly why the import restriction is enforced BEFORE anything is written
 * (see {@link assertNoForbiddenImports}).
 *
 * WHY ONE SHARED GENERATOR RATHER THAN ONE PER SERVICE. The generation procedure — walk, guard, flatten, hash,
 * write, derive — is a single piece of knowledge. Three copies of it would drift in three directions, and the
 * import restriction is the LOAD-BEARING safety property of the seam: a service whose copy of the guard fell
 * behind would ship the server graph into mobile while its CI stayed green. Each service supplies only what is
 * genuinely its own: its paths, its allowlist, its exclusions, and its OpenAPI document.
 *
 * `tsx` is a correct host for the callers even though it cannot emit `design:paramtypes`: that limitation only
 * breaks NestJS dependency injection, and generation never boots the application.
 *
 * @sideEffect Reads the service's schema sources and WRITES the schema package plus two hash stamps.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';

import {
    computeContractHash,
    discoverAuthoredSchemas,
    findDuplicateModuleNames,
    flattenSiblingImports,
    type AuthoredSchema,
    type SchemaExclusion,
} from './authoredSchema.js';
import { collectComposedSources, type ComposedSource } from './composedSources.js';
import {
    findUnpublishedSiblingImports,
    findViolations,
    formatUnpublishedSiblingImports,
    formatViolations,
    type AllowedPackageImport,
    type SchemaImportViolation,
    type UnpublishedSiblingImport,
} from './schemaImports.js';
import type { OpenApiBuildResult } from './openapi.js';

/** Everything a service must state about its own contract. Nothing here has a default that could be wrong. */
export interface ContractGenerationConfig {
    /** Absolute path of the service package root (the directory holding its `package.json`). */
    readonly serviceRoot: string;
    /** Absolute path of the generated schema package root, e.g. `<repo>/packages/schemas/food`. */
    readonly schemaPackageRoot: string;
    /** The generated package's npm name, e.g. `@kitchensink/schema-food`. */
    readonly schemaPackageName: string;
    /**
     * Repo-relative path of the service, used in the per-file `// Source:` provenance comment so a reader of a
     * generated file can find the authored original without guessing.
     */
    readonly servicePathPrefix: string;
    /** The exact command that regenerates this package, quoted in the generated banner. */
    readonly regenerateCommand: string;
    /** Human name of the contract, used in the `CONTRACT_HASH` doc comment, e.g. `food (ingredient) service`. */
    readonly contractDisplayName: string;
    /** Module specifiers an authored `*.schema.ts` may import, each with the reason it is safe. */
    readonly allowedPackageImports: readonly AllowedPackageImport[];
    /** Authored `*.schema.ts` files that are deliberately NOT wire contract. */
    readonly excludeFiles?: readonly SchemaExclusion[];
    /** Path, relative to the service root, of the service-embedded `CONTRACT_HASH` stamp. */
    readonly serviceStampPath: string;
    /**
     * The derived OpenAPI document. Built by the CALLER (which imports the authored zod at runtime) and passed
     * in, so this module stays free of any knowledge about a particular API's routes.
     */
    readonly openApi: OpenApiBuildResult;
}

/** What a generation run produced, for the caller to report. */
export interface ContractGenerationResult {
    /** The authored schemas that were published. */
    readonly schemas: readonly AuthoredSchema[];
    /**
     * The composed sources the authored schemas transitively reach, which are part of the fingerprint but are NOT
     * copied into the package (they belong to a leaf the consumer already depends on).
     */
    readonly composed: readonly ComposedSource[];
    /** The contract fingerprint written into both the service and the schema package. */
    readonly contractHash: string;
    /** The OpenAPI coverage report. */
    readonly coverage: OpenApiBuildResult['coverage'];
}

/**
 * Build the banner stamped at the head of every generated file, so a reader never mistakes one for source.
 *
 * @param config - The service's contract configuration.
 * @returns The banner comment block. Pure.
 */
function generatedBanner(config: ContractGenerationConfig): string {
    return [
        '/*',
        ' * ⚠️ GENERATED FILE — DO NOT EDIT.',
        ' *',
        ` * Copied verbatim from the ${config.contractDisplayName}, which AUTHORS the wire contract. Edit the`,
        ` * source and regenerate: \`${config.regenerateCommand}\`.`,
        ' *',
        ' * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is',
        ' * discarded rather than shipped.',
        ' */',
    ].join('\n');
}

/**
 * Enforce the import restriction across every authored schema, failing with ALL violations at once.
 *
 * Reporting every breach rather than the first is deliberate: during migration a single file often reaches for
 * several service internals, and fixing them one CI run at a time wastes the author's day.
 *
 * @param schemas - The authored schemas to check.
 * @param config - The service's contract configuration (supplies the allowlist and package name).
 * @throws When any schema imports something outside the allowlist.
 */
export function assertNoForbiddenImports(
    schemas: readonly AuthoredSchema[],
    config: Pick<ContractGenerationConfig, 'allowedPackageImports' | 'schemaPackageName'>,
): void {
    const violations: SchemaImportViolation[] = schemas.flatMap((schema) =>
        findViolations(schema.servicePath, schema.source, config.allowedPackageImports),
    );

    if (violations.length > 0) {
        throw new Error(
            formatViolations(violations, {
                allowed: config.allowedPackageImports,
                schemaPackageName: config.schemaPackageName,
            }),
        );
    }
}

/**
 * Enforce that every sibling schema import RESOLVES to a module the generated package will actually contain.
 *
 * The import restriction admits a specifier that is SHAPED like a flat sibling schema module. That is not the
 * same as the module being published, and the gap is reachable rather than theoretical: every service EXCLUDES
 * its `src/config/env.schema.ts` from publication, while `./env.schema.js` matches the sibling pattern — so
 * without this check an authored wire schema could import an excluded sibling, generation would succeed, and the
 * leaf package would ship an import of a file that is not there. A renamed or deleted sibling is the same class.
 *
 * @param schemas - The authored schemas, which are also the definition of what WILL be published.
 * @param config - Supplies the destination package name for the message.
 * @throws When any sibling import names a module outside the published set.
 */
export function assertSiblingImportsResolve(
    schemas: readonly AuthoredSchema[],
    config: Pick<ContractGenerationConfig, 'schemaPackageName'>,
): void {
    const publishedModuleNames = schemas.map((schema) => schema.moduleName);
    const unresolved: UnpublishedSiblingImport[] = schemas.flatMap((schema) =>
        findUnpublishedSiblingImports(schema.servicePath, schema.source, publishedModuleNames),
    );

    if (unresolved.length > 0) {
        throw new Error(
            formatUnpublishedSiblingImports(unresolved, {
                schemaPackageName: config.schemaPackageName,
                publishedModuleNames,
            }),
        );
    }
}

/**
 * Generate a service's schema package: the copied zod, the inferred types, the barrel, both hash stamps, and
 * the derived `openapi.yaml`.
 *
 * @param config - The service's contract configuration.
 * @returns What was published, for the caller to print.
 * @throws When no authored schema exists, when two share a flat module name, when the import restriction is
 *   breached, or when a sibling import names a module that will not be published. Every one of those is checked
 *   BEFORE anything is written, so a failed run leaves the committed package untouched rather than
 *   half-rewritten.
 * @sideEffect Deletes and rewrites the generated `src/schemas/` directory and writes six files.
 */
export async function generateSchemaPackage(config: ContractGenerationConfig): Promise<ContractGenerationResult> {
    const schemas = await discoverAuthoredSchemas(config.serviceRoot, { excludeFiles: config.excludeFiles });

    if (schemas.length === 0) {
        throw new Error(
            'No *.schema.ts files found under src/. The generator would publish an EMPTY contract, which every ' +
                'consumer would then compile against successfully while believing the API has no shapes. ' +
                'Refusing to write.',
        );
    }

    const duplicates = findDuplicateModuleNames(schemas);

    if (duplicates.length > 0) {
        throw new Error(
            `Duplicate schema module name(s): ${duplicates.join(', ')}. The generated package is FLAT, so ` +
                'basenames must be unique across verticals. Rename one of them.',
        );
    }

    assertNoForbiddenImports(schemas, config);
    assertSiblingImportsResolve(schemas, config);

    // AFTER the import restriction, never before: that check is what bounds the specifiers reaching the
    // reachability walk to zod, the allowlist, and published siblings. Running it first would let a service
    // internal — a DAL type, a drizzle schema — pull the server graph into the hash corpus before being rejected.
    const composed = await collectComposedSources(schemas, { serviceRoot: config.serviceRoot });

    const banner = generatedBanner(config);
    const generatedSrc = join(config.schemaPackageRoot, 'src');
    const schemasDir = join(generatedSrc, 'schemas');

    // Remove the previous generation so a DELETED authored schema disappears from the package. Without this the
    // leaf would keep publishing a shape the service no longer serves — drift in the opposite direction.
    await rm(schemasDir, { recursive: true, force: true });
    await mkdir(schemasDir, { recursive: true });

    for (const schema of schemas) {
        const header = `${banner}\n// Source: ${config.servicePathPrefix}/${schema.servicePath}\n\n`;

        await writeFile(join(schemasDir, `${schema.moduleName}.ts`), header + flattenSiblingImports(schema.source));
    }

    const exports = schemas.map((schema) => `export * from './schemas/${schema.moduleName}.js';`).join('\n');

    await writeFile(join(generatedSrc, 'schemas.ts'), `${banner}\n\n${exports}\n`);

    await writeFile(
        join(generatedSrc, 'types.ts'),
        `${banner}\n\n// The inferred types, re-exported type-only for consumers that want types alone.\nexport type * from './schemas.js';\n`,
    );

    const contractHash = computeContractHash(schemas, composed);
    const stamp = (context: string): string =>
        [
            banner,
            '',
            '/**',
            ` * Fingerprint of the ${config.contractDisplayName}'s authored wire contract (${context}).`,
            ' *',
            ' * SHA-256 over the authored `*.schema.ts` sources AND the composed sources they transitively',
            ' * reach (see @kitchensink/contract-gen composedSources.ts). The generator writes this value into',
            ' * BOTH the service and the schema package, so a consumer pinned to an older schema package can',
            ' * detect that the service it is talking to has moved ahead of it.',
            ' */',
            `export const CONTRACT_HASH = '${contractHash}';`,
            '',
        ].join('\n');

    await writeFile(join(generatedSrc, 'contractHash.ts'), stamp('schema package copy'));

    await writeFile(
        join(generatedSrc, 'index.ts'),
        [banner, '', "export * from './schemas.js';", "export { CONTRACT_HASH } from './contractHash.js';", ''].join(
            '\n',
        ),
    );

    const serviceStamp = join(config.serviceRoot, config.serviceStampPath);

    await mkdir(dirname(serviceStamp), { recursive: true });
    await writeFile(serviceStamp, stamp('service-embedded copy'));

    await writeFile(
        join(config.schemaPackageRoot, 'openapi.yaml'),
        [
            '# ⚠️ GENERATED FILE — DO NOT EDIT.',
            '#',
            `# DERIVED from the ${config.contractDisplayName}'s authored zod. Regenerate with:`,
            `#   ${config.regenerateCommand}`,
            '#',
            '# This document is for EXTERNAL consumption (oasdiff, docs, integrators). It is NOT a codegen input',
            '# and NOT the type authority — that is the zod exported from ./src/index.ts.',
            '',
            stringify(config.openApi.document, { lineWidth: 120 }),
        ].join('\n'),
    );

    return { schemas, composed, contractHash, coverage: config.openApi.coverage };
}

/**
 * Render a generation result as the operator-facing summary the `contract:generate` script prints.
 *
 * The response-schema gaps are printed EVERY run, not hidden behind a flag: §15.2.5 records that a document
 * with undocumented response bodies is blind to most of what breaks a client, and a gap nobody sees is a gap
 * nobody closes.
 *
 * @param result - The generation result.
 * @param schemaPackageName - The package that was written.
 * @returns A multi-line summary. Pure.
 */
export function formatGenerationSummary(result: ContractGenerationResult, schemaPackageName: string): string {
    const lines = [
        `contract:generate — ${schemaPackageName}`,
        `  ${result.schemas.length} schema module(s), CONTRACT_HASH=${result.contractHash.slice(0, 12)}…`,
        ...result.schemas.map((schema) => `    ${schema.servicePath}`),
        // Printed every run, like the response-schema gaps: the composed corpus is the part of the fingerprint
        // that is NOT visible in this package's own files, so a reader who cannot see it cannot reason about why
        // the hash moved.
        `  ${result.composed.length} composed source(s) in the fingerprint:`,
        ...result.composed.map((source) => `    ${source.key}`),
        `  openapi.yaml — ${result.coverage.totalOperations} operation(s), ` +
            `${result.coverage.componentCount} component schema(s), ` +
            `${result.coverage.operationsFullyTyped}/${result.coverage.totalOperations} fully typed`,
    ];

    if (result.coverage.responsesWithoutSchema.length > 0) {
        lines.push(`  ⚠️ ${result.coverage.responsesWithoutSchema.length} response(s) with NO body schema:`);
        lines.push(...result.coverage.responsesWithoutSchema.map((gap) => `    ${gap}`));
    }

    return lines.join('\n');
}
