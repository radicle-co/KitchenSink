/**
 * An adapter double behind the REAL admission path, for suites whose source is a canonical-candidate double rather
 * than a USDA wire stub (ADR-0053 §3).
 *
 * In production every adapter request leaves through the rate-limited transport, so admission happens once per
 * upstream request. A canonical double has no `fetch` to decorate, so this wraps each of its calls in one request
 * through a real {@link RateLimitedTransport} whose upstream always answers 200 — that charges the real limiter and
 * reads the real block, exactly once per call — and then delegates. When the double throws a `SourceApiError` with a
 * status the block rule blocks on, the block it would have earned is written through the real ledger, as the
 * transport writes it for a real response.
 */
import { SourceApiError } from '../../src/sources/foodSource.errors.js';
import type { CanonicalCandidate, FoodSourceAdapter, SourceCandidate } from '../../src/sources/foodSourceAdapter.js';
import { apiAccessOf } from '../../src/sources/sourceRegister.js';
import { blockFor } from '../../src/sources/transport/blockRule.js';
import { RateLimitedTransport } from '../../src/sources/transport/RateLimitedTransport.js';
import type { AdmissionPolicy, BlockLedger, SourceCallChannel } from '../../src/sources/transport/transportPorts.js';

/**
 * Wrap a `usda` adapter double so each of its calls is one admitted request.
 *
 * @param inner - The double.
 * @param ports - The real admission policy and block ledger.
 * @param lane - The lane the calls are charged to.
 * @returns The wrapped adapter.
 */
export function admittingAdapter(
    inner: FoodSourceAdapter,
    ports: { readonly admission: AdmissionPolicy; readonly blocks: BlockLedger },
    lane: SourceCallChannel = 'worker',
): FoodSourceAdapter {
    const limitedFetch = new RateLimitedTransport({
        ...ports,
        metrics: { recordSourceRateLimit: () => undefined },
        upstream: async () => new Response('{}', { status: 200 }),
    }).fetchFor('usda', lane);

    /**
     * Admit one request, then make the double's call, recording the block a blocking status earns.
     *
     * @param call - The double's call.
     * @returns Its answer.
     * @sideEffect Charges the window; may write a block.
     */
    async function admitted<T>(call: () => Promise<T>): Promise<T> {
        await limitedFetch('https://usda.invalid/admit');

        try {
            return await call();
        } catch (error) {
            if (error instanceof SourceApiError) {
                const block = blockFor(
                    { status: error.statusCode, retryAfter: null, quota: undefined },
                    apiAccessOf('usda').rateLimit,
                    Date.now(),
                );

                if (block !== undefined) {
                    await ports.blocks.record({ source: 'usda', ...block });
                }
            }

            throw error;
        }
    }

    const fetchByKeys = inner.fetchByKeys?.bind(inner);

    return {
        source: inner.source,
        searchByName: async (name: string): Promise<SourceCandidate[]> =>
            admitted(async () => inner.searchByName(name)),
        fetchByKey: async (externalKey: string): Promise<CanonicalCandidate> =>
            admitted(async () => inner.fetchByKey(externalKey)),
        ...(fetchByKeys === undefined
            ? {}
            : {
                  fetchByKeys: async (externalKeys: readonly string[]): Promise<CanonicalCandidate[]> =>
                      admitted(async () => fetchByKeys(externalKeys)),
              }),
    };
}
