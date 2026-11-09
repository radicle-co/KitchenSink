/**
 * The staff decision on a publication request, driven by the e2e-seed (revision 4, F16): a flow reaches the
 * "approved" and "declined" states of a food it asked to publish without a staff screen, because there is none.
 *
 * It signs in as the sandbox `food:admin` pool user (the `k6` tier's `admin` lane: no new Clerk user, on a development
 * instance that caps at 100) and calls the staff routes of the food service.
 *
 * ⛔ SANDBOX ONLY, BY AN ALLOW LIST. {@link assertSandboxOrigin} runs first, before the token is ever asked for, and it
 * accepts only a preview (`food-pr-N.commise.app`), the shared sandbox (`*.sandbox.commise.app`) and localhost. A
 * production origin, an unknown host and a lookalike (`food-pr-1.commise.app.evil.example`) are all refused, so a
 * mis-set `E2E_SEED_FOOD_URL` can neither decide a real request nor send a staff token to a stranger. A deny list of
 * "production" would let every host it did not think of through.
 *
 * @pattern Imperative Shell — the origin gate is a pure predicate; the two HTTP calls are injected
 */
import { withoutTrailingSlashes } from './env.js';

/** The hosts a staff decision may be sent to. Anchored, because the host is parsed, not searched. */
const SANDBOX_HOSTS: readonly RegExp[] = [
    /^[a-z0-9]+-pr-\d+\.commise\.app$/u,
    /^(?:[a-z0-9-]+\.)+sandbox\.commise\.app$/u,
    /^localhost$/u,
    /^127\.0\.0\.1$/u,
];

/**
 * Whether an origin is one a staff decision may go to. Pure.
 *
 * @param origin - The food service's origin.
 * @returns `true` only for a preview, the shared sandbox or localhost; `false` for anything else, a non-URL included.
 */
export function isSandboxOrigin(origin: string): boolean {
    if (!URL.canParse(origin)) {
        return false;
    }

    const url = new URL(origin);

    return url.username === '' && url.password === '' && SANDBOX_HOSTS.some((host) => host.test(url.hostname));
}

/**
 * Refuse any origin that is not a sandbox.
 *
 * @param origin - The food service's origin.
 * @throws {Error} Naming the origin, when it is not one a staff decision may go to.
 */
export function assertSandboxOrigin(origin: string): void {
    if (!isSandboxOrigin(origin)) {
        throw new Error(
            `e2e-seed: refusing to decide a publication request at ${origin}: the staff principal is for a preview, ` +
                `the shared sandbox or localhost, never production`,
        );
    }
}

/** What staff answer: approve, or decline with the words the author reads. */
export type StaffDecision = { readonly approve: true } | { readonly approve: false; readonly reason: string };

/** The slice of `fetch` this uses: a URL string in, a response out. */
export type StaffFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** What {@link decidePublication} needs. `fetch` is injected so the unit tier needs no network. */
export interface DecidePublicationInput {
    readonly foodOrigin: string;
    /** The staff principal's bearer token, minted per call. */
    readonly token: () => Promise<string>;
    /** The food whose pending request is decided. */
    readonly foodId: string;
    readonly decision: StaffDecision;
    readonly fetch?: StaffFetch;
}

/** The slice of a staff-list entry this reads. */
interface PendingEntry {
    readonly request: { readonly id: string; readonly foodId: string };
}

/** One staff call, failing with the status on anything but `200`. @sideEffect One HTTP request. */
async function staffCall(
    fetchImpl: StaffFetch,
    url: string,
    token: string,
    init: { readonly method: 'GET' | 'POST'; readonly body?: string },
): Promise<unknown> {
    const response = await fetchImpl(url, {
        method: init.method,
        headers: {
            authorization: `Bearer ${token}`,
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
    });
    const text = await response.text();

    if (response.status !== 200) {
        throw new Error(`e2e-seed: ${init.method} ${url} answered ${response.status}: ${text}`);
    }

    return JSON.parse(text) as unknown;
}

/**
 * Decide the pending request that names `foodId`, as staff.
 *
 * @param input - The food service origin, the staff token source, the food and the decision.
 * @throws {Error} When the origin is not a sandbox (before anything is requested); when no pending request names the
 *   food; or with the status when the service refuses.
 * @sideEffect Mints a token; one staff list read and one decision write.
 */
export async function decidePublication(input: DecidePublicationInput): Promise<void> {
    assertSandboxOrigin(input.foodOrigin);

    const fetchImpl = input.fetch ?? fetch;
    const base = `${withoutTrailingSlashes(input.foodOrigin)}/api/v1/foods/admin/publication-requests`;
    const token = await input.token();
    const listed = (await staffCall(fetchImpl, `${base}?status=pending`, token, { method: 'GET' })) as {
        readonly requests: readonly PendingEntry[];
    };
    const found = listed.requests.find((entry) => entry.request.foodId === input.foodId);

    if (found === undefined) {
        throw new Error(`e2e-seed: no pending publication request for food ${input.foodId}`);
    }

    await staffCall(fetchImpl, `${base}/${found.request.id}/decision`, token, {
        method: 'POST',
        body: JSON.stringify(input.decision),
    });
}
