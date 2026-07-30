import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@kitchensink/identity-db';

const DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgresql://identity_app:localdev@localhost:5432/kitchensink_identity';

async function seed(): Promise<void> {
    const client = postgres(DATABASE_URL, { max: 1 });
    drizzle(client, { schema });

    console.log('=== Running migrations ===');
    console.log('  (drizzle-kit migrate runs separately; schema assumed synced)');

    console.log('=== Seeding baseline data ===');

    console.log('=== Seed complete ===');
    await client.end();
}

seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
