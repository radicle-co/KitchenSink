/**
 * `npm run dev --workspace=@kitchensink/recipe-workers` — the parse-line consumer, as a local process.
 *
 * ⛔ THE PIECE THE LOCAL SANDBOX HAD NO WAY TO STAND UP. `RecipeWorkersStack` attaches the parse queue to a
 * Lambda with an `SqsEventSource`; `local:up` creates the queue and deploys no Lambda, and this package had
 * no `dev` script, so locally the queue filled and nothing drained it. Every pasted ingredient line sat
 * `pending` forever behind a `202`.
 *
 * ⚠️ Started by `turbo run dev` alongside the three services (`npm run dev:local` / `npm run local:dev`),
 * which is why the script is named `dev` like theirs rather than something this package invented.
 *
 * @sideEffect Opens a database pool and an SQS client, spawns a Python process per CRF call, and runs until
 *   interrupted.
 */
import pg from 'pg';
import { SQSClient } from '@aws-sdk/client-sqs';

import { logger } from '../common/logger.js';

import { drainParseQueue, sqsParseQueuePort } from './parseQueueConsumer.js';
import {
    createLocalParseLineDeps,
    handleLocalParseMessage,
    isLocalParseLineConfigError,
    readLocalParseLineConfig,
} from './localParseLine.js';

async function main(): Promise<void> {
    const config = readLocalParseLineConfig(process.env);
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    const deps = createLocalParseLineDeps(config, pool);
    const client = new SQSClient({
        region: config.region,
        endpoint: config.sqsEndpoint,
        // ⚠️ Static throwaway credentials, matching `recipe-service`'s own local SQS adapter: with an
        // endpoint override there is nothing to authenticate against, and falling through to the default
        // credential chain would make a developer's real AWS profile a dependency of the local sandbox.
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    let running = true;
    // ⛔ BOTH, not just the flag. The predicate is consulted BETWEEN polls, so on its own a signal is left
    // waiting out the 20-second long poll — measured: `SIGINT` logged, the process alive for another 19
    // seconds, which under `turbo run dev` reads as a hung worker. Aborting the in-flight receive makes the
    // stop immediate; the flag is what makes it a stop rather than a retry.
    const shutdown = new AbortController();

    const stop = (signal: string): void => {
        logger.info('local parse worker stopping', { signal });
        running = false;
        shutdown.abort();
    };

    // ⚠️ `once`, so a SECOND Ctrl-C falls through to Node's default handler and exits immediately — the
    // escape hatch for a handler that is genuinely stuck mid-line.
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));

    logger.info('local parse worker draining the parse queue', {
        stage: config.stage,
        queueUrl: config.queueUrl,
        // ⛔ Said out loud, every start. The LLM leg is answered by an offline substitute, and a developer
        // reading a parse must know that before they judge it.
        llm: 'OFFLINE SUBSTITUTE — no model is called; parse QUALITY is not observable locally',
        crf: 'the deployed ingredient-parser handler, run under a local interpreter',
    });

    const summary = await drainParseQueue({
        queue: sqsParseQueuePort({ client, queueUrl: config.queueUrl, abortSignal: shutdown.signal }),
        handle: (body) => handleLocalParseMessage(deps, body),
        // ⛔ Reported, never swallowed — and NOT deleted. `parseLine.ts` throws on a transient failure so
        // the message redelivers, and LocalStack's own redrive policy (from the same template) decides when
        // it reaches the DLQ.
        onError: (error) => {
            logger.error('local parse worker: message left for redelivery', {
                error: error instanceof Error ? error.message : String(error),
            });
        },
        shouldContinue: () => running,
    });

    logger.info('local parse worker stopped', { ...summary });
    await pool.end();
    client.destroy();
}

try {
    await main();
} catch (error) {
    if (isLocalParseLineConfigError(error)) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    } else {
        throw error;
    }
}
