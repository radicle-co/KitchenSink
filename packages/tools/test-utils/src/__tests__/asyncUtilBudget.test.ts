import { getConfig } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ASYNC_UTIL_TIMEOUT_MS, configureAsyncUtilBudget } from '../asyncUtilBudget.js';

describe('configureAsyncUtilBudget', () => {
    it("raises Testing Library's async-util budget from its 1000 ms default to the shared figure", () => {
        configureAsyncUtilBudget();

        expect(ASYNC_UTIL_TIMEOUT_MS).toBe(5_000);
        expect(getConfig().asyncUtilTimeout).toBe(ASYNC_UTIL_TIMEOUT_MS);
    });
});
