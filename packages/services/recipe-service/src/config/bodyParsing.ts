/**
 * THE SERVICE PARSES ITS OWN JSON BODIES, so a parser refusal reaches the exception filter with no request text.
 *
 * ⛔ WHY NOT NEST'S BODY PARSER. Nest routes a parser error through `mapExternalException`, which rewrites any
 * `SyntaxError` (a malformed JSON body is one) into a `BadRequestException` carrying the parser's message. That
 * message quotes the characters around the error, so the cook's text was published in the envelope and written to the
 * `warn` log. Here the app is created with `bodyParser: false`, `express.json` parses with Nest's own `100kb` limit, and
 * the error link right after it strips a refusal to `{ type, status, expose }` before Nest's handler sees it. The
 * filter's `normalizeBodyParserError` then answers it with a constant message, so the filter stays the single author of
 * every error body.
 *
 * `main.ts` and the integration tier (`bootMockedRecipeApp`) both apply {@link RECIPE_HTTP_SETUP}, so the tier serves
 * requests through the same parser production does.
 *
 * @pattern Chain of Responsibility — two links of the Express middleware chain, ahead of Nest's error handler
 * @module
 */
import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import express from 'express';

/** Nest's own default, kept, so parsing the body here moves no limit. */
const JSON_BODY_LIMIT = '100kb';

/**
 * Forward a body-parser refusal without its text. A parser error carries the request in `body` and quotes it in its
 * `message`; only the three fields `normalizeBodyParserError` matches on travel on. Any other error passes unchanged.
 *
 * @param error - What the previous link passed to `next`.
 * @param _request - Unused (Express passes the request).
 * @param _response - Unused (Express passes the response).
 * @param next - The next link (Nest's error handler).
 * @sideEffect Calls `next`.
 */
export function stripBodyParserRefusal(
    error: unknown,
    _request: unknown,
    _response: unknown,
    next: (error: unknown) => void,
): void {
    if (typeof error !== 'object' || error === null || !('type' in error)) {
        next(error);

        return;
    }

    next({
        type: error.type,
        status: 'status' in error ? error.status : undefined,
        expose: 'expose' in error ? error.expose : undefined,
    });
}

/** How `main.ts` creates and prepares the app, besides CORS and `listen`. */
export const RECIPE_HTTP_SETUP = {
    nestOptions: { bodyParser: false } satisfies NestApplicationOptions,
    /**
     * Register the JSON parser and its refusal link. Call before `listen`, so both run ahead of Nest's error handler.
     *
     * @param app - The created app.
     * @sideEffect Registers Express middleware on `app`.
     */
    configure: (app: INestApplication): void => {
        app.use(express.json({ limit: JSON_BODY_LIMIT }));
        app.use(stripBodyParserRefusal);
    },
};
