/**
 * `@kitchensink/contract-gen` — the ONE wire-contract generator for every HTTP service in this repo
 * (`docs/CODING_STANDARDS.md` §15.2).
 *
 * A service authors its wire contract as zod in `src/**\/*.schema.ts`, beside the controller each schema
 * serves, and uses it directly for request validation. This tool COPIES that zod into the generated leaf
 * package `packages/schemas/<service>` (`@kitchensink/schema-<service>`), stamps a `CONTRACT_HASH` into both
 * sides, and derives the `openapi.yaml` the package publishes for external consumers.
 *
 * A service's own `contract/` directory therefore holds only what is genuinely service-specific: its paths, its
 * import allowlist, its non-contract exclusions, and its OpenAPI document. The procedure — and above all the
 * IMPORT RESTRICTION that keeps the leaf a leaf — lives here, once.
 *
 * Named exports only, per the repo convention.
 */
export {
    basenameWithoutExtension,
    computeContractHash,
    discoverAuthoredSchemas,
    findDuplicateModuleNames,
    flattenSiblingImports,
    isAuthoredSchemaFile,
    isWalkableDirectory,
} from './authored-schema.js';
export type { AuthoredSchema, SchemaDiscoveryOptions, SchemaExclusion } from './authored-schema.js';

export {
    collectModuleReferences,
    findUnpublishedSiblingImports,
    findViolations,
    formatUnpublishedSiblingImports,
    formatViolations,
    isAllowedSpecifier,
    siblingModuleName,
} from './schema-imports.js';
export type {
    AllowedPackageImport,
    ModuleReference,
    ModuleReferenceKind,
    SchemaImportViolation,
    UnpublishedSiblingImport,
    ViolationMessageContext,
} from './schema-imports.js';

export { buildOpenApiDocument } from './openapi.js';
export type {
    HttpMethod,
    OpenApiBuildResult,
    OpenApiCoverage,
    OpenApiOperation,
    OpenApiParameter,
    OpenApiResponse,
    OpenApiSpec,
    ParameterLocation,
} from './openapi.js';

export {
    assertNoForbiddenImports,
    assertSiblingImportsResolve,
    formatGenerationSummary,
    generateSchemaPackage,
} from './generate.js';
export type { ContractGenerationConfig, ContractGenerationResult } from './generate.js';
