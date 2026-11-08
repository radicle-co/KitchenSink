/**
 * RUN USERS: the Clerk users a LOCAL Maestro run makes for itself, and deletes when it ends.
 *
 * A local run's erasure subject exists only during the run (owner ruling 2026-11-06). The local stack runs no identity
 * deletion worker, so an erased subject would otherwise still stand in Clerk. The run therefore makes the subject itself
 * and deletes it at the end.
 *
 * ⛔ How it deletes is the ruling of 2026-11-07, verbatim: "Record the exact user id the run created, and at the end
 * delete that id only, if it still exists. Never delete by pattern or by email, and never touch any other user." So:
 *
 *   - The id is written to the record (a file, mode 600, replaced atomically) the moment Clerk returns it, before any
 *     other call, so a run that dies later still leaves the id behind for the next run to delete.
 *   - Only a recorded id is ever deleted, and only after a read by that id shows the user still holds the recorded
 *     address and that the address is a local erasure subject's. A damaged or hand-edited record cannot reach the
 *     owner's account or a lane signer.
 *   - A subject already standing that no record names was made by someone else. It is refused, never adopted and never
 *     deleted: a person decides about it.
 *
 * The record is the run's, not Clerk's: `poolAdmin` makes the lanes' standing users (signer, co-author) and never this
 * subject, and this module makes nothing else.
 *
 * ## Running it
 *
 *   E2E_POOL_NAMESPACE=local CLERK_SECRET_KEY=sk_test_… npx tsx packages/tools/e2e-fixtures/src/runUsers.ts \
 *       --create-run-erasure-subject --platform android --record ~/.local/state/kitchensink/localMaestro/runUsers.android.json
 *   … runUsers.ts --delete-run-users --record <the same file>
 *
 * Both doors write. There is no dry run, because each touches only the one user the record names.
 *
 * @pattern Repository — `RunUserRecord`, with `fileRunUserRecord` as its file adapter
 * @pattern Port — the Clerk calls go through `PoolAdminPort`, the same port `poolAdmin` provisions through
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { ulid } from 'ulidx';
import writeFileAtomic from 'write-file-atomic';

import { clerkPoolAdminPort, poolUserCreateInput, randomPoolPassword, type PoolAdminPort } from './poolAdmin.js';
import {
    isLocalNamespaceSlot,
    isMaestroPlatform,
    MAESTRO_ERASURE_SHARD,
    MAESTRO_PLATFORMS,
    maestroErasureSlots,
    poolNamespaceFrom,
    type MaestroPlatform,
    type PoolSlot,
} from './testPool.js';

/** One user a run made: its Clerk id, the address it was made with, and when. */
export interface RecordedRunUser {
    readonly id: string;
    readonly email: string;
    readonly createdAt: string;
}

/** Where a run keeps the ids it made. `write` replaces the whole list and must be durable when it returns. */
export interface RunUserRecord {
    read(): readonly RecordedRunUser[];
    write(users: readonly RecordedRunUser[]): void;
}

/**
 * The record as a JSON file.
 *
 * ⛔ A file that is present but damaged is REFUSED, never read as empty: an empty read would let the run make a second
 * subject while the first one's id is lost.
 *
 * @param file - An absolute path. Its directory is made on the first write.
 * @sideEffect `read` reads the file; `write` replaces it through `write-file-atomic` (a synced temporary file renamed
 *   over the record) and syncs the directory that holds the rename.
 */
export function fileRunUserRecord(file: string): RunUserRecord {
    return {
        read: () => {
            let text: string;

            try {
                text = readFileSync(file, 'utf8');
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                    return [];
                }

                throw error;
            }

            return parseRecord(text, file);
        },
        write: (users) => {
            mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
            writeFileAtomic.sync(file, `${JSON.stringify(users, null, 4)}\n`, { mode: 0o600 });
            // write-file-atomic syncs the file, not the directory the rename lives in: sync that too, or a power loss can
            // bring the old record back.
            const directory = openSync(path.dirname(file), 'r');

            try {
                fsyncSync(directory);
            } finally {
                closeSync(directory);
            }
        },
    };
}

/**
 * Read a record's text. Pure.
 *
 * shortcut: hand-checked rather than a zod schema, because this package has no zod and the shape is three strings this
 * module itself writes. Move to zod if the record grows.
 *
 * @throws When the text is not a list of `{ id, email, createdAt }` strings.
 */
