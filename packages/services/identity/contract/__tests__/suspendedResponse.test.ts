/**
 * ADR-0081: every authenticated identity operation publishes the `403 ACCOUNT_SUSPENDED` a suspended account's token gets.
 *
 * The guard answers it before any handler runs, so it belongs to the whole surface, not to a route. A consumer
 * reading the generated document must be able to see it on every operation it can call, public probes excepted.
 */
import { ACCOUNT_SUSPENDED_CODE } from '@kitchensink/clerk-verify';
import { describe, expect, it } from 'vitest';

import { identityOpenApiDocument } from '../openapi.js';

interface DocOperation {
    readonly operationId: string;
    readonly security?: readonly Record<string, unknown>[];
    readonly responses: Readonly<Record<string, { readonly description: string }>>;
}

const operations = (): readonly DocOperation[] => {
    const paths = identityOpenApiDocument.document['paths'] as Record<string, Record<string, DocOperation>>;

    return Object.values(paths).flatMap((methods) => Object.values(methods));
};

/** The operations a Clerk session token reaches: public probes (`security: []`) and service-token routes are out. */
const clerkOperations = (): readonly DocOperation[] =>
    operations().filter(
        (operation) =>
            operation.security === undefined ||
            operation.security.some((requirement) => Object.keys(requirement).includes('clerkSession')),
    );

describe('identity contract — the suspended-account 403', () => {
    it('finds authenticated operations to check (non-vacuity)', () => {
        expect(clerkOperations().length).toBeGreaterThan(5);
    });

    it('⛔ every Clerk-authenticated operation documents 403 ACCOUNT_SUSPENDED', () => {
        const missing = clerkOperations()
            .filter((operation) => !(operation.responses['403']?.description ?? '').includes(ACCOUNT_SUSPENDED_CODE))
            .map((operation) => operation.operationId);

        expect(missing).toStrictEqual([]);
    });

    it('keeps the admin scope meaning where a route already had a 403', () => {
        const adminOperation = clerkOperations().find((operation) =>
            (operation.responses['403']?.description ?? '').includes('admin:users'),
        );

        expect(adminOperation?.responses['403']?.description).toContain(ACCOUNT_SUSPENDED_CODE);
    });
});
