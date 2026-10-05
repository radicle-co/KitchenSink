/**
 * @module infra/smoke/deployedSmoke — post-deploy proof that the remote search service is reachable ONLY through its
 * trust boundary (ADR-0055 point 7).
 *
 * `cdk deploy` succeeding says the stack converged. It does not say the boundary holds: a distribution whose behaviour
 * lost its trusted key group answers anyone, and a function URL whose origin access control slipped answers anyone
 * who finds it. Nor does it say food can get through: a key group that no longer trusts food's key refuses every
 * search food sends with CloudFront's own `403`, which no alarm of this stack can see. So, with no source call:
 *
 * - an UNSIGNED request to the distribution must be CloudFront's own refusal (`MissingKey`), never an answer from the
 *   function ({@link classifyUnsignedCdnAnswer});
 * - a request straight to the function URL must be refused by IAM before the function runs
 *   ({@link classifyDirectFunctionUrlAnswer});
 * - a request SIGNED as food signs it, for a term nobody has asked, with admission off, must reach the function and be
 *   answered "not admitted" for this request ({@link classifySignedProbeAnswer}). That is the first half of every miss
 *   food sends, and the function answers it without calling the source.
 *
 * ⚠️ None proves an admitted search works: that spends a source call, and is the deployed e2e tier's.
 *
 * The coordinates come from what the stacks published (the origin and the base stage's signing key, from SSM and
 * Secrets Manager) and from Lambda (the function URL), read with the AWS CLI as the ingredient parser's smoke does, so
 * this package carries no AWS SDK client. The private key is held in memory for the signed probe and never printed.
 * The judgements and the signing are pure and unit-tested; {@link main} owns all I/O.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { remoteSearchOriginParameter, remoteSearchSharedParameter } from '@radicle-co/infra-shared/remote-search';
import {
    REMOTE_SEARCH_NOT_ADMITTED_STATUS,
    REMOTE_SEARCH_RID_HEADER,
    remoteSearchNotAdmittedSchema,
    remoteSearchPath,
} from '@kitchensink/schema-remote-search';

import { baseStageOf, parseRemoteSearchStage, type BaseStage } from '../lib/remoteSearchStage.js';

/** What a probe saw. `status` is 0 when nothing answered. */
export interface ProbeAnswer {
    readonly status: number;
    /** Response headers, lower-cased. */
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}

/** A judgement. */
export type ProbeVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Judge an unsigned request to the distribution. Pure.
 *
 * @param answer - What came back.
 * @returns `ok` only for CloudFront refusing a request that carries no key.
 */
export function classifyUnsignedCdnAnswer(answer: ProbeAnswer): ProbeVerdict {
    if (answer.status !== 403) {
        return { ok: false, reason: `an unsigned request answered ${String(answer.status)}, not CloudFront's 403` };
    }

    if (!/error from cloudfront/iu.test(answer.headers['x-cache'] ?? '')) {
        return { ok: false, reason: 'the 403 did not come from CloudFront (no `x-cache: Error from cloudfront`)' };
    }

    if (!answer.body.includes('<Code>MissingKey</Code>')) {
        return { ok: false, reason: 'CloudFront refused the request, but not for a missing key' };
    }

    return { ok: true };
}

/**
 * Judge a request straight to the function URL. Pure.
 *
 * @param answer - What came back.
 * @returns `ok` only for IAM refusing the request before the function ran.
 */
export function classifyDirectFunctionUrlAnswer(answer: ProbeAnswer): ProbeVerdict {
    if (answer.status !== 403) {
        return { ok: false, reason: `the function URL answered ${String(answer.status)}, not IAM's 403` };
    }

    if (answer.headers[REMOTE_SEARCH_RID_HEADER.toLowerCase()] !== undefined) {
        return { ok: false, reason: 'the function itself answered: the request reached it' };
    }

    if (!/AccessDenied/u.test(answer.headers['x-amzn-errortype'] ?? '') && !answer.body.includes('Forbidden')) {
        return { ok: false, reason: 'the 403 carries no sign of an IAM refusal' };
    }

    return { ok: true };
}