function parseRecord(text: string, file: string): readonly RecordedRunUser[] {
    const damaged = (why: string): Error =>
        new Error(`runUsers: the run-user record ${file} is damaged (${why}) - read it, then fix or remove it by hand`);
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw damaged(error instanceof Error ? error.message : String(error));
    }

    if (!Array.isArray(parsed)) {
        throw damaged('it is not a list');
    }

    return parsed.map((entry: unknown, index): RecordedRunUser => {
        const notStrings = damaged(`entry ${index} is not { id, email, createdAt } strings`);

        if (
            typeof entry !== 'object' ||
            entry === null ||
            !('id' in entry && 'email' in entry && 'createdAt' in entry)
        ) {
            throw notStrings;
        }

        const { id, email, createdAt } = entry;

        if (typeof id !== 'string' || typeof email !== 'string' || typeof createdAt !== 'string') {
            throw notStrings;
        }

        return { id, email, createdAt };
    });
}

/**
 * The platform's LOCAL erasure subject slot.
 *
 * @throws When the local namespace is not active, before any call.
 */
function localErasureSlot(platform: MaestroPlatform): PoolSlot {
    const slot = maestroErasureSlots(platform, MAESTRO_ERASURE_SHARD)[0];

    if (poolNamespaceFrom(process.env) !== 'local' || slot === undefined || !isLocalNamespaceSlot(slot)) {
        throw new Error(
            'runUsers: only a local run makes or deletes its own erasure subject - set E2E_POOL_NAMESPACE=local',
        );
    }

    return slot;
}

/**
 * Make the platform's local erasure subject for this run, and record its id.
 *
 * Any id a crashed earlier run left in the record is deleted first, by id. Then the subject's address is looked up: a
 * holder there is a user no record names, and it is refused.
 *
 * @param port - Must be able to `writeExternalId`; to delete a crashed run's subject, also `findUserById` and `deleteUser`.
 * @param options.mint - The `external_id` to give the subject (the local namespace has no identity webhook to write it).
 * @returns The new user's id.
 * @throws Outside the local namespace, on a holder no record names, or when a Clerk call fails. An id Clerk returned is
 *   already in the record when any later step throws.
 * @sideEffect Reads and writes the record; reads Clerk; deletes recorded users; creates one Clerk user.
 */
export async function createRunErasureSubject(
    port: PoolAdminPort,
    options: {
        readonly platform: MaestroPlatform;
        readonly record: RunUserRecord;
        readonly mint: () => string;
        readonly randomPassword: () => string;
        readonly now: () => number;
    },
): Promise<string> {
    const slot = localErasureSlot(options.platform);
    const { writeExternalId } = port;

    if (writeExternalId === undefined) {
        throw new Error('runUsers: making a run erasure subject needs a port that can writeExternalId');
    }

    await deleteRunUsers(port, options.record);

    const holders = await port.findUsers(slot.email);

    if (holders.length > 0) {
        throw new Error(
            `runUsers: ${slot.email} is already held by ${holders.map((holder) => holder.id).join(', ')}, which no run ` +
                'recorded. This run did not make it, so it neither uses nor deletes it. Ask whoever made it, then delete ' +
                'it by hand in Clerk.',
        );
    }

    const { id } = await port.createUser(poolUserCreateInput(slot, options.randomPassword()));
    options.record.write([
        ...options.record.read(),
        { id, email: slot.email, createdAt: new Date(options.now()).toISOString() },
    ]);
    await writeExternalId(id, options.mint());

    return id;
}

/** Every local erasure subject's address, both platforms. Empty outside the local namespace. */
function localErasureAddresses(): ReadonlySet<string> {
    if (poolNamespaceFrom(process.env) !== 'local') {
        return new Set();
    }

    return new Set(
        MAESTRO_PLATFORMS.flatMap((platform) =>
            maestroErasureSlots(platform, MAESTRO_ERASURE_SHARD)
                .filter(isLocalNamespaceSlot)
                .map((slot) => slot.email),
        ),
    );
}

/**
 * Delete the users the record names that still exist, by id, and remove each from the record as it goes.
 *
 * ⛔ Every entry is checked first, before any call: its address must be a local erasure subject's. Then, per entry, a
 * read by id must show the user still holds that address. A failure leaves the entries not yet removed in the record.
 *
 * @returns The ids deleted (a recorded id Clerk no longer holds is dropped from the record without a delete).
 * @throws Outside the local namespace, on an entry that fails a check, or when a Clerk call fails.
 * @sideEffect Reads and writes the record; reads and deletes Clerk users.
 */
