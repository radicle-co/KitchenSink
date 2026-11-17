/**
 * `jsonBodyHttpSetup` over a real Nest app: the ordered setup every JSON-body service shares, proved on one tiny
 * controller so that no service has to re-prove the order.
 *
 * | Case                                                | Proves                                                          |
 * | --------------------------------------------------- | --------------------------------------------------------------- |
 * | a body over 100 kB from an allowed origin           | `413`, and the answer still carries `access-control-allow-origin` |
 * | malformed JSON                                      | the handler receives a refusal with none of the request's text   |
 * | the same refusal from an allowed origin             | `access-control-allow-origin` is present (CORS before the parser) |
 * | a form body                                         | is not parsed: Nest's default parser is off on purpose           |
 * | `configure`                                         | logs which CORS mode is live, through Nest's `Logger`            |
 * | `nestOptions` handed `bodyParser: true` past the type | still turns Nest's parser off: the setup's value is applied last |
 */
import type { AddressInfo } from 'node:net';

import { Logger, type ArgumentsHost, type ExceptionFilter, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response as ExpressResponse } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { GENERIC_STATUS_CODES, normalizeBodyParserError } from '@kitchensink/nest-error-envelope';
import { jsonBodyHttpSetup } from '../jsonBodyHttpSetup.js';

/** The origin the policy admits. */
const ALLOWED = 'http://allowed.test';

/** What reached the error handler, as Nest hands it over. */
const refusals: unknown[] = [];

/** Records each refusal, then answers it the way a service filter does. Catches everything: it has no `@Catch` filter. */
const recordingFilter: ExceptionFilter = {
    catch: (exception: unknown, host: ArgumentsHost): void => {
        refusals.push(exception);

        const failure = normalizeBodyParserError(exception, {
            validationFailedCode: 'VALIDATION_FAILED',
            statusCode: GENERIC_STATUS_CODES,
        });

        host.switchToHttp()
            .getResponse<ExpressResponse>()
            .status(failure?.status ?? 500)
            .json(failure?.body ?? { code: 'INTERNAL_ERROR' });
    },
};

/** A module with nothing in it: the probe route is registered on the HTTP adapter, so no decorator is needed. */
class ProbeModule {}

describe('jsonBodyHttpSetup', () => {
    let app: INestApplication;
    let baseUrl: string;
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    beforeAll(async () => {
        const setup = jsonBodyHttpSetup(() => ({ options: { origin: [ALLOWED] }, mode: 'test-mode' }));

        app = await NestFactory.create(ProbeModule, setup.nestOptions({ logger: false }));
        app.useGlobalFilters(recordingFilter);
        setup.configure(app);
        app.getHttpAdapter().post('/probe', (request: Request, response: ExpressResponse) => {
            response.status(201).json({ received: request.body });
        });
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await app.close();
        log.mockRestore();
    });

    const post = (body: string, headers: Record<string, string> = {}): Promise<Response> =>
        fetch(`${baseUrl}/probe`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body,
        });

    it('serves a well-formed JSON body to the route', async () => {
        const response = await post('{"a":1}');

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ received: { a: 1 } });
    });

    // The cap is a boundary, so both sides of it are pinned: a body just under it reaches the route.
    it('accepts a body just under 100 kB', async () => {
        const body = { padding: 'a'.repeat(99_000) };
        const response = await post(JSON.stringify(body));

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ received: body });
    });

    it('⛔ answers a body over 100 kB with 413, still carrying the allowed origin', async () => {
        const response = await post(JSON.stringify({ padding: 'a'.repeat(150_000) }), { origin: ALLOWED });

        expect(response.status).toBe(413);
        expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    });

    it('⛔ answers malformed JSON with 400, still carrying the allowed origin', async () => {
        const response = await post('{"t": MARKER}', { origin: ALLOWED });

        expect(response.status).toBe(400);
        expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    });

    it('⛔ hands the error handler a malformed-JSON refusal that carries none of the request', async () => {
        refusals.length = 0;
        await post('{"t": MARKER}');

        expect(refusals).toHaveLength(1);
        expect(JSON.stringify(refusals[0])).not.toContain('MARKER');
        expect(refusals[0]).not.toHaveProperty('message');
        expect(refusals[0]).not.toHaveProperty('body');
    });

    it('does not parse a form body: the route sees no body', async () => {
        const response = await fetch(`${baseUrl}/probe`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'a=1',
        });

        expect((await response.json()) as unknown).toEqual({});
    });

    it('⛔ keeps Nest’s parser off even when a caller passes bodyParser past the type', () => {
        const setup = jsonBodyHttpSetup(() => ({ options: {}, mode: 'test-mode' }));
        // `Reflect.apply` stands in for an untyped caller: the type forbids `bodyParser`, so only this can pass it.
        const created: unknown = Reflect.apply(setup.nestOptions, undefined, [{ bodyParser: true, logger: false }]);

        expect(created).toEqual({ bodyParser: false, logger: false });
    });

    it('logs which CORS mode is live', () => {
        expect(log).toHaveBeenCalledWith('CORS origin mode: test-mode');
    });
});
