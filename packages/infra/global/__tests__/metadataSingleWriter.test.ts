// @vitest-environment node
/**
 * Repo-wide guard: exactly ONE module writes a Clerk user's `public_metadata` — `poolAdmin`.
 *
 * `public_metadata` is where every grant the services authorize on lives (`scopes`, `permissions`) and where the
 * fixed test pool's `testPrincipal` marker lives. Two writers are one too many, for a measured reason:
 * `updateUser({ publicMetadata })` REPLACES the whole object (the installed `@clerk/backend` deprecates that use in
 * favour of `updateUserMetadata`, which deep-merges), so a second tool writing its own key erases the other's. The
 * code this replaced had exactly that pair — the Maestro seeder's replace-`updateUser` of `permissions` and the k6
 * provisioner's merge-PATCH of `scopes` — and a third, the linkage minter, wrote metadata at creation.
 *
 * ## Derived, never enumerated
 *
 * Every tracked source file is scanned, comments blanked, for the shapes a metadata WRITE takes against Clerk:
 * the SDK's `updateUserMetadata(`/`replaceUserMetadata(`, `updateUser(` or `createUser(` carrying `publicMetadata`,
 * and a raw Backend API request to `/metadata` or a `public_metadata` body on `/users`. Reading the claim — which
 * every service and every self-signed test JWT does — is not a write and does not match. Unit tests are excluded:
 * a mock writes nothing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isUnitTestFile, repoRoot } from './serviceSources.js';

/** THE writer. */
const WRITER = 'packages/tools/e2e-fixtures/src/poolAdmin.ts';

/** This guard names every pattern it hunts for, so it is not itself a writer. */
const SELF = 'packages/infra/global/__tests__/metadataSingleWriter.test.ts';

/** The shapes of a metadata write. */
const WRITES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
    { name: 'SDK metadata update', pattern: /\.(?:update|replace)UserMetadata\(/u },
    { name: 'SDK updateUser with publicMetadata', pattern: /\.updateUser\([^;]{0,300}?publicMetadata/u },
    { name: 'SDK createUser with publicMetadata', pattern: /\.createUser\([^;]{0,600}?publicMetadata/u },
    { name: 'Backend API /metadata request', pattern: /\/metadata['"`]\s*,\s*\{[^}]{0,200}?method:\s*['"]PATCH['"]/u },
    {
        name: 'Backend API /users body carrying public_metadata',
        pattern: /\/users['"`][^;]{0,600}?public_metadata/u,
    },
];

function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '))
        .replace(/(^|[^:'"`])\/\/.*$/gmu, '$1')
        .replace(/^\s*#.*$/gmu, '');
}

function writers(): ReadonlyMap<string, readonly string[]> {
    const files = execFileSync(
        'git',
        ['ls-files', '--', '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs', '*.sh'],
        { cwd: repoRoot, encoding: 'utf8' },
    )
        .split('\n')
        .filter((file) => file !== '' && file !== SELF)
        .filter((file) => !isUnitTestFile(file))
        .filter((file) => !file.includes('node_modules/'));
    const found = new Map<string, readonly string[]>();

    for (const file of files) {
        let source: string;

        try {
            source = code(readFileSync(path.join(repoRoot, file), 'utf8'));
        } catch {
            continue;
        }

        const shapes = WRITES.filter(({ pattern }) => pattern.test(source)).map(({ name }) => name);

        if (shapes.length > 0) {
            found.set(file, shapes);
        }
    }

    return found;
}

describe('Clerk public_metadata has a single writer', () => {
    const found = writers();

    it('finds the writer (non-vacuity)', () => {
        expect(found.has(WRITER)).toBe(true);
    });

    it('⛔ no other module writes public_metadata', () => {
        const others = [...found.entries()]
            .filter(([file]) => file !== WRITER)
            .map(([file, shapes]) => `${file}: ${shapes.join(', ')}`);

        expect(
            others,
            'a second metadata writer can erase the test-principal marker or a grant — declare the grant on the ' +
                'pool roster and let poolAdmin write it',
        ).toStrictEqual([]);
    });

    it('the matchers see each write shape and ignore a read (mutation check on the patterns)', () => {
        const writes = [
            'await clerk.users.updateUserMetadata(id, { publicMetadata: {} });',
            'user = await clerk.users.updateUser(user.id, { publicMetadata });',
            'await clerk.users.createUser({ emailAddress: [e], publicMetadata: { permissions } });',
            "await backend(`/users/${id}/metadata`, {\n    method: 'PATCH',\n    body,\n});",
            "await fetch('https://api.clerk.com/v1/users', { method: 'POST', body: JSON.stringify({ public_metadata: {} }) });",
        ];

        for (const sample of writes) {
            expect(
                WRITES.some(({ pattern }) => pattern.test(code(sample))),
                sample,
            ).toBe(true);
        }

        const reads = [
            'const scopes = claims.public_metadata?.scopes ?? [];',
            'userPublicMetadata: user?.publicMetadata as Record<string, unknown> | null,',
            'await clerk.users.updateUser(userId, { externalId });',
        ];

        for (const sample of reads) {
            expect(
                WRITES.some(({ pattern }) => pattern.test(code(sample))),
                sample,
            ).toBe(false);
        }
    });
});
