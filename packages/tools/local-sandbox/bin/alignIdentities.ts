/**
 * `tsx bin/alignIdentities.ts` — give the Maestro shard's pool users, in the LOCAL identity database, the app-user
 * id their Clerk `external_id` names (`src/identityAlignment.ts` says why). `localMaestro.sh` runs it before the
 * world is seeded and before the device signs in.
 *
 * Reads `CLERK_SECRET_KEY` and `COMMISE_E2E_SHARD` (absent is shard 1) from the environment. The database is the
 * one the running `local-sandbox-identity` container reads, found from that container's own `DB_NAME`, so this can
 * never align a database the service does not serve.
 *
 * @sideEffect Reads Clerk's Backend API and the identity container's environment; writes the local identity database.
 */
import { spawnSync } from 'node:child_process';

import { clerkLeasePort } from '@kitchensink/e2e-fixtures/lease';
import { maestroErasureSlots, maestroSlotForShard } from '@kitchensink/e2e-fixtures/testPool';
import { accounts, profiles, users } from '@kitchensink/identity-db';
import { provisionCompleteUser } from '@kitchensink/identity-utils';
import { eq, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { LOCAL_DB } from '../src/composePlan.js';
import { alignPoolIdentities, type AlignmentPorts } from '../src/identityAlignment.js';

const IDENTITY_CONTAINER = 'local-sandbox-identity';

/**
 * The database the identity container reads.
 *
 * @sideEffect Runs `docker inspect`.
 */
function identityDatabase(): string {
    const result = spawnSync(
        'docker',
        ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', IDENTITY_CONTAINER],
        {
            encoding: 'utf8',
        },
    );
    const name = (result.stdout ?? '')
        .split('\n')
        .find((line) => line.startsWith('DB_NAME='))
        ?.slice('DB_NAME='.length);

    if (result.status !== 0 || name === undefined || name === '') {
        throw new Error(
            `alignIdentities: ${IDENTITY_CONTAINER} is not running or names no DB_NAME — run \`npm run local:up\``,
        );
    }

    return name;
}

/** The shard from `COMMISE_E2E_SHARD`; absent is 1, anything else must be a positive integer. Pure. */
function shardFrom(raw: string | undefined): number {
    if (raw === undefined || raw === '') {
        return 1;
    }

    const shard = Number(raw);

    if (!Number.isInteger(shard) || shard < 1) {
        throw new Error(`alignIdentities: COMMISE_E2E_SHARD must be a positive integer, got '${raw}'`);
    }

    return shard;
}

async function main(): Promise<void> {
    const secretKey = process.env['CLERK_SECRET_KEY'];

    if (secretKey === undefined || secretKey === '') {
        throw new Error('alignIdentities: CLERK_SECRET_KEY is not set');
    }

    const shard = shardFrom(process.env['COMMISE_E2E_SHARD']);
    const slots = [
        maestroSlotForShard('signer', shard),
        maestroSlotForShard('coauthor', shard),
        ...maestroErasureSlots(shard),
    ];

    const pool = new pg.Pool({
        host: '127.0.0.1',
        port: LOCAL_DB.hostPort,
        user: LOCAL_DB.user,
        password: LOCAL_DB.password,
        database: identityDatabase(),
    });
    const db = drizzle(pool);
    const lease = clerkLeasePort(secretKey);

    const ports: AlignmentPorts = {
        findUsers: lease.findUsers,
        rowsFor: (identityId, externalId) =>
            db
                .select({ id: users.id, identityId: users.identityId, status: users.status })
                .from(users)
                .where(or(eq(users.identityId, identityId), eq(users.id, externalId))),
        // `accounts` and `profiles` reference `users.id` ON DELETE CASCADE, so they go with it.
        removeRow: async (identityId) => {
            await db.delete(users).where(eq(users.identityId, identityId));
        },
        // THE house provisioning routine, with the id fixed to the one Clerk already carries.
        provision: async ({ identityId, externalId, email }) => {
            const result = await provisionCompleteUser(
                { db, schema: { users, accounts, profiles }, newUserId: () => externalId },
                { identityId, email },
                { onEmailCollision: 'placeholder', emailIsReal: true },
            );

            if (result.kind !== 'complete') {
                throw new Error(`alignIdentities: provisioning ${email} returned ${result.kind}`);
            }

            return result.user.id;
        },
    };

    try {
        for (const outcome of await alignPoolIdentities(slots, ports)) {
            process.stderr.write(`alignIdentities: maestro/${outcome.slot} ${outcome.kind}\n`);
        }
    } finally {
        await pool.end();
    }
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
