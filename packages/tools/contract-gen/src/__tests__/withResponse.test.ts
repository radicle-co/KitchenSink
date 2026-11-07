import { describe, expect, it } from 'vitest';

import { withResponseOnOperations, type OpenApiOperation } from '../openapi.js';

type Names = 'ApiError' | 'Thing';

const operation = (
    operationId: string,
    responses: OpenApiOperation<Names>['responses'],
    security?: readonly string[],
): OpenApiOperation<Names> => ({
    operationId,
    summary: operationId,
    responses,
    ...(security === undefined ? {} : { security }),
});

const suspended = { description: 'The account is suspended (`code: ACCOUNT_SUSPENDED`).', schema: 'ApiError' } as const;
const rule = {
    status: '403',
    response: suspended,
    appliesTo: (op: OpenApiOperation<Names>) => op.security === undefined,
};

describe('withResponseOnOperations', () => {
    it('adds the response to an operation that has none at that status', () => {
        const paths = { '/a': { get: operation('getA', { '200': { description: 'ok', schema: 'Thing' } }) } };

        const result = withResponseOnOperations(paths, rule);

        expect(result['/a']?.get?.responses['403']).toStrictEqual(suspended);
        expect(result['/a']?.get?.responses['200']).toStrictEqual({ description: 'ok', schema: 'Thing' });
    });

    it('keeps what an operation already says at that status and appends the new meaning', () => {
        const paths = {
            '/a': { post: operation('postA', { '403': { description: 'Not the owner.', schema: 'ApiError' } }) },
        };

        const result = withResponseOnOperations(paths, rule);

        expect(result['/a']?.post?.responses['403']?.description).toBe(
            'Not the owner. Or: The account is suspended (`code: ACCOUNT_SUSPENDED`).',
        );
        expect(result['/a']?.post?.responses['403']?.schema).toBe('ApiError');
    });

    it('leaves an operation the predicate refuses (a public probe) untouched', () => {
        const paths = { '/health': { get: operation('getHealth', { '200': { description: 'ok' } }, []) } };

        const result = withResponseOnOperations(paths, rule);

        expect(result['/health']?.get?.responses).toStrictEqual({ '200': { description: 'ok' } });
    });

    it('does not mutate its input', () => {
        const paths = { '/a': { get: operation('getA', { '200': { description: 'ok' } }) } };

        withResponseOnOperations(paths, rule);

        expect(Object.keys(paths['/a'].get.responses)).toStrictEqual(['200']);
    });
});
