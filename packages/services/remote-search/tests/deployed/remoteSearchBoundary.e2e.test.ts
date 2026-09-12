/**
 * DEPLOYED e2e (`docs/CODING_STANDARDS.md` §7.1a): one stage's remote search copy, through its real CloudFront
 * distribution (ADR-0055 points 2, 6 and 7).
 *
 * What only a deployment can show: CloudFront enforces the signature (unsigned and tampered requests are its own
 * `403`), the function URL accepts nothing but this distribution, a signed probe of a term nobody asked is "not
 * admitted" without a source call, and an admitted answer is cached under the path and `q` alone, so the next probe
 * is a hit that echoes the request that stored it.
 *
 * The signed cases read the base stage's signing key from Secrets Manager, as food does, never print it, and spend
 * one USDA call per run (the admitted search). Production keeps both for cooks, so at `prod` only the unsigned and
 * direct probes run, which read no key and reach no source.
 *
 * The target is required, never skipped: the job runs only when the stage is up (`deployedE2eTiers.yml`), so a
 * missing target here means the wiring broke. The job reads the origin the stage published, refuses it unless it is
 * under this repository's own domain (`targetScope.sh`), and passes it here; it also names the base stage's key
 * parameters, so this suite derives no stage of its own.
 */
import { randomBytes } from 'node:crypto';

import { GetFunctionUrlConfigCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    REMOTE_SEARCH_RID_HEADER,
    remoteSearchAnswerSchema,
    remoteSearchNotAdmittedSchema,
    remoteSearchPath,
} from '../../src/search/remoteSearch.schema.js';
import { readSigningKey, type SigningKey } from '../support/readSigningKey.js';
import { signRemoteSearchUrl } from '../support/signRemoteSearchUrl.js';

/**
 * A required variable.
 *
 * @param name - Its name.
 * @returns Its value.
 * @throws {Error} when it is unset.
 */
function required(name: string): string {
    const value = process.env[name];

    if (value === undefined || value === '') {
        throw new Error(`${name} must name the deployed stage under test; this tier never skips.`);
    }

    return value;
}

const STAGE = required('REMOTE_SEARCH_STAGE');

/** The distribution's origin, as the stage published it and the job vouched for it. */
const ORIGIN = required('REMOTE_SEARCH_ORIGIN');

/** Whether the target is production, where only the probes that read no key and reach no source run. */
const IS_PRODUCTION = STAGE === 'prod';

/** Where the stage answers. */
interface Target {
    readonly origin: string;
    readonly functionUrl: string;
}

let target: Target;

beforeAll(async () => {
    const { FunctionUrl } = await new LambdaClient({}).send(
        new GetFunctionUrlConfigCommand({ FunctionName: `kitchensink-remote-search-${STAGE}` }),
    );

    target = { origin: ORIGIN, functionUrl: FunctionUrl ?? '' };

    // The stage's own name: `remote-search` at prod, `remote-search-pr-{N}` at a preview (ADR-0055, lead decision A).
    expect(new URL(target.origin).hostname.split('.')[0]).toBe(
        IS_PRODUCTION ? 'remote-search' : `remote-search-${STAGE}`,
    );
    expect(target.functionUrl).toMatch(/^https:\/\/[a-z0-9]+\.lambda-url\./u);
});

/** A request id the contract admits. */
function newRid(): string {
    return `deployede2e${randomBytes(8).toString('hex')}`;
}

/**
 * A search URL on the distribution.
 *
 * @param term - The canonical term.
 * @param admit - The admission flag.
 * @param rid - The request id.
 * @returns The unsigned URL.
 */
function searchUrl(term: string, admit: '0' | '1', rid: string): URL {
    const url = new URL(remoteSearchPath('usda'), target.origin);

    url.search = new URLSearchParams({ q: term, admit, rid }).toString();

    return url;
}

/**
 * Sign a URL as food does: a canned policy, valid for a minute.
 *
 * @param key - The signing key.
 * @param url - The URL.
 * @returns The signed URL.
 */
