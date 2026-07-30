/**
 * `FakeRecipeServiceClient` (CP-6 T3) — the public, type-checked test double for {@link RecipeServiceClient}.
 *
 * Rather than hand-building a partial object literal (e.g. `{ listRecipes: () => ... }`) and force-casting
 * it `as unknown as RecipeServiceClient`, {@link createFakeRecipeServiceClient} returns a REAL client
 * instance wired to a network-guard `fetch` that rejects any request no test has stubbed. Callers stub the
 * methods they exercise with `vi.spyOn(client, 'methodName')` — a spy checked against the real method's
 * signature, so a rename, a reordered parameter, or a reshaped return value fails `tsc`, not just the
 * assertion at runtime. Nothing about the client's own logic (URL building, error mapping, retries) is
 * faked; only the transport is.
 *
 * This generalizes the "real instance + `vi.spyOn`" pattern the package's own hook tests already use
 * (`__tests__/utils/hookHarness.ts`, which now delegates its `makeGuardedClient` to this module) so every
 * consumer — web, mobile, and shared test utilities such as `@commise/test-utils`'s `renderWithRecipeClient`
 * — gets it from one public `@kitchensink/recipe-service-client/testing` subpath.
 */
import { RecipeServiceClient } from '../client.js';
import type { RecipeServiceClientOptions } from '../client.js';

/** Raised by the guard `fetch` when a caller reaches the network — i.e. a client method was left unstubbed. */
export const NETWORK_GUARD_MESSAGE =
    'FakeRecipeServiceClient: unstubbed method reached the network — spy on it first, e.g. ' +
    "vi.spyOn(client, 'methodName').mockResolvedValue(...).";

/** A `fetch` that always rejects, so any call through an un-stubbed client method fails loudly. */
function networkGuardFetch(): typeof fetch {
    return (() => Promise.reject(new Error(NETWORK_GUARD_MESSAGE))) as unknown as typeof fetch;
}

/** Optional overrides for {@link createFakeRecipeServiceClient} — every field defaults to an inert test value. */
export interface FakeRecipeServiceClientOptions {
    /** Defaults to an obviously-fake origin; only matters if a test inspects a request URL. */
    readonly baseUrl?: string;
    /** Defaults to a literal placeholder token; only matters if a test inspects the `Authorization` header. */
    readonly token?: RecipeServiceClientOptions['token'];
}

/**
 * Build a real {@link RecipeServiceClient} whose transport can never fire, for `vi.spyOn` to stub per test.
 *
 * @param options - Optional base URL / token overrides (rarely needed — the defaults are inert).
 * @returns A client wired to a rejecting `fetch` guard.
 * @sideEffect Constructs a client holding a network-guard `fetch`.
 */
export function createFakeRecipeServiceClient(options: FakeRecipeServiceClientOptions = {}): RecipeServiceClient {
    return new RecipeServiceClient({
        baseUrl: options.baseUrl ?? 'https://recipes.fake.invalid',
        token: options.token ?? 'tok_fake',
        fetch: networkGuardFetch(),
    });
}