export async function deleteRunUsers(port: PoolAdminPort, record: RunUserRecord): Promise<readonly string[]> {
    const recorded = record.read();

    if (recorded.length === 0) {
        return [];
    }

    if (poolNamespaceFrom(process.env) !== 'local') {
        throw new Error('runUsers: only a local run deletes the users it recorded - set E2E_POOL_NAMESPACE=local');
    }

    const { findUserById, deleteUser } = port;

    if (findUserById === undefined || deleteUser === undefined) {
        throw new Error('runUsers: deleting run users needs a port that can findUserById and deleteUser');
    }

    const allowed = localErasureAddresses();
    const stranger = recorded.find((entry) => !allowed.has(entry.email));

    if (stranger !== undefined) {
        throw new Error(
            `runUsers: the record names ${stranger.id} at ${stranger.email}, which is not a local erasure subject's ` +
                'address. Nothing was deleted.',
        );
    }

    const deleted: string[] = [];
    let remaining = [...recorded];

    for (const entry of recorded) {
        const user = await findUserById(entry.id);

        if (user !== undefined) {
            if (!user.emails.includes(entry.email)) {
                throw new Error(
                    `runUsers: ${entry.id} no longer holds ${entry.email} (it holds ${user.emails.join(', ')}), so it is ` +
                        'not the user this run made. It was not deleted.',
                );
            }

            await deleteUser(entry.id);
            deleted.push(entry.id);
        }

        remaining = remaining.filter((other) => other !== entry);
        record.write(remaining);
    }

    return deleted;
}

/** The real sources of a run user's `external_id`, password and creation time. */
const RUN_USER_SOURCES = { mint: ulid, randomPassword: randomPoolPassword, now: Date.now } as const;

/** A parsed command line. */
export type RunUsersArgs =
    | { readonly kind: 'create'; readonly platform: MaestroPlatform; readonly record: string }
    | { readonly kind: 'delete'; readonly record: string };

/**
 * Read the command line. Pure.
 *
 * @throws On an unknown argument, both doors or neither, a missing or relative `--record`, or a create without a platform.
 */
export function parseRunUsersArgs(argv: readonly string[]): RunUsersArgs {
    let parsed;

    try {
        parsed = parseArgs({
            args: [...argv],
            strict: true,
            allowPositionals: false,
            options: {
                'create-run-erasure-subject': { type: 'boolean' },
                'delete-run-users': { type: 'boolean' },
                platform: { type: 'string' },
                record: { type: 'string' },
            },
        });
    } catch (error) {
        throw new Error(`runUsers: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }

    const { platform, record } = parsed.values;
    const create = parsed.values['create-run-erasure-subject'] === true;
    const remove = parsed.values['delete-run-users'] === true;

    if (record === undefined || !path.isAbsolute(record)) {
        throw new Error('runUsers: --record needs the absolute path of the run-user record');
    }

    if (create && !remove) {
        if (platform === undefined || !isMaestroPlatform(platform)) {
            throw new Error(`runUsers: --create-run-erasure-subject needs --platform ${MAESTRO_PLATFORMS.join('|')}`);
        }

        return { kind: 'create', platform, record };
    }

    if (remove && !create && platform === undefined) {
        return { kind: 'delete', record };
    }

    throw new Error(
        'runUsers: give --create-run-erasure-subject --platform P --record F, or --delete-run-users --record F',
    );
}

/**
 * The CLI.
 *
 * @sideEffect Reads the environment and the record, calls Clerk, writes to stdout, and sets the exit code.
 */
async function main(): Promise<void> {
    const args = parseRunUsersArgs(process.argv.slice(2));
    const secretKey = process.env['CLERK_SECRET_KEY'] ?? '';

    if (secretKey.trim() === '') {
        throw new Error('runUsers: CLERK_SECRET_KEY is required');
    }

    // It refuses a key that is not a development instance's.
    const port = clerkPoolAdminPort(secretKey);
    const record = fileRunUserRecord(args.record);

    if (args.kind === 'create') {
        const id = await createRunErasureSubject(port, { ...RUN_USER_SOURCES, platform: args.platform, record });
        console.log(`made the ${args.platform} run erasure subject ${id} (recorded in ${args.record})`);

        return;
    }

    const deleted = await deleteRunUsers(port, record);
    console.log(deleted.length === 0 ? 'no recorded run user to delete' : `deleted run users ${deleted.join(', ')}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
