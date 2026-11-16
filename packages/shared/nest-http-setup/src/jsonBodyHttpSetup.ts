/**
 * THE ORDERED HTTP SETUP OF A SERVICE THAT SERVES A JSON BODY, written once. A service builds its own CORS policy
 * from its own environment and hands it here; `main.ts` applies the result, and so do the integration and e2e tiers
 * (through the test harness's `httpSetup` option), so every tier serves requests through the stack production does.
 *
 * ⛔ THE ORDER IS LOAD-BEARING: CORS, then the JSON parser, then the strip link.
 *  - CORS FIRST. When the parser refuses a body it calls `next(err)`, and Express skips every non-error middleware
 *    after that. Registered after the parser, CORS never runs on a refusal, so a browser gets a `413` or `400` with no
 *    `access-control-allow-origin` and the web app reads "Failed to fetch" instead of the status.
 *  - THE SERVICE PARSES ITS OWN JSON (`bodyParser: false`). Nest's parser sends a parse failure through
 *    `mapExternalException`, which rewrites the `SyntaxError` into a `BadRequestException` carrying the parser's
 *    message, and that message quotes the request. {@link stripBodyParserRefusal} hands Nest's handler the refusal
 *    without its text, and the filter's `normalizeBodyParserError` answers it with a constant message.
 *  - ONLY JSON. Nest's default also parsed `application/x-www-form-urlencoded`. That is dropped on purpose: a service
 *    that adopts this has no route taking a form body, so such a body reaches its route unparsed and fails validation.
 *  - THE LIMIT IS NEST'S OWN DEFAULT (`100kb`), kept, so parsing the body here moves no limit.
 *
 * The CORS policy is the service's, because its inputs differ (stage, preview mode); the mode is logged because "which
 * posture is live" must be readable off a deployed task.
 *
 * @pattern Template Method — the fixed middleware order, with the CORS policy supplied by the service
 * @module
 */
import { Logger, type INestApplication, type NestApplicationOptions } from '@nestjs/common';
import { stripBodyParserRefusal } from '@kitchensink/nest-error-envelope';
import express from 'express';

/** The options `enableCors` takes: whatever Nest accepts, so the service's own policy type needs no cast. */
type CorsOptionsArgument = Parameters<INestApplication['enableCors']>[0];

/** The nest limit, kept so the move to a service-owned parser changes no limit. */
const JSON_BODY_LIMIT = '100kb';

/** A resolved CORS policy: the options to install and the name of the posture they encode. */
export interface JsonBodyCorsPolicy {
    readonly options: CorsOptionsArgument;
    readonly mode: string;
}

/** The create options a service chooses. `bodyParser` is the setup's alone, so the type refuses it. */
export type ServiceNestOptions = Omit<NestApplicationOptions, 'bodyParser'> & { readonly bodyParser?: never };

/** How the app is created and prepared, besides `listen`. */
export interface JsonBodyHttpSetup {
    /**
     * The options to create the app with: the service's own, with Nest's parser off. Pass the result to
     * `NestFactory.create` as it is. A spread beside it could set `bodyParser` again, and the repo guard refuses that.
     */
    readonly nestOptions: (options: ServiceNestOptions) => NestApplicationOptions;
    /** Register CORS, the JSON parser and its refusal link, in that order. Call before `listen`. */
    readonly configure: (app: INestApplication) => void;
}

/**
 * Build the setup for a service.
 *
 * @param corsPolicy - Resolves the service's CORS policy from its environment. Called by `configure`, not here, so an
 *   environment read happens when the app is prepared and a test can set it first.
 * @returns The options to create the app with, and the `configure` step.
 */
export function jsonBodyHttpSetup(corsPolicy: () => JsonBodyCorsPolicy): JsonBodyHttpSetup {
    return {
        // `bodyParser: false` is applied last, so a caller that gets past the type still cannot turn the parser on.
        nestOptions: (options) => ({ ...options, bodyParser: false }),
        /**
         * @param app - The created app.
         * @sideEffect Reads the environment (through `corsPolicy`), registers Express middleware on `app` and logs
         *   the CORS mode.
         */
        configure: (app) => {
            const policy = corsPolicy();

            app.enableCors(policy.options);
            new Logger('bootstrap').log(`CORS origin mode: ${policy.mode}`);
            app.use(express.json({ limit: JSON_BODY_LIMIT }));
            app.use(stripBodyParserRefusal);
        },
    };
}
