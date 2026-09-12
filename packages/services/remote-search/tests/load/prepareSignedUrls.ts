/**
 * Mint the signed URLs `remoteSearch.load.js` sends, and write them beside this script as `signedUrls.json` (ADR-0055
 * point 7).
 *
 * ⛔ CREDENTIAL MATERIAL. Every URL in the file is a request the distribution admits until `expiresAt`. The file is
 * ignored by git (the k6 block of `.gitignore`), readable by its owner only, never uploaded, and deleted by the job
 * that wrote it.
 *
 * It signs as food does (`signRemoteSearchUrl`), with the base stage's key (`../support/readSigningKey.ts`), through the SSM parameters the job
 * names. It refuses every stage but a pull request preview, as the scenario declares (`@loadExcludeTarget prod`).
 *
 * Run by the dispatch-only `remoteSearchLoadtest.yml`. By hand, with AWS credentials:
 *
 *     REMOTE_SEARCH_ORIGIN=<the origin the stage published> REMOTE_SEARCH_STAGE=pr-<N> \
 *     REMOTE_SEARCH_KEY_PAIR_ID_PARAMETER=/kitchensink/sandbox/remote-search/key-pair-id \
 *     REMOTE_SEARCH_SIGNING_KEY_PARAMETER=/kitchensink/sandbox/remote-search/signing-key-secret-arn \
 *     npx tsx tests/load/prepareSignedUrls.ts
 *
 * @module
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { z } from 'zod';

import { readSigningKey } from '../support/readSigningKey.js';
import { signRemoteSearchUrl } from '../support/signRemoteSearchUrl.js';
import { planSignedRequests } from './signedRequestPlan.js';

/**
 * Terms common enough that USDA answers `found`, so the warm-up stores each answer for seven days and a later run's
 * warm-up is itself a hit, spending no source call.
 */
const WARM_TERMS = ['apple', 'butter', 'egg', 'flour', 'garlic', 'milk', 'onion', 'rice', 'salt', 'sugar'] as const;

/** What the minter reads from its environment. */
const environmentSchema = z.object({
    REMOTE_SEARCH_ORIGIN: z.url(),
    REMOTE_SEARCH_STAGE: z
        .string()
        .regex(/^pr-[1-9][0-9]*$/u, 'a pull request preview, pr-{N}: the load tier never targets production'),
    REMOTE_SEARCH_KEY_PAIR_ID_PARAMETER: z.string().min(1),
    REMOTE_SEARCH_SIGNING_KEY_PARAMETER: z.string().min(1),
    /** How many distinct miss terms to mint. A run that sends more probes than this repeats them, still as misses. */
    REMOTE_SEARCH_PROBE_COUNT: z.coerce.number().int().min(1).max(5_000).default(300),
    /** How long every signature lives. Longer than the run, and no longer than it needs. */
    REMOTE_SEARCH_URL_LIFETIME_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
});

/**
 * A term nobody has asked: ten random letters, so it is canonical and no earlier run stored it.
 *
 * @returns The term.
 * @sideEffect Reads the system's random source.
 */
function newProbeTerm(): string {
    return `load probe ${Array.from(randomBytes(10), (byte) => String.fromCharCode(97 + (byte % 26))).join('')}`;
}

/**
 * Mint the URLs and write the plan.
 *
 * @sideEffect Reads SSM and Secrets Manager, writes `signedUrls.json` beside this script.
 */
async function main(): Promise<void> {
    const environment = environmentSchema.parse(process.env);
    const key = await readSigningKey({
        keyPairIdParameter: environment.REMOTE_SEARCH_KEY_PAIR_ID_PARAMETER,
        signingKeyParameter: environment.REMOTE_SEARCH_SIGNING_KEY_PARAMETER,
    });
    const expiresAt = new Date(Date.now() + environment.REMOTE_SEARCH_URL_LIFETIME_MINUTES * 60_000).toISOString();
    const plan = planSignedRequests(
        {
            origin: environment.REMOTE_SEARCH_ORIGIN,
            stage: environment.REMOTE_SEARCH_STAGE,
            expiresAt,
            warmTerms: WARM_TERMS,
            probeTerms: Array.from({ length: environment.REMOTE_SEARCH_PROBE_COUNT }, newProbeTerm),
            newRid: () => `loadtest${randomBytes(12).toString('hex')}`,
        },
        (url, dateLessThan) => signRemoteSearchUrl(key, url, dateLessThan),
    );
    const outDir = dirname(fileURLToPath(import.meta.url));

    writeFileSync(join(outDir, 'signedUrls.json'), `${JSON.stringify(plan)}\n`, { mode: 0o600 });
    process.stdout.write(
        `minted ${String(plan.warm.length + plan.hits.length + plan.probes.length)} signed URLs for ` +
            `${plan.stage}, valid until ${plan.expiresAt}\n`,
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    await main();
}
