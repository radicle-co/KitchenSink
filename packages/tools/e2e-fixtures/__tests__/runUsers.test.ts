/**
 * A local run's erasure subject exists only DURING the run (owner rulings 2026-11-06 and 2026-11-07). The run records
 * the exact Clerk user id it created, the moment Clerk returns it, and at the end deletes that id, if it still exists,
 * and nothing else. It never deletes by email or pattern, and never a user it did not create: a subject already standing
 * that no record names is refused, and a record that names anyone but a local erasure subject is refused too.
 */
import { closeSync, fstatSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObservedPoolUser, PoolAdminPort, PoolUserCreate } from '../src/poolAdmin.js';
import {
    createRunErasureSubject,
    deleteRunUsers,
    fileRunUserRecord,
    parseRunUsersArgs,
    type RecordedRunUser,
    type RunUserRecord,
} from '../src/runUsers.js';
import { maestroErasureSlots, maestroSlotForShard } from '../src/testPool.js';

/** Clerk's answer to an id it does not hold. */
const notFound = (id: string): Error => Object.assign(new Error(`no user ${id}`), { status: 404 });

/** An in-memory Clerk with every call recorded. Deleting an id it does not hold fails, as Clerk does. */
function fakeClerk(initial: readonly ObservedPoolUser[] = []) {
    const users = [...initial];
    const calls: string[] = [];
    let next = 1;
    const port: PoolAdminPort = {
        findUsers: vi.fn(async (email: string) => {
            calls.push(`find ${email}`);

            return users.filter((user) => user.emails.includes(email));
        }),
        listUsers: vi.fn(async () => {
            throw new Error('a run-user operation must never list the instance');
        }),
        createUser: vi.fn(async (input: PoolUserCreate) => {
            const id = `user_new${next++}`;
            calls.push(`create ${id}`);
            users.push({
                id,
                emails: [...input.emailAddress],
                publicMetadata: { ...input.publicMetadata },
                externalId: null,
            });

            return { id };
        }),
        mergeMetadata: vi.fn(async (id: string) => {
            calls.push(`merge ${id}`);
        }),
        readExternalId: vi.fn(async (id: string) => users.find((user) => user.id === id)?.externalId ?? null),
        writeExternalId: vi.fn(async (id: string, externalId: string) => {
            calls.push(`externalId ${id} ${externalId}`);
            const index = users.findIndex((user) => user.id === id);
            const found = users[index];

            if (found === undefined) {
                throw notFound(id);
            }

            users[index] = { ...found, externalId };
        }),
        findUserById: vi.fn(async (id: string) => users.find((user) => user.id === id)),
        deleteUser: vi.fn(async (id: string) => {
            const index = users.findIndex((user) => user.id === id);

            if (index === -1) {
                throw notFound(id);
            }

            calls.push(`delete ${id}`);
            users.splice(index, 1);
        }),
        reassertProfile: vi.fn(async (id: string) => {
            calls.push(`reassert ${id}`);
        }),
    };

    return { users, calls, port };
}

/** An in-memory record that notes each write among the Clerk calls, so their order can be asserted. */
function memoryRecord(
    calls: string[],
    initial: readonly RecordedRunUser[] = [],
): RunUserRecord & { readonly users: readonly RecordedRunUser[] } {
    let state = [...initial];

    return {
        get users() {
            return state;
        },
        read: () => state,
        write: (users) => {
            calls.push(`record ${users.map((user) => user.id).join(',') || '-'}`);
            state = [...users];
        },
    };
}

const options = { mint: () => '01HMINTED', randomPassword: () => 'Pp1!x', now: () => 0 };
const subjectEmail = (platform: 'android' | 'ios' = 'android'): string =>
    maestroErasureSlots(platform, 1)[0]?.email ?? 'no subject';
const standing = (id: string, email: string): ObservedPoolUser => ({
    id,
    emails: [email],
    publicMetadata: {},
    externalId: 'x',
});
const writes = (calls: readonly string[]): readonly string[] =>
    calls.filter((call) => /^(create|delete|merge|externalId|reassert)/u.test(call));

