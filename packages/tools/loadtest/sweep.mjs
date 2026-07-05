/**
 * Sweep cleanup — delete EVERY lingering load-test user in the Clerk instance, not just the ones in a
 * given pool file. Teardown in run.mjs only covers users it created; a hard kill (crash / SIGKILL / lost
 * power) skips teardown and orphans them. This sweeps by a strict email pattern so those orphans (and any
 * stale persistent pool) get cleaned regardless of which run created them.
 *
 * SAFETY: only deletes emails matching `^(loadtest\+|test-).*@(example|radcile)\.com$` — never a real user.
 * Set DRY_RUN=1 to list without deleting.
 *
 * Env: CLERK_SECRET_KEY (required). DRY_RUN.
 * @sideEffect Deletes Clerk users.
 */
import { setTimeout as delay } from 'node:timers/promises';

const SK = process.env['CLERK_SECRET_KEY'] ?? process.env['CLERK_SK'];
const DRY_RUN = process.env['DRY_RUN'] === '1' || process.env['DRY_RUN'] === 'true';
const BAPI = 'https://api.clerk.com/v1';

// Strict allowlist of deletable test identities — anything else is left untouched.
const TEST_EMAIL = /^(loadtest\+|test-).*@(example|radcile)\.com$/;

if (!SK) {
    throw new Error('CLERK_SECRET_KEY (or CLERK_SK) is required.');
}

const bapi = (path, opts = {}) =>
    fetch(`${BAPI}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });

const primaryEmail = (user) => {
    const addr = (user.email_addresses ?? []).find((e) => e.id === user.primary_email_address_id);
    return addr?.email_address ?? (user.email_addresses ?? [])[0]?.email_address ?? '';
};

/** Page through every user and collect the ones whose primary email matches the test pattern. */
async function findTestUsers() {
    const matches = [];
    const limit = 100;

    for (let offset = 0; ; offset += limit) {
        const res = await bapi(`/users?limit=${limit}&offset=${offset}`);

        if (!res.ok) {
            throw new Error(`list users ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }

        const page = await res.json();

        for (const user of page) {
            const email = primaryEmail(user);

            if (TEST_EMAIL.test(email)) {
                matches.push({ id: user.id, email });
            }
        }

        if (page.length < limit) {
            return matches;
        }
    }
}

const users = await findTestUsers();
console.log(`Found ${users.length} test user(s) matching ${TEST_EMAIL}.`);

if (users.length === 0) {
    console.log('Nothing to sweep.');
    process.exit(0);
}

if (DRY_RUN) {
    users.forEach((u) => console.log(`  [dry-run] would delete ${u.email} (${u.id})`));
    process.exit(0);
}

let deleted = 0;

for (const user of users) {
    let ok = false;

    for (let attempt = 0; attempt < 4 && !ok; attempt += 1) {
        const res = await bapi(`/users/${user.id}`, { method: 'DELETE' });

        if (res.status === 200 || res.status === 404) {
            ok = true;
        } else {
            await delay(500 * 2 ** attempt); // 429 / transient
        }
    }

    if (ok) {
        deleted += 1;
        console.log(`  deleted ${user.email}`);
    } else {
        console.error(`  !! FAILED to delete ${user.email} (${user.id}) — delete manually.`);
    }
}

console.log(`Swept ${deleted}/${users.length} test users.`);
