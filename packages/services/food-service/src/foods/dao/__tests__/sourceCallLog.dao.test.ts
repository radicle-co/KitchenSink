/**
 * Unit coverage for admission's time bound (ADR-0053 §5). Admission runs inside the source client's request deadline
 * and ignores its abort signal, so the worst case it can spend (a connection, the lock wait, and every statement under
 * `statement_timeout`) must end before that deadline does. The statement count is pinned against the real statements
 * by `tests/e2e/sourceAdmission.e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { USDA_REQUEST_TIMEOUT_MS } from '@kitchensink/usda-client';

import { FOOD_POOL_CONNECT_TIMEOUT_MS, FOOD_POOL_QUERY_TIMEOUT_MS } from '../../../database/poolConfig.js';
import { RECORD_LOCK_TIMEOUT_MS, RECORD_STATEMENT_TIMEOUT_MS, RECORD_TIMED_STATEMENTS } from '../sourceBackoff.dao.js';
import {
    ADMISSION_LOCK_TIMEOUT_MS,
    ADMISSION_STATEMENT_TIMEOUT_MS,
    ADMISSION_TIMED_STATEMENTS,
} from '../sourceCallLog.dao.js';

describe('admission time bound', () => {
    it('ends before the source client gives up: connect + lock + every timed statement', () => {
        const worstCase =
            FOOD_POOL_CONNECT_TIMEOUT_MS +
            ADMISSION_LOCK_TIMEOUT_MS +
            ADMISSION_TIMED_STATEMENTS * ADMISSION_STATEMENT_TIMEOUT_MS;

        expect(worstCase).toBeLessThan(USDA_REQUEST_TIMEOUT_MS);
    });
});

describe('block-write time bound', () => {
    // The write runs after the source answered, on its own connection, so it cannot fit inside the deadline admission
    // already spent. What it can promise is that a stalled ledger holds a call for less than one more deadline.
    it('ends within one source deadline: connect + every timed statement', () => {
        const worstCase = FOOD_POOL_CONNECT_TIMEOUT_MS + RECORD_TIMED_STATEMENTS * RECORD_STATEMENT_TIMEOUT_MS;

        expect(worstCase).toBeLessThan(USDA_REQUEST_TIMEOUT_MS);
    });

    it('waits for the row lock for less than the statement may run, so a held lock answers as a lock failure', () => {
        expect(RECORD_LOCK_TIMEOUT_MS).toBeLessThan(RECORD_STATEMENT_TIMEOUT_MS);
    });
});

describe('the pool backstop', () => {
    // `query_timeout` is the client-side net under every query on a food pool. It must never fire before a bound a
    // query sets for itself, or a lock wait would read as a lost server.
    it('fires only after the longest wait a bounded query is allowed', () => {
        expect(FOOD_POOL_QUERY_TIMEOUT_MS).toBeGreaterThan(
            Math.max(
                ADMISSION_LOCK_TIMEOUT_MS,
                ADMISSION_STATEMENT_TIMEOUT_MS,
                RECORD_LOCK_TIMEOUT_MS,
                RECORD_STATEMENT_TIMEOUT_MS,
            ),
        );
    });
});
