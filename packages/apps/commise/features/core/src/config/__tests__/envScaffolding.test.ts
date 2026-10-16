import { describe, expect, it } from 'vitest';

import { endpointUrl, envValidationError } from '../envScaffolding.js';

describe('endpointUrl', () => {
    it('accepts absolute http and https origins', () => {
        expect(endpointUrl.safeParse('https://recipe.commise.app').success).toBe(true);
        expect(endpointUrl.safeParse('http://localhost:3000').success).toBe(true);
    });

    it('rejects a relative value and a non-http scheme', () => {
        expect(endpointUrl.safeParse('recipe.commise.app').success).toBe(false);
        expect(endpointUrl.safeParse('ftp://recipe.commise.app').success).toBe(false);
    });
});

describe('envValidationError', () => {
    it('names each offending variable once, whether the path segment is a key or a { key } object', () => {
        const error = envValidationError(
            [{ path: ['A_URL'] }, { path: [{ key: 'A_URL' }] }, { path: [{ key: 'B_KEY' }] }, {}],
            'Set them.',
        );

        expect(error.message).toBe('Invalid environment variables: A_URL, B_KEY. Set them.');
    });
});
