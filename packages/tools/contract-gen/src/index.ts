/**
 * `@kitchensink/contract-gen` — the ONE wire-contract generator for every HTTP service in this repo
 * (`docs/CODING_STANDARDS.md` §15.2).
 *
 * A service authors its wire contract as zod in `src/**\/*.schema.ts`, beside the controller each schema
 * serves, and uses it directly for request validation. This tool COPIES that zod into the generated leaf
 * package `packages/schemas/<service>` (`@kitchensink/schema-<service>`), stamps a `CONTRACT_HASH` into both
 * sides, and derives the `openapi.yaml` the package publishes for external consumers.
 *
 * It also publishes the two halves of the CONTRACT GOLDEN MASTER: `contractFingerprint.ts` projects the
 * published zod into the committed `contract.schema.json`, and `contractCompatibility.ts` is the pure
 * classifier that says whether the move from one such document to the next is breaking. Neither generates
 * any code — see the module docstrings, which say so at length, because a committed JSON Schema looks exactly
 * like the alternative ADR-0014 §1 rejected.
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
} from './authoredSchema.js';
export type { AuthoredSchema, SchemaDiscoveryOptions, SchemaExclusion } from './authoredSchema.js';

export { collectComposedSources, composedSourceKey } from './composedSources.js';
export type { ComposedSource, ComposedSourceOptions } from './composedSources.js';

export {
    classifyContractChanges,
    formatContractChanges,
    hasBreakingChange,
    jsonEquals,
} from './contractCompatibility.js';
export type { ContractChange, ContractChangeKind, ContractDocument, JsonValue } from './contractCompatibility.js';

export {
    buildContractFingerprint,
    serializeContractFingerprint,
    sortJsonKeysDeep,
    CONTRACT_FINGERPRINT_FILENAME,
} from './contractFingerprint.js';
export type { ContractFingerprint, ContractFingerprintMetadata } from './contractFingerprint.js';

export {
    collectModuleReferences,
    findUnpublishedSiblingImports,
    findViolations,
    formatUnpublishedSiblingImports,
    formatViolations,
    isAllowedSpecifier,
    siblingModuleName,
} from './schemaImports.js';
export type {
    AllowedPackageImport,
    ModuleReference,
    ModuleReferenceKind,
    SchemaImportViolation,
    UnpublishedSiblingImport,
    ViolationMessageContext,
} from './schemaImports.js';

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

export {
    auditStorageCapacity,
    collectBoundedColumns,
    describeColumnCapacity,
    formatStorageCapacityFindings,
    wireUpperBound,
    INT2_MAX,
    INT4_MAX,
    INT8_EXCLUSIVE_MAX,
} from './storageCapacity.js';
export type {
    BoundedColumn,
    ColumnAccount,
    ColumnCapacity,
    StorageCapacityAudit,
    StorageCapacityFinding,
    WireField,
    WireUpperBound,
} from './storageCapacity.js';