/**
 * Judge a signed probe of a term nobody has asked, sent with admission off. Pure.
 *
 * @param answer - What came back.
 * @param rid - The request id the probe carried.
 * @returns `ok` only for the function's "not admitted", echoing this request, and not kept by the CDN.
 */
export function classifySignedProbeAnswer(answer: ProbeAnswer, rid: string): ProbeVerdict {
    // "Not admitted" is a 200 OUTCOME, so the status alone cannot tell it from a cached answer: the body and the echo do.
    if (answer.status !== REMOTE_SEARCH_NOT_ADMITTED_STATUS) {
        return {
            ok: false,
            reason: `a signed probe answered ${String(answer.status)}, not the function's ${String(REMOTE_SEARCH_NOT_ADMITTED_STATUS)}`,
        };
    }

    if (answer.headers[REMOTE_SEARCH_RID_HEADER.toLowerCase()] !== rid) {
        return {
            ok: false,
            reason: 'the "not admitted" does not echo this request, so the function did not answer it',
        };
    }

    if (/hit from cloudfront/iu.test(answer.headers['x-cache'] ?? '')) {
        return { ok: false, reason: 'the CDN served a kept "not admitted", which it must never keep' };
    }

    try {
        if (remoteSearchNotAdmittedSchema.safeParse(JSON.parse(answer.body)).success) {
            return { ok: true };
        }
    } catch {
        // A body that is not JSON is judged below, as a body that is not "not admitted".
    }

    return { ok: false, reason: 'the body is not the contract\'s "not admitted"' };
}

/** The base stage's signing key, as `getSignedUrl` takes it. */
export interface SigningKey {
    readonly keyPairId: string;
    readonly privateKey: string;
}

/**
 * A probe URL signed as food signs every request (`SearchServiceRemoteSearch.signedUrl` in food-service): a canned
 * policy over the whole URL, SHA-256, valid for a minute. Pure.
 *
 * @param origin - The distribution's origin.
 * @param term - A canonical term nobody has asked.
 * @param rid - The request id.
 * @param key - The base stage's signing key.
 * @param now - The current time, epoch milliseconds.
 * @returns The signed URL.
 */
export function signedProbeUrl(origin: string, term: string, rid: string, key: SigningKey, now: number): string {
    const url = new URL(remoteSearchPath('usda'), origin);

    url.search = new URLSearchParams({ q: term, admit: '0', rid }).toString();

    return getSignedUrl({
        url: url.href,
        keyPairId: key.keyPairId,
        privateKey: key.privateKey,
        dateLessThan: new Date(now + 60_000),
        algorithm: 'SHA256',
    });
}

/**
 * Run the AWS CLI and read its text output.
 *
 * @param args - The CLI arguments.
 * @returns The trimmed output.
 * @throws {Error} naming the command when it fails.
 * @sideEffect Spawns the AWS CLI.
 */
function aws(args: readonly string[]): string {
    const result = spawnSync('aws', [...args, '--output', 'text'], { encoding: 'utf8' });

    if (result.status !== 0) {
        throw new Error(`aws ${args.slice(0, 2).join(' ')} failed: ${result.stderr.trim()}`);
    }

    return result.stdout.trim();
}

/**
 * Read the base stage's signing key the way food's deployment does: the key-pair id and the secret's ARN from SSM, the
 * private key from that secret. Never prints it.
 *
 * @param baseStage - The base stage whose key every copy at it trusts.
 * @param region - The region.
 * @returns The key.
 * @sideEffect Reads SSM and Secrets Manager through the AWS CLI.
 */
function readSigningKey(baseStage: BaseStage, region: string): SigningKey {
    const parameter = (name: 'key-pair-id' | 'signing-key-secret-arn'): string =>
        aws([
            'ssm',
            'get-parameter',
            '--region',
            region,
            '--name',
            remoteSearchSharedParameter(baseStage, name),
            '--query',
            'Parameter.Value',
        ]);
    const secretArn = parameter('signing-key-secret-arn');

    return {
        keyPairId: parameter('key-pair-id'),
        privateKey: aws([
            'secretsmanager',
            'get-secret-value',
            '--region',
            region,
            '--secret-id',
            secretArn,
            '--query',
            'SecretString',
        ]),
    };
}

