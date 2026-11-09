/**
 * The publication flow against a REAL migrated database (ADR-0029 §5, §7; migration 0028): an author's edit, the
 * request, staff approval and decline, withdrawal — and what every reader sees at each step.
 *
 * Claims only the database can prove: the row lock that makes "newest version" and "not withdrawn" hold at approval,
 * the live row staying the approved version while an edit is pending, and approval writing the snapshot's macros.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { AuthoredFoodsDao, type CreateAuthoredInput } from '../../src/foods/dao/authoredFoods.dao.js';
import { PublicationRequestsDao } from '../../src/foods/dao/publicationRequests.dao.js';
import { makeDb, makePool, type TestDb } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';

const AUTHOR = '01JPUBFLOWAUTHOR0000000AA';
const STRANGER = '01JPUBFLOWSTRANGER00000AAA';

const blend = (overrides: Partial<CreateAuthoredInput> = {}): CreateAuthoredInput => ({
    userId: AUTHOR,
    name: 'Grandma blend',
    normalizedName: 'grandma blend',
    description: null,
    macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 1 },
    portions: [{ label: 'cup', gramWeight: 120 }],
    ...overrides,
});

describe('publication requests (real database)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let authored: AuthoredFoodsDao;
    let requests: PublicationRequestsDao;
    let foods: FoodDao;
    let id: string;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        authored = new AuthoredFoodsDao(db);
        requests = new PublicationRequestsDao(db);
        foods = new FoodDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
        const created = await authored.createAuthored(blend());

        if (created.kind !== 'created') {
            throw new Error('seed failed');
        }

        id = created.id;
    });

    const calories = async (): Promise<number> => {
        const [record] = await foods.readNutritionBatch([id]);
        const value = record?.nutrients.find((nutrient) => nutrient.nutrient.toLowerCase().includes('energy'));

        return Number(value?.amount);
    };

    it('opens one request at the newest version, and answers the same one again', async () => {
        const first = await requests.request(id, AUTHOR);
        const again = await requests.request(id, AUTHOR);

        expect(first).toMatchObject({ kind: 'opened', request: { foodId: id, versionNumber: 1, status: 'pending' } });
        expect(again).toMatchObject({
            kind: 'existing',
            request: { id: (first as { request: { id: string } }).request.id },
        });
    });

    it('refuses a stranger as if the food did not exist', async () => {
        expect(await requests.request(id, STRANGER)).toStrictEqual({ kind: 'missing' });
    });

    it('a private edit applies now and moves a pending request onto the new version', async () => {
        await requests.request(id, AUTHOR);

        const edit = await authored.replaceAuthored({ ...blend(), id, macros: { ...blend().macros, calories: 150 } });
        const latest = await requests.latestFor(id, AUTHOR);

        expect(edit).toStrictEqual({ kind: 'replaced' });
        expect(latest?.request).toMatchObject({ versionNumber: 2, status: 'pending' });
        expect(latest?.snapshot.macros.calories).toBe(150);

        const closed = await pool.query(
            `SELECT count(*)::int AS n FROM food_publication_requests WHERE status = 'closed'`,
        );

        expect(closed.rows[0]).toEqual({ n: 1 });
    });

    it('approval promotes the food and every reader then sees it', async () => {
        const opened = await requests.request(id, AUTHOR);

        if (opened.kind !== 'opened') {
            throw new Error('no request');
        }

        expect(await foods.readNutritionBatch([id])).toHaveLength(0);

        const decided = await requests.decide(opened.request.id, { approve: true });

        expect(decided).toMatchObject({ kind: 'approved', request: { status: 'approved' } });

        const row = await pool.query(`SELECT visibility FROM food WHERE id = $1`, [id]);

        expect(row.rows[0]).toEqual({ visibility: 'promoted' });
        expect(await foods.readNutritionBatch([id])).toHaveLength(1);
    });

    it('a promoted food is edited only as a proposal; the live row stays the approved version until approval', async () => {
        const opened = await requests.request(id, AUTHOR);

        if (opened.kind !== 'opened') {
            throw new Error('no request');
        }

        await requests.decide(opened.request.id, { approve: true });
        const before = await calories();

        const edit = await authored.replaceAuthored({
            ...blend({ name: 'Grandma blend v2', normalizedName: 'grandma blend v2' }),
            id,
            macros: { ...blend().macros, calories: 300 },
        });

        expect(edit).toStrictEqual({ kind: 'proposed', versionNumber: 2 });
        expect(await calories()).toBe(before);

        const live = await pool.query(`SELECT name FROM food WHERE id = $1`, [id]);

        expect(live.rows[0]).toEqual({ name: 'Grandma blend' });

        const pending = await requests.listPending();

        expect(pending).toHaveLength(1);
        expect(pending[0]).toMatchObject({ liveName: 'Grandma blend', request: { versionNumber: 2 } });

        await requests.decide(pending[0]?.request.id ?? '', { approve: true });

        expect(await calories()).toBe(300);
        expect((await pool.query(`SELECT name FROM food WHERE id = $1`, [id])).rows[0]).toEqual({
            name: 'Grandma blend v2',
        });
    });

    it('a declined proposal leaves the live row alone, and a newer edit closes an older pending request', async () => {
        const opened = await requests.request(id, AUTHOR);

        if (opened.kind !== 'opened') {
            throw new Error('no request');
        }

        await requests.decide(opened.request.id, { approve: true });
        const before = await calories();

        await authored.replaceAuthored({ ...blend(), id, macros: { ...blend().macros, calories: 301 } });
        await authored.replaceAuthored({ ...blend(), id, macros: { ...blend().macros, calories: 302 } });

        const pending = await requests.listPending();

        expect(pending).toHaveLength(1);
        expect(pending[0]?.request.versionNumber).toBe(3);

        expect(await requests.decide(pending[0]?.request.id ?? '', { decline: 'Calories look wrong' })).toMatchObject({
            kind: 'declined',
            request: { status: 'declined', declineReason: 'Calories look wrong' },
        });
        expect(await calories()).toBe(before);
    });

    it('refuses to approve a request whose version is no longer the newest, and keeps it open', async () => {
        const opened = await requests.request(id, AUTHOR);

        if (opened.kind !== 'opened') {
            throw new Error('no request');
        }

        // A version inserted behind the policy's back, as a racing writer would.
        await pool.query(
            `INSERT INTO food_versions (food_id, version_number, snapshot, created_by) VALUES ($1, 2, '{}'::jsonb, $2)`,
            [id, AUTHOR],
        );

        expect(await requests.decide(opened.request.id, { approve: true })).toStrictEqual({
            kind: 'refused',
            reason: 'notNewest',
        });
        expect((await pool.query(`SELECT status FROM food_publication_requests`)).rows[0]).toEqual({
            status: 'pending',
        });
    });

    it('a withdrawn food cannot be approved, and withdrawal closes its pending request', async () => {
        const opened = await requests.request(id, AUTHOR);

        if (opened.kind !== 'opened') {
            throw new Error('no request');
        }

        await pool.query(`UPDATE food SET status = 'WITHDRAWN', withdrawn_at = now() WHERE id = $1`, [id]);

        expect(await requests.decide(opened.request.id, { approve: true })).toStrictEqual({
            kind: 'refused',
            reason: 'withdrawn',
        });

        await authored.closePendingRequests(id);

        expect((await pool.query(`SELECT status FROM food_publication_requests`)).rows[0]).toEqual({
            status: 'closed',
        });
    });

    it('a declined private version cannot be asked again until the author edits', async () => {
        const opened = await requests.request(id, AUTHOR);

        if (opened.kind !== 'opened') {
            throw new Error('no request');
        }

        await requests.decide(opened.request.id, { decline: 'No' });

        expect(await requests.request(id, AUTHOR)).toStrictEqual({ kind: 'refused', reason: 'declined' });

        await authored.replaceAuthored({ ...blend(), id, macros: { ...blend().macros, calories: 111 } });

        expect(await requests.request(id, AUTHOR)).toMatchObject({ kind: 'opened', request: { versionNumber: 2 } });
    });

    it('an approval whose name now collides answers duplicate and stays pending', async () => {
        const opened = await requests.request(id, AUTHOR);

        if (opened.kind !== 'opened') {
            throw new Error('no request');
        }

        await requests.decide(opened.request.id, { approve: true });
        const other = await authored.createAuthored(blend({ name: 'Other', normalizedName: 'other' }));

        if (other.kind !== 'created') {
            throw new Error('seed failed');
        }

        await authored.replaceAuthored({ ...blend({ name: 'Other', normalizedName: 'other' }), id });
        const pending = await requests.listPending();

        expect(await requests.decide(pending[0]?.request.id ?? '', { approve: true })).toMatchObject({
            kind: 'duplicate',
            existingId: other.id,
        });
        expect(await requests.listPending()).toHaveLength(1);
    });

    describe('the author list and the unseen-decision count (revision 4, F19)', () => {
        const create = async (name: string): Promise<string> => {
            const made = await authored.createAuthored(blend({ name, normalizedName: name.toLowerCase() }));

            if (made.kind !== 'created') {
                throw new Error('seed failed');
            }

            return made.id;
        };

        it('lists the author’s own foods newest first with their publication state, and pages by cursor', async () => {
            const second = await create('Second');
            const third = await create('Third');
            const opened = await requests.request(second, AUTHOR);

            if (opened.kind !== 'opened') {
                throw new Error('no request');
            }

            await authored.createAuthored({
                ...blend({ name: 'Stranger food', normalizedName: 'stranger food' }),
                userId: STRANGER,
            });

            const first = await authored.listOwn(AUTHOR, { limit: 2 });

            expect(first.items.map((item) => item.name)).toEqual(['Third', 'Second']);
            expect(first.items.map((item) => item.publicationState)).toEqual(['private', 'asked']);
            expect(first.items[0]).toMatchObject({ id: third, updatedAt: expect.any(String) });
            expect(first.nextCursor).toEqual(expect.any(String));

            const rest = await authored.listOwn(AUTHOR, { limit: 2, cursor: first.nextCursor });

            expect(rest.items.map((item) => item.name)).toEqual(['Grandma blend']);
            expect(rest.nextCursor).toBeUndefined();
        });

        it('lists a withdrawn food as withdrawn', async () => {
            await pool.query(`UPDATE food SET status = 'WITHDRAWN', withdrawn_at = now() WHERE id = $1`, [id]);

            expect((await authored.listOwn(AUTHOR, { limit: 10 })).items[0]?.publicationState).toBe('withdrawn');
        });

        it('counts decided requests the author has not opened, and opening the food clears them', async () => {
            const opened = await requests.request(id, AUTHOR);

            if (opened.kind !== 'opened') {
                throw new Error('no request');
            }

            expect((await authored.listOwn(AUTHOR, { limit: 10 })).unseenDecisions).toBe(0);

            await requests.decide(opened.request.id, { approve: true });

            const before = await authored.listOwn(AUTHOR, { limit: 10 });

            expect(before.unseenDecisions).toBe(1);
            expect(before.items[0]?.publicationState).toBe('public');
            expect((await authored.listOwn(STRANGER, { limit: 10 })).unseenDecisions).toBe(0);

            await authored.markSeen(id, STRANGER);
            expect((await authored.listOwn(AUTHOR, { limit: 10 })).unseenDecisions).toBe(1);

            await authored.markSeen(id, AUTHOR);
            expect((await authored.listOwn(AUTHOR, { limit: 10 })).unseenDecisions).toBe(0);
        });

        it('a newer decision is unseen again, and a pending request is never counted', async () => {
            const opened = await requests.request(id, AUTHOR);

            if (opened.kind !== 'opened') {
                throw new Error('no request');
            }

            await requests.decide(opened.request.id, { approve: true });
            await authored.markSeen(id, AUTHOR);
            await authored.replaceAuthored({ ...blend(), id, macros: { ...blend().macros, calories: 222 } });

            expect((await authored.listOwn(AUTHOR, { limit: 10 })).unseenDecisions).toBe(0);

            const [pending] = await requests.listPending();
            await requests.decide(pending?.request.id ?? '', { decline: 'No' });

            const after = await authored.listOwn(AUTHOR, { limit: 10 });

            expect(after.unseenDecisions).toBe(1);
            expect(after.items[0]?.publicationState).toBe('editNotApproved');
        });
    });
});
