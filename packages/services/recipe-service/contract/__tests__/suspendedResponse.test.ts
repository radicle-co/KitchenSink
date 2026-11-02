/**
 * ADR-0081: every Clerk-authenticated recipe operation publishes the `403 ACCOUNT_SUSPENDED` a suspended account's token
 * gets. The auth middleware answers it before any handler runs, so it belongs to the whole surface, not to a route.
 */
import { ACCOUNT_SUSPENDED_CODE } from '@kitchensink/clerk-verify';
import { describe, expect, it } from 'vitest';

import { buildRecipeOpenApiDocument } from '../openapi.js';

interface DocOperation {
    readonly operationId: string;
    readonly security?: readonly Record<string, unknown>[];
    readonly responses: Readonly<Record<string, { readonly description: string }>>;
}

const clerkOperations = (): readonly DocOperation[] => {
    const paths = buildRecipeOpenApiDocument().document['paths'] as Record<string, Record<string, DocOperation>>;

    return Object.values(paths)
        .flatMap((methods) => Object.values(methods))
        .filter(
            (operation) =>
                operation.security === undefined ||
                operation.security.some((requirement) => Object.keys(requirement).includes('clerkSessionToken')),
        );
};

describe('recipe contract — the suspended-account 403', () => {
    it('finds authenticated operations to check (non-vacuity)', () => {
        expect(clerkOperations().length).toBeGreaterThan(20);
    });

    it('⛔ every Clerk-authenticated operation documents 403 ACCOUNT_SUSPENDED', () => {
        const missing = clerkOperations()
            .filter((operation) => !(operation.responses['403']?.description ?? '').includes(ACCOUNT_SUSPENDED_CODE))
            .map((operation) => operation.operationId);

        expect(missing).toStrictEqual([]);
    });

    it('keeps a route-specific 403 meaning where there was one', () => {
        const created = clerkOperations().find((operation) => operation.operationId === 'createRecipe');

        expect(created?.responses['403']?.description).toContain('PRIVATE_SLOTS_FULL');
        expect(created?.responses['403']?.description).toContain(ACCOUNT_SUSPENDED_CODE);
    });
});
