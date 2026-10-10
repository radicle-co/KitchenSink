/**
 * Unit coverage for {@link DatabaseModule}'s pool wiring: the pool it provides is prewarmed to the floor at boot, and
 * closed with the app. The pool's own behaviour is `apiPool.test.ts`'s; this file proves the module uses it.
 *
 * The prewarm is replaced, so nothing connects: the pool itself is real and lazy.
 */
import { NestFactory } from '@nestjs/core';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FOOD_API_POOL_MIN } from '../apiPool.js';
import { DatabaseModule, PgPoolProvider } from '../database.module.js';

const prewarm = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../apiPool.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../apiPool.js')>()),
    prewarmPool: prewarm,
}));

const SAVED_URL = process.env['DATABASE_URL'];

beforeEach(() => {
    prewarm.mockClear();
    process.env['DATABASE_URL'] = 'postgresql://food_app:pw@127.0.0.1:1/kitchensink_food';
});

afterEach(() => {
    if (SAVED_URL === undefined) {
        delete process.env['DATABASE_URL'];
    } else {
        process.env['DATABASE_URL'] = SAVED_URL;
    }
});

describe('DatabaseModule', () => {
    it('prewarms the pool it provides to the floor', async () => {
        const app = await NestFactory.createApplicationContext(DatabaseModule, { logger: false });
        const pool = app.get<pg.Pool>(PgPoolProvider);

        expect(prewarm).toHaveBeenCalledTimes(1);
        expect(prewarm).toHaveBeenCalledWith(pool, FOOD_API_POOL_MIN, expect.anything());

        await app.close();
    });

    it('closes the pool when the app closes', async () => {
        const app = await NestFactory.createApplicationContext(DatabaseModule, { logger: false });
        const pool = app.get<pg.Pool>(PgPoolProvider);

        await app.close();

        expect(pool.ended).toBe(true);
    });
});