/**
 * Probe a URL once.
 *
 * @param url - The URL.
 * @returns What came back; status 0 when nothing did.
 * @sideEffect Performs one HTTP request.
 */
async function probe(url: string): Promise<ProbeAnswer> {
    try {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });

        return {
            status: response.status,
            headers: Object.fromEntries([...response.headers].map(([name, value]) => [name.toLowerCase(), value])),
            body: await response.text(),
        };
    } catch (error) {
        // No answer is a judgement of its own (status 0), and the classifier reports it.
        return { status: 0, headers: {}, body: error instanceof Error ? error.name : 'unknown' };
    }
}

/**
 * Probe until the judgement passes or the attempts run out. A distribution that has just been created can take a
 * minute to answer from every edge.
 *
 * @param judge - One probe and its judgement, made afresh on every attempt (a signed URL outlives one attempt only).
 * @returns The last judgement.
 * @sideEffect Performs HTTP requests and waits between them.
 */
async function probeUntil(judge: () => Promise<ProbeVerdict>): Promise<ProbeVerdict> {
    let verdict: ProbeVerdict = { ok: false, reason: 'not probed' };

    for (let attempt = 1; attempt <= 10; attempt += 1) {
        verdict = await judge();

        if (verdict.ok) {
            return verdict;
        }

        console.log(`attempt ${String(attempt)}/10: ${verdict.reason}`);
        await new Promise((resolve) => {
            setTimeout(resolve, 15_000);
        });
    }

    return verdict;
}

/**
 * Probe one stage's distribution and function URL.
 *
 * @returns The process exit code.
 * @sideEffect Reads SSM, Secrets Manager and Lambda through the AWS CLI, performs HTTP requests, writes to stdout and
 *   stderr.
 */
async function main(): Promise<number> {
    const { values } = parseArgs({ options: { stage: { type: 'string' }, region: { type: 'string' } } });
    const stage = parseRemoteSearchStage(values.stage);
    const region = values.region ?? 'us-east-1';
    const query = `?q=egg&admit=0&rid=deployedsmoke${String(Date.now())}`;
    const origin = aws([
        'ssm',
        'get-parameter',
        '--region',
        region,
        '--name',
        remoteSearchOriginParameter(stage),
        '--query',
        'Parameter.Value',
    ]);
    const functionUrl = aws([
        'lambda',
        'get-function-url-config',
        '--region',
        region,
        '--function-name',
        `kitchensink-remote-search-${stage}`,
        '--query',
        'FunctionUrl',
    ]);
    const path = `${remoteSearchPath('usda')}${query}`;
    const key = readSigningKey(baseStageOf(stage), region);
    // Ten random letters: canonical, and a term no earlier run asked, so the probe is a miss and never a kept answer.
    const term = `deployed smoke ${Array.from(randomBytes(10), (byte) => String.fromCharCode(97 + (byte % 26))).join('')}`;
    const checks: readonly (readonly [string, () => Promise<ProbeVerdict>])[] = [
        [
            'the distribution refuses an unsigned request',
            async () => classifyUnsignedCdnAnswer(await probe(new URL(path, origin).href)),
        ],
        [
            'the function URL refuses a request that skipped the distribution',
            async () => classifyDirectFunctionUrlAnswer(await probe(new URL(path, functionUrl).href)),
        ],
        [
            'a request signed as food signs it reaches the function, which answers "not admitted" without the source',
            async () => {
                const rid = `deployedsmoke${randomBytes(8).toString('hex')}`;

                return classifySignedProbeAnswer(await probe(signedProbeUrl(origin, term, rid, key, Date.now())), rid);
            },
        ],
    ];
    let failed = false;

    for (const [label, judge] of checks) {
        const verdict = await probeUntil(judge);

        if (verdict.ok) {
            console.log(`ok: ${label}`);
        } else {
            console.error(`::error::remote search (${stage}): ${label} FAILED — ${verdict.reason}`);
            failed = true;
        }
    }

    return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exitCode = await main();
}
