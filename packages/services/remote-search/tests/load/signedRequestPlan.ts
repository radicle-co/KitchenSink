/**
 * The signed requests `remoteSearch.load.js` sends, planned before a run by `prepareSignedUrls.ts` (ADR-0055 points 2
 * and 7). Pure: the request ids and the signature come from the caller.
 *
 * Three kinds of request, because the scenario measures two paths and needs a known answer in the cache for one:
 *
 * - a WARM request admits a term once, so the function asks the source and CloudFront stores the answer;
 * - a HIT request asks the same term unadmitted, under its own id, and must be served the stored answer, which echoes
 *   the id of whichever request stored it (this run's warm-up, or an earlier run's) and never its own;
 * - a PROBE asks a term nobody warmed, unadmitted, so the function answers it as a miss without a source call.
 *
 * The scenario sends only what is planned here, so the plan is where the contract is held: canonical terms, ids the
 * contract admits and never reused, an `https` origin, and no probe term that could be a hit.
 *
 * @module
 */
import { isCanonicalSearchTerm } from '@kitchensink/schema-food';

import {
    REMOTE_SEARCH_RID_HEADER,
    remoteSearchPath,
    remoteSearchQuerySchema,
    type RemoteSearchQuery,
} from '../../src/search/remoteSearch.schema.js';

/** One signed request. */
export interface SignedRequest {
    /** The canonical search term. */
    readonly term: string;
    /** The request id it carries, which a miss echoes back. */
    readonly rid: string;
    /** The signed URL. */
    readonly url: string;
}

/** What the scenario reads at init. */
export interface SignedRequestPlan {
    /** The distribution the URLs are for. */
    readonly origin: string;
    /** The stage that distribution belongs to, for the report. */
    readonly stage: string;
    /** When every signature expires, as an ISO 8601 instant. */
    readonly expiresAt: string;
    /** The response header that echoes the request id. */
    readonly ridHeader: string;
    readonly warm: readonly SignedRequest[];
    readonly hits: readonly SignedRequest[];
    readonly probes: readonly SignedRequest[];
}

/** What a plan is built from. */
export interface PlanInput {
    /** The distribution's origin: `https://`, a host, nothing else. */
    readonly origin: string;
    readonly stage: string;
    /** When every signature expires, as an ISO 8601 instant. */
    readonly expiresAt: string;
    /** Terms to store and then ask again. */
    readonly warmTerms: readonly string[];
    /** Terms to ask once each as a miss. None may be a warm term. */
    readonly probeTerms: readonly string[];
    /** A new request id per call. */
    readonly newRid: () => string;
}

/** Sign one URL to expire at an instant, as food does: a canned policy through the base stage's key. */
export type UrlSigner = (url: URL, expiresAt: string) => string;

/**
 * Refuse a term list with a duplicate or a term that is not canonical.
 *
 * @param kind - Which list, for the message.
 * @param terms - The terms.
 * @throws {Error} naming the offending term.
 */
function requireTerms(kind: string, terms: readonly string[]): void {
    if (terms.length === 0) {
        throw new Error(`a load plan needs at least one ${kind} term`);
    }

    const seen = new Set<string>();

    for (const term of terms) {
        if (!isCanonicalSearchTerm(term)) {
            throw new Error(`the ${kind} term '${term}' is not canonical, so the function would refuse it`);
        }

        if (seen.has(term)) {
            throw new Error(`the ${kind} term '${term}' is listed twice`);
        }

        seen.add(term);
    }
}

/**
 * Plan the signed requests of one load run.
 *
 * @param input - The origin, the terms and the id source.
 * @param sign - Signs one URL.
 * @returns The plan.
 * @throws {Error} on an origin that is not a bare `https` origin, an empty, duplicated or non-canonical term list, a
 *   probe term that is also warmed, or a request id the contract refuses or that was issued before.
 */
export function planSignedRequests(input: PlanInput, sign: UrlSigner): SignedRequestPlan {
    const origin = new URL(input.origin);

    if (origin.protocol !== 'https:') {
        throw new Error(`the origin '${input.origin}' is not https`);
    }

    if (origin.origin !== input.origin) {
        throw new Error(`'${input.origin}' is not a bare origin: give the scheme and host only`);
    }

    requireTerms('warm', input.warmTerms);
    requireTerms('probe', input.probeTerms);

    const warmed = new Set(input.warmTerms);
    const alsoWarmed = input.probeTerms.find((term) => warmed.has(term));

    if (alsoWarmed !== undefined) {
        throw new Error(`the probe term '${alsoWarmed}' is also a warm term, so it would be a hit, not a miss`);
    }

    const issued = new Set<string>();

    const request = (term: string, admit: RemoteSearchQuery['admit']): SignedRequest => {
        const rid = input.newRid();

        if (!remoteSearchQuerySchema.shape.rid.safeParse(rid).success || issued.has(rid)) {
            throw new Error(`the request id '${rid}' is refused by the contract or was issued before`);
        }

        issued.add(rid);

        const url = new URL(remoteSearchPath('usda'), origin);

        url.search = new URLSearchParams({ q: term, admit, rid }).toString();

        return { term, rid, url: sign(url, input.expiresAt) };
    };

    const warm = input.warmTerms.map((term) => request(term, '1'));
    const hits = warm.map((stored) => request(stored.term, '0'));
    const probes = input.probeTerms.map((term) => request(term, '0'));

    return {
        origin: input.origin,
        stage: input.stage,
        expiresAt: input.expiresAt,
        ridHeader: REMOTE_SEARCH_RID_HEADER,
        warm,
        hits,
        probes,
    };
}
