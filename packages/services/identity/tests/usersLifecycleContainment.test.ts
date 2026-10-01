/**
 * `UsersService` consults the test-principal containment Specification (ADR-0040) BEFORE it touches anything.
 *
 * Under `enforce` a test principal's closure (`deleteUserMe`) and erasure (`eraseUserMe`) are refused with a `403`
 * carrying `code: 'TEST_PRINCIPAL_CONTAINED'`. "Before it touches anything" is the load-bearing half: a refusal that
 * arrived after the users-row read would still be correct on the wire, but one that arrived after the tombstone,
 * the S3 delete or the SQS message would have already banned or deleted a shared Clerk pool member. So every
 * collaborator here is a recorder that notes ANY property access — a refusal is only a pass when the database,
 * queue, resolver and object store were never so much as looked at.
 *
 * The allowed paths are pinned too: a test principal under `off`, and a real user under either mode, reach the
 * service's first database read exactly as before.
 */
import { ForbiddenException, type ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

import { identityOpenApiDocument } from '../contract/openapi.js';
import { ApiExceptionFilter } from '../src/common/filters/apiException.filter.js';
import { noopHandleSyncPublisher } from '../src/users/handleSync.publisher.js';
import { UsersService } from '../src/users/users.service.js';
import type { AuthorizerContext, UserId } from '../src/types/index.js';

/** Sentinel thrown by a recorder so an allowed path stops at its first collaborator touch. */
class CollaboratorTouched extends Error {
    constructor(readonly collaborator: string) {
        super(`collaborator touched: ${collaborator}`);
        Object.setPrototypeOf(this, CollaboratorTouched.prototype);
    }
}

/**
 * A collaborator double that records every property read and throws on it.
 *
 * @param name - The collaborator's label in the touch log.
 * @param touches - Where accesses are recorded.
 * @returns A proxy standing in for the collaborator.
 */
function recorder(name: string, touches: string[]): never {
    return new Proxy(
        {},
        {
            get(_target, property) {
                // `then` is probed by `await` on any value; it is not a use of the collaborator.
                if (property === 'then') {
                    return undefined;
                }

                touches.push(`${name}.${String(property)}`);

                throw new CollaboratorTouched(name);
            },
        },
    ) as never;
}

function makeService(touches: string[]): UsersService {
    return new UsersService(
        recorder('db', touches),
        recorder('sqs', touches),
        recorder('resolver', touches),
        noopHandleSyncPublisher,
        recorder('avatarStore', touches),
    );
}

function ctx(testPrincipal: boolean): AuthorizerContext {
    return {
        userId: '01HZZZZZZZZZZZZZZZZZZZZZZU' as UserId,
        email: 'pool-member@example.test',
        clerkUserId: 'user_pool_1',
        scopes: [],
        permissions: [],
        tokenType: 'user',
        testPrincipal,
    };
}

const LIFECYCLE_METHODS = ['deleteUserMe', 'eraseUserMe'] as const;

/** The status and body the identity filter would put on the wire for `error`. */
function renderOnWire(error: unknown): { status?: number; body?: unknown } {
    const captured: { status?: number; body?: unknown } = {};
    const res = {
        status(code: number) {
            captured.status = code;

            return res;
        },
        json(body: unknown) {
            captured.body = body;

            return res;
        },
    };
    const host = { switchToHttp: () => ({ getResponse: <T>() => res as unknown as T }) } as unknown as ArgumentsHost;

    new ApiExceptionFilter().catch(error, host);

    return captured;
}

describe('UsersService lifecycle actions — test-principal containment (ADR-0040)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe.each(LIFECYCLE_METHODS)('%s', (method) => {
        it.each([
            ['explicitly enforce', 'enforce'],
            ['unset (defaults to enforce)', undefined],
            ['unrecognised (fails closed to enforce)', 'Off'],
        ])('REFUSES a test principal when containment is %s, touching no collaborator', async (_label, mode) => {
            vi.stubEnv('TEST_PRINCIPAL_CONTAINMENT', mode);
            const touches: string[] = [];

            const service = makeService(touches);

            const error = await service[method](ctx(true)).then(
                () => undefined,
                (thrown: unknown) => thrown,
            );

            expect(touches).toStrictEqual([]);
            expect(error).toBeInstanceOf(ForbiddenException);
            expect(renderOnWire(error)).toStrictEqual({
                status: 403,
                body: { code: 'TEST_PRINCIPAL_CONTAINED', message: expect.any(String) },
            });
        });

        it('ADMITS a test principal when containment is off — the service proceeds to its first database read', async () => {
            vi.stubEnv('TEST_PRINCIPAL_CONTAINMENT', 'off');
            const touches: string[] = [];

            await expect(makeService(touches)[method](ctx(true))).rejects.toBeInstanceOf(CollaboratorTouched);
            expect(touches).toStrictEqual(['db.select']);
        });

        it.each(['enforce', 'off'])(
            'ADMITS a real user under %s — containment never reaches a real account',
            async (mode) => {
                vi.stubEnv('TEST_PRINCIPAL_CONTAINMENT', mode);
                const touches: string[] = [];

                await expect(makeService(touches)[method](ctx(false))).rejects.toBeInstanceOf(CollaboratorTouched);
                expect(touches).toStrictEqual(['db.select']);
            },
        );
    });

    // The published contract must say closure can answer this 403, or a client generated from it has no branch for
    // the one refusal a test run against prod will hit. (`POST me/erasure` is not in the document at all — a
    // pre-existing gap, not closed here.)
    it('documents the containment 403 on DELETE /api/v1/users/me in the published OpenAPI document', () => {
        const paths = identityOpenApiDocument.document['paths'] as Record<
            string,
            Record<string, { responses: Record<string, { description: string }> }>
        >;
        const forbidden = paths['/api/v1/users/me']?.['delete']?.responses['403'];

        expect(forbidden?.description).toContain('TEST_PRINCIPAL_CONTAINED');
    });
});