function signed(key: SigningKey, url: URL): string {
    return signRemoteSearchUrl(key, url, new Date(Date.now() + 60_000).toISOString());
}

/**
 * Fetch, and read the body as text.
 *
 * @param url - The URL.
 * @returns The response and its body.
 */
async function get(url: string): Promise<{ readonly response: Response; readonly body: string }> {
    const response = await fetch(url, { redirect: 'manual' });

    return { response, body: await response.text() };
}

describe(`the remote search distribution at ${STAGE}`, () => {
    it('refuses an unsigned request itself', async () => {
        const { response, body } = await get(searchUrl('egg', '0', newRid()).href);

        expect(response.status).toBe(403);
        expect(response.headers.get('x-cache') ?? '').toMatch(/error from cloudfront/iu);
        expect(body).toContain('MissingKey');
    });

    it('lets nothing reach the function URL except through the distribution', async () => {
        const url = new URL(remoteSearchPath('usda'), target.functionUrl);

        url.search = new URLSearchParams({ q: 'egg', admit: '0', rid: newRid() }).toString();

        const { response } = await get(url.href);

        expect(response.status).toBe(403);
        expect(response.headers.get(REMOTE_SEARCH_RID_HEADER)).toBeNull();
    });
});

// Not at `prod`: these read the signing key and spend a USDA call (see the header). They run at every preview.
describe.skipIf(IS_PRODUCTION)(`signed requests to the remote search distribution at ${STAGE}`, () => {
    let key: SigningKey;

    // Read only here, where the signed cases run: the base stage's key, through the parameters the job names.
    beforeAll(async () => {
        key = await readSigningKey({
            keyPairIdParameter: required('REMOTE_SEARCH_KEY_PAIR_ID_PARAMETER'),
            signingKeyParameter: required('REMOTE_SEARCH_SIGNING_KEY_PARAMETER'),
        });
    });

    it('refuses a signed request whose q was changed after signing', async () => {
        const url = new URL(signed(key, searchUrl('egg', '0', newRid())));

        url.searchParams.set('q', 'eggs');

        const { response } = await get(url.href);

        expect(response.status).toBe(403);
        expect(response.headers.get(REMOTE_SEARCH_RID_HEADER)).toBeNull();
    });

    it('answers a probe of a new term "not admitted", then caches the admitted answer under q alone', async () => {
        // A term nobody has asked: ten random letters, so it is canonical and no earlier run cached it.
        const letters = Array.from(randomBytes(10), (byte) => String.fromCharCode(97 + (byte % 26))).join('');
        const term = `deployed probe ${letters}`;
        const probeRid = newRid();
        const probe = await get(signed(key, searchUrl(term, '0', probeRid)));

        expect(probe.response.status).toBe(428);
        expect(remoteSearchNotAdmittedSchema.parse(JSON.parse(probe.body))).toEqual({ outcome: 'notAdmitted' });
        expect(probe.response.headers.get(REMOTE_SEARCH_RID_HEADER)).toBe(probeRid);

        const admittedRid = newRid();
        const admitted = await get(signed(key, searchUrl(term, '1', admittedRid)));

        expect(admitted.response.status).toBe(200);
        expect(remoteSearchAnswerSchema.safeParse(JSON.parse(admitted.body)).success).toBe(true);
        expect(admitted.response.headers.get(REMOTE_SEARCH_RID_HEADER)).toBe(admittedRid);

        const hit = await get(signed(key, searchUrl(term, '0', newRid())));

        expect(hit.response.status).toBe(200);
        expect(hit.response.headers.get('x-cache') ?? '').toMatch(/hit from cloudfront/iu);
        // A cached answer replays the request that stored it, which is how food tells a hit from its own call.
        expect(hit.response.headers.get(REMOTE_SEARCH_RID_HEADER)).toBe(admittedRid);
    });
});
