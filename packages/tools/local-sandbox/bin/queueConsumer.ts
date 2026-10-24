/**
 * `tsx bin/queueConsumer.ts <name>` — drive one deployed queue-consumer Lambda against LocalStack, as Lambda's SQS
 * poller would, until interrupted.
 *
 * The consumer, its bundle and its environment come from `.local-sandbox/queueConsumers.json`, which `local:up`
 * writes from the synthesised CDK (`src/queueConsumers.ts`). Nothing about which consumers exist is written here.
 *
 * ⛔ PINNED TO LOCALSTACK, whatever the caller's environment says: the endpoint, throwaway credentials, and no
 * profile. A consumer's handler builds its own SDK clients from the environment, and a developer's live AWS profile
 * must never be what they find.
 *
 * @sideEffect Imports the bundle, long-polls SQS, invokes the handler and deletes what it acknowledged.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import type { PersistedConsumer } from '../src/queueConsumers.js';
import { messagesToDelete, sqsEventFor, type InvocationOutcome } from '../src/queueEvent.js';
import { CONSUMER_PLAN } from './adapters.js';

const LOCALSTACK = 'http://localhost:4566';
const REGION = 'us-east-1';

async function main(): Promise<void> {
    const name = process.argv[2];
    const plan = JSON.parse(readFileSync(CONSUMER_PLAN, 'utf8')) as readonly PersistedConsumer[];
    const consumer = plan.find((entry) => entry.name === name);

    if (consumer === undefined) {
        process.stderr.write(
            `queueConsumer: no consumer '${String(name)}' in ${CONSUMER_PLAN} (have: ${plan.map((entry) => entry.name).join(', ')})\n`,
        );
        process.exitCode = 2;

        return;
    }

    for (const key of ['AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN']) {
        delete process.env[key];
    }

    Object.assign(process.env, consumer.environment, {
        AWS_ENDPOINT_URL: LOCALSTACK,
        // ⚠️ The handlers build `new S3Client({})`, which addresses a bucket VIRTUAL-HOSTED — `<bucket>.localhost` does
        // not resolve. LocalStack's own wildcard name does (to 127.0.0.1), so S3 gets that endpoint.
        AWS_ENDPOINT_URL_S3: 'http://s3.localhost.localstack.cloud:4566',
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_REGION: REGION,
        AWS_DEFAULT_REGION: REGION,
        AWS_CONFIG_FILE: '/dev/null',
        AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    });

    const module = (await import(pathToFileURL(path.join(consumer.bundleDir, consumer.module)).href)) as Record<
        string,
        unknown
    >;
    const handler = module[consumer.exportName];

    if (typeof handler !== 'function') {
        throw new Error(`${consumer.handler}: the bundle exports no function '${consumer.exportName}'`);
    }

    const sqs = new SQSClient({
        region: REGION,
        endpoint: LOCALSTACK,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const stop = new AbortController();
    let running = true;

    // ⚠️ Both: the flag ends the loop between polls, the abort ends the 20-second long poll in flight.
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
            running = false;
            stop.abort();
        });
    }

    process.stdout.write(`queueConsumer: ${consumer.handler} draining ${consumer.queueUrl}\n`);

    while (running) {
        let received;

        try {
            received = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: consumer.queueUrl,
                    MaxNumberOfMessages: Math.min(consumer.batchSize, 10),
                    WaitTimeSeconds: 20,
                    // A batch the handler has not finished must not be handed out again mid-run.
                    VisibilityTimeout: consumer.timeoutSeconds + 30,
                    MessageSystemAttributeNames: ['All'],
                }),
                { abortSignal: stop.signal },
            );
        } catch (error) {
            if (!running) {
                break;
            }

            throw error;
        }

        const messages = received.Messages ?? [];

        if (messages.length === 0) {
            continue;
        }

        const event = sqsEventFor(messages, { url: consumer.queueUrl, region: REGION });
        const context = {
            functionName: consumer.name,
            awsRequestId: messages[0]?.MessageId ?? 'local',
            getRemainingTimeInMillis: () => consumer.timeoutSeconds * 1000,
        };
        let outcome: InvocationOutcome;

        try {
            outcome = {
                kind: 'resolved',
                value: await (handler as (e: unknown, c: unknown) => unknown)(event, context),
            };
        } catch (error) {
            // ⛔ Left on the queue, as Lambda leaves it: it redelivers once the visibility timeout passes.
            process.stderr.write(
                `queueConsumer: ${consumer.handler} threw — left for redelivery: ${error instanceof Error ? error.message : String(error)}\n`,
            );
            outcome = { kind: 'threw' };
        }

        for (const receiptHandle of messagesToDelete(messages, outcome, consumer.reportsBatchItemFailures)) {
            await sqs.send(new DeleteMessageCommand({ QueueUrl: consumer.queueUrl, ReceiptHandle: receiptHandle }));
        }
    }

    process.stdout.write(`queueConsumer: ${consumer.handler} stopped\n`);
}

await main();
