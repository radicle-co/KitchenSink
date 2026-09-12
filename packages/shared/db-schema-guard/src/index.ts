/**
 * `@kitchensink/db-schema-guard` — proving WHICH schema a process is running against.
 *
 * ## The failure this package removes
 *
 * A migration runner reads its own bundled `.sql` directory, diffs it against the `schema_migrations`
 * ledger, and returns `applied: []` when there is nothing to do. When the runner is a previous release's,
 * its directory does not contain the new migrations — so `applied: []` means "I have never heard of them"
 * and is byte-identical to "everything is already applied". Nothing downstream can tell those apart, which
 * is why ADR-0022 concluded that invoking the runner before the deploy that ships it is strictly worse than
 * the ordering bug it was meant to fix.
 *
 * The manifest makes the runner state which set it holds, so "nothing was pending" becomes provable: an
 * empty `applied[]` from a runner whose digest MATCHED the caller's expectation genuinely means the ledger
 * is current for exactly this set.
 *
 * ## Residual, stated rather than implied
 *
 * The manifest proves the runner's SQL matches the working tree. It does NOT prove the tree matches what
 * was reviewed — a migration edited after approval still applies. That is unchanged from before, but it is
 * now the only remaining silent path.
 */
export {
    EmptyMigrationSetError,
    SchemaBehindError,
    SchemaManifestMismatchError,
    SeedBundleRefusedError,
    SeedManifestMismatchError,
    isEmptyMigrationSetError,
    isSchemaBehindError,
    isSchemaManifestMismatchError,
    isSeedBundleRefusedError,
    isSeedManifestMismatchError,
} from './errors.js';
export type {
    SchemaBehindInput,
    SchemaManifestMismatchInput,
    SeedBundleRefusal,
    SeedManifestMismatchInput,
} from './errors.js';

export { digestManifest, formatManifest, isManifestSha, sha256Hex } from './manifest.js';
export type { ManifestEntry } from './manifest.js';

export { readMigrationManifest } from './manifestFile.js';

export { MalformedMigrateEventError, isMalformedMigrateEventError, parseMigrateEvent } from './migrateEvent.js';
export type { MigrateEvent } from './migrateEvent.js';

export { isSeedManifestPath } from './seedManifest.js';
export { assertSeedBundleMatches, readSeedManifest } from './seedManifestFile.js';
export type { AssertSeedBundleMatchesOptions, SeedManifest } from './seedManifestFile.js';
export { MalformedSeedEventError, isMalformedSeedEventError, parseSeedEvent } from './seedEvent.js';
export type { SeedEvent } from './seedEvent.js';

export { applyMigrations, assertBundleMatches, discoverMigrations } from './applyMigrations.js';
export type { ApplyMigrationsOptions, DiscoveredMigration, MigrateResult } from './applyMigrations.js';

export type { MigrationClient, MigrationPool, MigrationQueryResult } from './port.js';
export type { MigrationManifest } from './manifestFile.js';

export { assertManifestMatches, assertSchemaCurrent, missingMigrations } from './assertions.js';

export { schemaCurrencyMode, verifySchemaCurrent } from './bootGuard.js';
export type { SchemaCurrencyMode, VerifySchemaCurrentOptions } from './bootGuard.js';
export type { AssertManifestMatchesOptions, AssertSchemaCurrentOptions } from './assertions.js';

export {
    edgeConfersMembership,
    everyMembershipRow,
    lockOutPredicate,
    pathsToRole,
    readMembershipEdges,
} from './roles/roleGraph.js';
export type { CatalogReader, LockOutEdges, MembershipEdge } from './roles/roleGraph.js';
export {
    DATABASE_ROLES,
    MIGRATION_LEDGER_TABLE,
    RDS_MASTER_USERNAME,
    databaseRoleNames,
    loginRoles,
    loginRolesByKey,
} from './roles/databaseRoles.js';
export { RoleModelAbsentError, assertRoleModelPresent, isRoleModelAbsentError } from './roles/roleModelPresence.js';
export type { AssertRoleModelPresentOptions } from './roles/roleModelPresence.js';
export type { DatabaseRoles, DatabaseService, LoginRoleKey } from './roles/databaseRoles.js';
export {
    databaseAclStatements,
    isSafeDatabaseName,
    migrationLedgerReadOnly,
    privilegesAfterApply,
    privilegesBeforeApply,
    tablePolicyStatements,
} from './roles/privilegeStatements.js';
export {
    NO_TABLE_POLICY,
    SERVICE_ROLE_TABLE_RIGHTS,
    TABLE_POLICY_RIGHTS,
    TABLE_POLICY_SETS,
    assertTablePolicyFits,
    policyTables,
} from './roles/tablePolicy.js';
export {
    TablePolicyOverlapError,
    TablePolicySeederMismatchError,
    isTablePolicyOverlapError,
    isTablePolicySeederMismatchError,
} from './roles/tablePolicy.errors.js';
export type { TablePolicyOverlap, TablePolicySeederMismatch } from './roles/tablePolicy.errors.js';
export type { PolicyTable, TablePolicy, TablePolicySet, TablePrivilege } from './roles/tablePolicy.js';
export { iamLoginStatements, roleModelStatements } from './roles/roleStatements.js';
export type { RoleModelContext } from './roles/roleStatements.js';
export {
    RDS_IAM,
    RoleModelPostconditionError,
    applyRoleModel,
    assertRoleModel,
    isRoleModelPostconditionError,
} from './roles/applyRoleModel.js';
export type { RoleModelInput } from './roles/applyRoleModel.js';
export {
    OWNERSHIP_AUDIT_MARKER,
    auditObjectOwners,
    auditSeederPrivileges,
    auditServicePrivileges,
} from './roles/ownershipAudit.js';
export { ROLE_CATALOG_LOCK_KEY, ROLE_CATALOG_LOCK_TIMEOUT_MS } from './roles/catalogLock.js';
export { ADVISORY_LOCK_CLASSES } from './roles/advisoryLockClasses.js';
export type { AdvisoryLockClass } from './roles/advisoryLockClasses.js';
export { DEFAULT_ADMIN_PROBE, RDS_IAM_ROLE, readRoleCensus } from './roles/roleCensus.js';
export type { RoleCensus, RoleCensusOptions } from './roles/roleCensus.js';
