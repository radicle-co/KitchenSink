/**
 * THE ONE HTTP SETUP: how the app is created and which Express middleware it registers, in order. `main.ts` applies it,
 * and so do the integration and e2e tiers (`tests/support/identityApp.ts`) through the test harness's `httpSetup`
 * option, so every tier serves requests through the stack production does.
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
 * The CORS allowlist is DERIVED from the same Clerk `azp` boundary the token check uses (`cors.ts`, ADR-0047), per
 * stage, and DENIES when nothing is configured. The resolved mode is logged because "which posture is live" was
 * previously unobservable: an empty parties list silently became `origin: true` on every non-prod stage.
 *
 * @pattern Chain of Responsibility — the Express middleware chain ahead of Nest's error handler
 * @module
 */
import { Logger, type INestApplication, type NestApplicationOptions } from '@nestjs/common';
import { stripBodyParserRefusal } from '@kitchensink/nest-error-envelope';
import express from 'express';

import { buildCorsPolicy } from './cors.js';

/** Nest's own default, kept, so parsing the body here moves no limit. */
const JSON_BODY_LIMIT = '100kb';

/** How the app is created and prepared, besides `listen`. */
export const IDENTITY_HTTP_SETUP = {
    nestOptions: { bodyParser: false } satisfies NestApplicationOptions,
    /**
     * Register CORS, the JSON parser and its refusal link, in that order. Call before `listen`.
     *
     * @param app - The created app.
     * @sideEffect Reads the environment, registers Express middleware on `app` and logs the CORS mode.
     */
    configure: (app: INestApplication): void => {
        const cors = buildCorsPolicy({
            stage: process.env['STAGE'] ?? 'dev',
            authorizedPartiesRaw: process.env['CLERK_AUTHORIZED_PARTIES'],
            previewBaseDomain: process.env['CLERK_AZP_PATTERN'],
            previewMode: process.env['CLERK_AZP_PREVIEW_MODE'],
        });

        app.enableCors(cors.options);
        new Logger('bootstrap').log(`CORS origin mode: ${cors.mode}`);
        app.use(express.json({ limit: JSON_BODY_LIMIT }));
        app.use(stripBodyParserRefusal);
    },
};
