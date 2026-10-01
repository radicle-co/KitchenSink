/**
 * The role census's default ADMIN probe is derived from the role registry (ADR-0051 §3): it once listed the app roles
 * by hand and so never asked about `food_seeder`, a login role the master must be able to alter.
 */
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES, databaseRoleNames } from '../roles/databaseRoles.js';
import { DEFAULT_ADMIN_PROBE, RDS_IAM_ROLE, readRoleCensus } from '../roles/roleCensus.js';
import type { CatalogReader } from '../roles/roleGraph.js';

describe('DEFAULT_ADMIN_PROBE', () => {
    it('asks about every role of every database in the registry, then rds_iam and rds_superuser', () => {
        expect(DEFAULT_ADMIN_PROBE).toStrictEqual([
            ...Object.values(DATABASE_ROLES).flatMap((roles) => databaseRoleNames(roles)),
            RDS_IAM_ROLE,
            'rds_superuser',
        ]);
    });

    it('includes the food seeder', () => {
        expect(DEFAULT_ADMIN_PROBE).toContain(DATABASE_ROLES.food.seeder);
    });
});

describe('readRoleCensus', () => {
    it('probes the default list when no probe is given', async () => {
        const probed: unknown[] = [];
        const reader: CatalogReader = {
            query: async <Row>(sql: string, values?: unknown[]) => {
                if (sql.includes('FROM pg_roles r')) {
                    const self = {
                        current_user: 'm',
                        server_version: '18.3',
                        rolsuper: false,
                        rolcreatedb: true,
                        rolcreaterole: true,
                        signal_backend: false,
                    };

                    return { rows: [self] as unknown as Row[] };
                }

                if (sql.includes('MEMBER WITH ADMIN OPTION')) {
                    probed.push(values?.[0]);
                }

                return { rows: [] };
            },
        };

        const census = await readRoleCensus(reader);

        expect(probed).toStrictEqual([...DEFAULT_ADMIN_PROBE]);
        expect(Object.keys(census.adminOn)).toStrictEqual([...DEFAULT_ADMIN_PROBE]);
    });
});
