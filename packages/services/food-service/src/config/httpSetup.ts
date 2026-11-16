/**
 * THE ONE HTTP SETUP: how the app is created and which Express middleware it registers, in order. `main.ts` applies it,
 * and so does the mocked integration tier (`tests/support/mockedFoodsApi.ts`) and the e2e tier (`tests/e2e/harness.ts`),
 * so every tier serves requests through the stack production does.
 *
 * ⛔ THE ORDER IS LOAD-BEARING: CORS, then the JSON parser, then the strip link.
 *  - CORS FIRST. When the parser refuses a body it calls `next(err)`, and Express skips every non-error middleware after
 *    that. Registered after the parser, CORS never runs on a refusal, so a browser gets a `413` or `400` with no
 *    `access-control-allow-origin` and the web app reads "Failed to fetch" instead of the status.
 *  - THE SERVICE PARSES ITS OWN JSON (`bodyParser: false`). Nest's parser sends a parse failure through
 *    `mapExternalException`, which rewrites the `SyntaxError` into a `BadRequestException` carrying the parser's
 *    message, and that message quotes the request. `stripBodyParserRefusal` hands Nest's handler the refusal without
 *    its text, and the filter's `normalizeBodyParserError` answers it with a constant message.
 *  - ONLY JSON. Nest's default also parsed `application/x-www-form-urlencoded`. That is dropped on purpose: no route of
 *    this service takes a form body, so such a body now reaches its route unparsed and fails validation.
 *
 * The CORS allowlist is the Clerk `azp` boundary the token check uses (`cors.ts`, ADR-0047), and it DENIES when nothing
 * is configured. The resolved mode is logged because "which posture is live" must be readable off a deployed task.
 *
 * @pattern Chain of Responsibility — the Express middleware chain ahead of Nest's error handler
 * @module
 */
import { Logger, type INestApplication, type NestApplicationOptions } from '@nestjs/common';
import { stripBodyParserRefusal } from '@kitchensink/nest-error-envelope';
import express from 'express';

import { corsPolicyFromEnv } from './cors.js';

/** Nest's own default, kept, so parsing the body here moves no limit. */
const JSON_BODY_LIMIT = '100kb';

/** How the app is created and prepared, besides `listen`. */
export const FOOD_HTTP_SETUP = {
    nestOptions: { bodyParser: false } satisfies NestApplicationOptions,
    /**
     * Register CORS, the JSON parser and its refusal link, in that order. Call before `listen`.
     *
     * @param app - The created app.
     * @sideEffect Reads the environment, registers Express middleware on `app` and logs the CORS mode.
     */
    configure: (app: INestApplication): void => {
        const cors = corsPolicyFromEnv();

        app.enableCors(cors.options);
        new Logger('bootstrap').log(`CORS origin mode: ${cors.mode}`);
        app.use(express.json({ limit: JSON_BODY_LIMIT }));
        app.use(stripBodyParserRefusal);
    },
};
