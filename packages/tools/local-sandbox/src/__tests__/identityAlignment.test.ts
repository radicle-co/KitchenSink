/**
 * The local identity database must give each pool user the SAME app-user id the Clerk `external_id` carries.
 *
 * ⛔ WHY THIS EXISTS. The local sandbox signs in the sandbox Clerk instance's pool users. Their `external_id` was
 * written by the SANDBOX identity webhook and names the sandbox database's `users.id`. Recipe-service takes the
 * owner from that claim, while the app's "me" is the local identity's `/v1/users/me` `user.id` — and the local
 * identity's read-through creation minted a fresh ULID for the same Clerk `sub`. Measured on 2026-10-08: the
 * signer's seeded recipes had `owner_id = 01M2G4YJ…` (the `external_id`), the local identity row was
 * `01M4DQBX…`, so every owner-gated control (Edit, Delete, visibility) was hidden and the detail showed the
 * non-owner "Rate this recipe" view. Five Maestro flows failed on it.
 */
import { describe, expect, it } from 'vitest';

import type { PoolSlot } from '@kitchensink/e2e-fixtures/testPool';
import { slotFor } from '@kitchensink/e2e-fixtures/testPool';

import {
    alignPoolIdentities,
    isIdentityAlignmentRefusal,
    planIdentityAlignment,
    type AlignmentPorts,
    type IdentityRow,
} from '../identityAlignment.js';

const SUB = 'user_signer';
const EXTERNAL = '01M2G4YJN80QDPHNJ035VNVSCT';
const STALE = '01M4DQBXE6QZ3TWXS8F182H8E9';

const row = (overrides: Partial<IdentityRow> = {}): IdentityRow => ({
    id: EXTERNAL,
    identityId: SUB,
    status: 'active',
    ...overrides,
});

/** Run the planner and return the refusal it throws, failing the test when it does not throw one. */
function refusalOf(rows: readonly IdentityRow[]): string {
    try {
        planIdentityAlignment({ identityId: SUB, externalId: EXTERNAL }, rows);
    } catch (error) {
        expect(isIdentityAlignmentRefusal(error)).toBe(true);

        return (error as Error).message;
    }

    throw new Error('expected the planner to refuse');
}

describe('planIdentityAlignment', () => {
    it('provisions the user under the external_id when no row holds the sub', () => {
        expect(planIdentityAlignment({ identityId: SUB, externalId: EXTERNAL }, [])).toStrictEqual({
            kind: 'provision',
        });
    });

    it('does nothing when the sub already resolves to the external_id', () => {
        expect(planIdentityAlignment({ identityId: SUB, externalId: EXTERNAL }, [row()])).toStrictEqual({
            kind: 'aligned',
        });
    });

    it('replaces a row the read-through minted under a different id — the defect this exists for', () => {
        expect(planIdentityAlignment({ identityId: SUB, externalId: EXTERNAL }, [row({ id: STALE })])).toStrictEqual({
            kind: 'replace',
            staleId: STALE,
        });
    });

    it.each(['tombstoned', 'erased'])(
        'refuses to replace a %s row — a closed account is never resurrected',
        (status) => {
            expect(refusalOf([row({ id: STALE, status })])).toContain(status);
        },
    );

    it('refuses when the external_id already belongs to a DIFFERENT Clerk identity', () => {
        // Replacing would hand one person's app-user id to another sign-in.
        expect(refusalOf([row({ identityId: 'user_someone_else' })])).toContain('user_someone_else');
    });

    it('refuses the stale row AND a foreign holder together rather than picking one', () => {
        expect(refusalOf([row({ id: STALE }), row({ identityId: 'user_someone_else' })])).toContain(
            'user_someone_else',
        );
    });
});

/** In-memory fakes for the two boundaries: Clerk's user lookup and the local identity table. */
function fakePorts(
    clerk: Readonly<Record<string, readonly { id: string; externalId: string | null; testPrincipal?: boolean }[]>>,
    initial: readonly IdentityRow[],
) {
    let rows = [...initial];
    const provisioned: { identityId: string; externalId: string; email: string }[] = [];

    const ports: AlignmentPorts = {
        findUsers: (email) =>
            Promise.resolve(
                (clerk[email] ?? []).map((user) => ({
                    id: user.id,
                    externalId: user.externalId,
                    publicMetadata: { testPrincipal: user.testPrincipal ?? true },
                })),
            ),
        rowsFor: (identityId, externalId) =>
            Promise.resolve(rows.filter((r) => r.identityId === identityId || r.id === externalId)),
        removeRow: (identityId) => {
            rows = rows.filter((r) => r.identityId !== identityId);

            return Promise.resolve();
        },
        provision: (input) => {
            provisioned.push(input);
            rows.push({ id: input.externalId, identityId: input.identityId, status: 'active' });

            return Promise.resolve(input.externalId);
        },
    };

    return { ports, provisioned, rows: () => rows };
}

const signer: PoolSlot = slotFor('maestro', 'signer');
const coAuthor: PoolSlot = slotFor('maestro', 'coauthor');

describe('alignPoolIdentities', () => {
    it('re-keys a stale row to the external_id and provisions the missing one', async () => {
        const fake = fakePorts(
            {
                [signer.email]: [{ id: SUB, externalId: EXTERNAL }],
                [coAuthor.email]: [{ id: 'user_coauthor', externalId: '01COAUTHOR0000000000000000' }],
            },
            [row({ id: STALE })],
        );

        const outcomes = await alignPoolIdentities([signer, coAuthor], fake.ports);

        expect(outcomes).toStrictEqual([
            { slot: signer.id, kind: 'replace' },
            { slot: coAuthor.id, kind: 'provision' },
        ]);
        expect(fake.rows().map((r) => [r.identityId, r.id])).toStrictEqual([
            [SUB, EXTERNAL],
            ['user_coauthor', '01COAUTHOR0000000000000000'],
        ]);
        expect(fake.provisioned.map((p) => p.email)).toStrictEqual([signer.email, coAuthor.email]);
    });

    it('writes nothing for a slot that is already aligned', async () => {
        const fake = fakePorts({ [signer.email]: [{ id: SUB, externalId: EXTERNAL }] }, [row()]);

        expect(await alignPoolIdentities([signer], fake.ports)).toStrictEqual([{ slot: signer.id, kind: 'aligned' }]);
        expect(fake.provisioned).toStrictEqual([]);
    });

    it('skips a consumed slot no Clerk user holds — an erased subject is not an error', async () => {
        const fake = fakePorts({}, []);

        expect(await alignPoolIdentities([signer], fake.ports)).toStrictEqual([{ slot: signer.id, kind: 'absent' }]);
    });

    it('fails a slot whose Clerk user has no external_id, rather than provisioning a fresh id', async () => {
        const fake = fakePorts({ [signer.email]: [{ id: SUB, externalId: null }] }, []);

        await expect(alignPoolIdentities([signer], fake.ports)).rejects.toThrow(/external_id/u);
        expect(fake.provisioned).toStrictEqual([]);
    });

    it('fails when provisioning lands on any id but the external_id — the post-condition is the guarantee', async () => {
        const fake = fakePorts({ [signer.email]: [{ id: SUB, externalId: EXTERNAL }] }, []);
        const ports: AlignmentPorts = { ...fake.ports, provision: () => Promise.resolve(STALE) };

        await expect(alignPoolIdentities([signer], ports)).rejects.toThrow(STALE);
    });
});