beforeEach(() => {
    vi.stubEnv('E2E_POOL_NAMESPACE', 'local');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('createRunErasureSubject', () => {
    it("creates the platform's local subject, records its id the moment Clerk returns it, then mints its external id", async () => {
        const { calls, port, users } = fakeClerk();
        const record = memoryRecord(calls);

        const id = await createRunErasureSubject(port, { ...options, platform: 'android', record });

        expect(subjectEmail()).toMatch(/^test-local-erasure/u);
        expect(id).toBe('user_new1');
        expect(record.users).toEqual([
            { id: 'user_new1', email: subjectEmail(), createdAt: '1970-01-01T00:00:00.000Z' },
        ]);
        expect(calls.slice(calls.indexOf('create user_new1'))).toEqual([
            'create user_new1',
            'record user_new1',
            'externalId user_new1 01HMINTED',
        ]);
        expect(users.map((user) => [user.emails[0], user.externalId])).toEqual([[subjectEmail(), '01HMINTED']]);
    });

    it('makes the iOS subject for an iOS run', async () => {
        const { calls, port, users } = fakeClerk();

        await createRunErasureSubject(port, { ...options, platform: 'ios', record: memoryRecord(calls) });

        expect(users.map((user) => user.emails[0])).toEqual([subjectEmail('ios')]);
    });

    it('⛔ refuses a subject that already stands and no record names, writing nothing to it or anyone', async () => {
        const { calls, port } = fakeClerk([standing('user_someoneElses', subjectEmail())]);
        const record = memoryRecord(calls);

        await expect(createRunErasureSubject(port, { ...options, platform: 'android', record })).rejects.toThrow(
            /user_someoneElses/u,
        );
        expect(writes(calls)).toEqual([]);
        expect(record.users).toEqual([]);
    });

    it('first deletes, by its id, the subject a crashed run recorded, then makes a fresh one', async () => {
        const { calls, port } = fakeClerk([standing('user_crashed', subjectEmail())]);
        const record = memoryRecord(calls, [{ id: 'user_crashed', email: subjectEmail(), createdAt: 't' }]);

        await createRunErasureSubject(port, { ...options, platform: 'android', record });

        expect(writes(calls)).toEqual(['delete user_crashed', 'create user_new1', 'externalId user_new1 01HMINTED']);
        expect(record.users.map((user) => user.id)).toEqual(['user_new1']);
    });

    it('keeps the id in the record when minting the external id fails, so the end of the run still deletes it', async () => {
        const { calls, port } = fakeClerk();
        const record = memoryRecord(calls);
        const failing: PoolAdminPort = {
            ...port,
            writeExternalId: async () => {
                throw new Error('clerk down');
            },
        };

        await expect(createRunErasureSubject(failing, { ...options, platform: 'android', record })).rejects.toThrow(
            /clerk down/u,
        );
        expect(record.users.map((user) => user.id)).toEqual(['user_new1']);
    });

    it('refuses outside the local namespace, before any call', async () => {
        vi.stubEnv('E2E_POOL_NAMESPACE', '');
        const { calls, port } = fakeClerk();

        await expect(
            createRunErasureSubject(port, { ...options, platform: 'android', record: memoryRecord(calls) }),
        ).rejects.toThrow(/E2E_POOL_NAMESPACE=local/u);
        expect(calls).toEqual([]);
    });

    it('refuses a port that cannot mint the external id, before it creates anyone', async () => {
        const { calls, port } = fakeClerk();
        const { writeExternalId: _unused, ...cannotMint } = port;

        await expect(
            createRunErasureSubject(cannotMint, { ...options, platform: 'android', record: memoryRecord(calls) }),
        ).rejects.toThrow(/writeExternalId/u);
        expect(writes(calls)).toEqual([]);
    });
});

describe('deleteRunUsers', () => {
    it('deletes exactly the recorded ids that still exist, by id, and empties the record', async () => {
        const { calls, port, users } = fakeClerk([
            standing('user_ours', subjectEmail()),
            standing('user_other', subjectEmail()),
            standing('user_ios', subjectEmail('ios')),
        ]);
        const record = memoryRecord(calls, [
            { id: 'user_ours', email: subjectEmail(), createdAt: 't' },
            { id: 'user_gone', email: subjectEmail(), createdAt: 't' },
        ]);

        expect(await deleteRunUsers(port, record)).toEqual(['user_ours']);
        expect(users.map((user) => user.id)).toEqual(['user_other', 'user_ios']);
        expect(calls.filter((call) => call.startsWith('find '))).toEqual([]);
        expect(record.users).toEqual([]);
    });

    it('does nothing, and calls nothing, when the record is empty', async () => {
        const { calls, port } = fakeClerk([standing('user_other', subjectEmail())]);

        expect(await deleteRunUsers(port, memoryRecord(calls))).toEqual([]);
        expect(calls).toEqual([]);
    });

    it('⛔ refuses a recorded id whose user does not hold the recorded address, and deletes nothing', async () => {
        const owner = 'owner@example.com';
        const { calls, port, users } = fakeClerk([standing('user_owner', owner)]);
        const record = memoryRecord(calls, [{ id: 'user_owner', email: subjectEmail(), createdAt: 't' }]);

        await expect(deleteRunUsers(port, record)).rejects.toThrow(/user_owner/u);
        expect(users.map((user) => user.id)).toEqual(['user_owner']);
        expect(record.users.map((user) => user.id)).toEqual(['user_owner']);
    });

    it('⛔ refuses a record that names an address that is not a local erasure subject, before any call', async () => {
        const signer = maestroSlotForShard('signer', 'android', 1).email;
        const { calls, port, users } = fakeClerk([standing('user_signer', signer)]);
        const record = memoryRecord(calls, [{ id: 'user_signer', email: signer, createdAt: 't' }]);

        await expect(deleteRunUsers(port, record)).rejects.toThrow(/not a local erasure subject/u);
        expect(users.map((user) => user.id)).toEqual(['user_signer']);
        expect(port.findUserById).not.toHaveBeenCalled();
    });

    it('keeps the ids it could not delete in the record, and rethrows', async () => {
        const { calls, port } = fakeClerk([standing('user_ours', subjectEmail())]);
        const failing: PoolAdminPort = {
            ...port,
            deleteUser: async () => {
                throw new Error('clerk down');
            },
        };
        const record = memoryRecord(calls, [{ id: 'user_ours', email: subjectEmail(), createdAt: 't' }]);

        await expect(deleteRunUsers(failing, record)).rejects.toThrow(/clerk down/u);
        expect(record.users.map((user) => user.id)).toEqual(['user_ours']);
    });

    it('refuses outside the local namespace', async () => {
        vi.stubEnv('E2E_POOL_NAMESPACE', '');
        const { calls, port } = fakeClerk();
        const record = memoryRecord(calls, [{ id: 'user_x', email: 'test-local-erasure01@x', createdAt: 't' }]);

        await expect(deleteRunUsers(port, record)).rejects.toThrow(/E2E_POOL_NAMESPACE=local/u);
        expect(calls.filter((call) => !call.startsWith('record'))).toEqual([]);
    });
});

describe('fileRunUserRecord — the record on disk', () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    const scratch = (): string => {
        const dir = mkdtempSync(path.join(tmpdir(), 'runUsers-'));
        dirs.push(dir);

        return dir;
    };

    it('reads a missing file as no users, and creates its directory on the first write', () => {
        const file = path.join(scratch(), 'nested', 'runUsers.android.json');
        const record = fileRunUserRecord(file);

        expect(record.read()).toEqual([]);
        record.write([{ id: 'user_a', email: 'e', createdAt: 't' }]);
        expect(fileRunUserRecord(file).read()).toEqual([{ id: 'user_a', email: 'e', createdAt: 't' }]);
    });

    it('is readable by its owner only, and leaves no temporary file behind', () => {
        const dir = scratch();
        const file = path.join(dir, 'runUsers.android.json');

        fileRunUserRecord(file).write([{ id: 'user_a', email: 'e', createdAt: 't' }]);

        const fd = openSync(file, 'r');
        try {
            expect(fstatSync(fd).mode & 0o777).toBe(0o600);
            expect(JSON.parse(readFileSync(fd, 'utf8'))).toEqual([{ id: 'user_a', email: 'e', createdAt: 't' }]);
        } finally {
            closeSync(fd);
        }
        expect(readdirSync(dir)).toEqual(['runUsers.android.json']);
    });

    it.each([
        ['not JSON', '{'],
        ['not a list', '{"id":"user_a"}'],
        ['an entry without an id', '[{"email":"e","createdAt":"t"}]'],
        ['an id of the wrong type', '[{"id":7,"email":"e","createdAt":"t"}]'],
    ])('⛔ refuses a damaged record (%s) rather than reading it as empty', (_label, text) => {
        const file = path.join(scratch(), 'runUsers.android.json');
        writeFileSync(file, text);

        expect(() => fileRunUserRecord(file).read()).toThrow(/run-user record/u);
    });
});

describe('parseRunUsersArgs', () => {
    it('reads the create door', () => {
        expect(
            parseRunUsersArgs([
                '--create-run-erasure-subject',
                '--platform',
                'ios',
                '--record',
                '/s/runUsers.ios.json',
            ]),
        ).toEqual({ kind: 'create', platform: 'ios', record: '/s/runUsers.ios.json' });
    });

    it('reads the delete door', () => {
        expect(parseRunUsersArgs(['--delete-run-users', '--record', '/s/runUsers.android.json'])).toEqual({
            kind: 'delete',
            record: '/s/runUsers.android.json',
        });
    });

    it.each([
        [['--create-run-erasure-subject', '--record', '/r']],
        [['--create-run-erasure-subject', '--platform', 'tvos', '--record', '/r']],
        [['--create-run-erasure-subject', '--platform', 'ios']],
        [['--delete-run-users']],
        [['--delete-run-users', '--record', '/r', '--platform', 'ios']],
        [['--delete-run-users', '--create-run-erasure-subject', '--platform', 'ios', '--record', '/r']],
        [['--delete-run-users', '--record', 'relative.json']],
        [['--delete-run-users', '--record', '/r', '--apply']],
    ])('refuses %j', (argv) => {
        expect(() => parseRunUsersArgs(argv)).toThrow(/runUsers/u);
    });
});
