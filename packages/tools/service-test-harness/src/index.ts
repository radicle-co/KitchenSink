export { bootServiceApp, type BootServiceAppOptions, type BootedServiceApp } from './bootServiceApp.js';
export { registerRankingConformance, type ConformanceRow, type RankedSurface } from './rankingConformance.js';
export { BACKEND_TERMINATED, isBackendTermination, poolForDroppableDatabase } from './droppableDatabasePool.js';
export {
    TEST_MASTER_ROLE,
    provisionRdsLikeDatabase,
    rdsLikeUrlFor,
    type ProvisionRdsLikeOptions,
    type RdsLikeDatabase,
} from './rdsLikeDatabase.js';
// ⚠️ `adminServerUrl` is deliberately NOT exported: a suite that could read it could connect as the superuser,
// which is the whole thing these fixtures exist to prevent.
export {
    NonDisposableAdminServerError,
    decideAdminServerUrl,
    hasAdminServer,
    isNonDisposableAdminServerError,
    type AdminServerDecision,
} from './adminServer.js';
export {
    DISPOSABLE_DATABASE_NAME_SUFFIX,
    NonDisposableDatabaseError,
    engineMigrator,
    isNonDisposableDatabaseError,
    provisionRoleDatabase,
    roleDatabase,
    truncateStatement,
    type MigrateAsMigrator,
    type RoleDatabase,
    type RoleDatabaseSpec,
} from './roleDatabase.js';
export { MisownedDatabaseError, assertDatabaseOwnedBy, isMisownedDatabaseError } from './databaseOwner.js';
