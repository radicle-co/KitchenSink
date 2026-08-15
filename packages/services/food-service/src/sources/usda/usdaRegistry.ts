/**
 * The ONE composition of the wired source-adapter registry (currently USDA only, FR-ADP-1).
 *
 * Three composition roots built this independently — `worker/main.ts`, `worker/change-refresh/main.ts`,
 * and `foods/foods.module.ts` — and all three drifted from each other:
 *
 * - each read `USDA_API_KEY` off `process.env` itself, with THREE different behaviours on absence: two
 *   bespoke `throw new Error('USDA_API_KEY is required to run …')` messages, and — in the Nest factory —
 *   `?? ''`, which builds a client that would call USDA with an empty key;
 * - none passed `USDA_API_BASE_URL`, so that documented, boot-validated setting had NO consumer anywhere.
 *   Pointing a preview at a stub or proxy base URL silently kept charging the real USDA quota, which is
 *   shared across every stage.
 *
 * Both settings now come from the ONE validated reader (`settingFromEnv`), so their rules and defaults live
 * only in `config/env.schema.ts` and a malformed value fails loudly, naming the variable.
 *
 * Pattern: Factory (a composition root's worth of wiring behind one named function), extracted for the same
 * reason `worker/concurrency.ts` was — both Fargate entrypoints run `void bootstrap()` on import, so
 * nothing composed inside them can be tested without starting a worker.
 *
 * @implements FR-ADP-1 FR-019
 */
import { UsdaApiClient } from '@kitchensink/usda-client';

import { settingFromEnv } from '../../config/env.schema.js';
import { SourceAdapterRegistry } from '../SourceAdapterRegistry.js';
import { UsdaSourceAdapter } from './usda.adapter.js';

/**
 * Build the source-adapter registry with the USDA adapter wired from the validated environment.
 *
 * @returns A registry holding the `usda` adapter.
 * @throws {Error} naming the variable when `USDA_API_KEY` is absent or `USDA_API_BASE_URL` is malformed —
 *   a food service that cannot reach a source must fail at composition, not on its first fan-out.
 * @sideEffect Reads `process.env`.
 */
export function createUsdaSourceRegistry(): SourceAdapterRegistry {
    const registry = new SourceAdapterRegistry();

    registry.register(
        new UsdaSourceAdapter(
            new UsdaApiClient({
                apiKey: settingFromEnv('USDA_API_KEY'),
                baseUrl: settingFromEnv('USDA_API_BASE_URL'),
            }),
        ),
    );

    return registry;
}
