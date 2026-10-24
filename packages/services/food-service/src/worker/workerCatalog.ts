/**
 * The catalog questions the fan-out worker asks (FOOD-SERVICE-6), composed once over a Drizzle client: the same name
 * matcher add-by-name asks and the same owner reader remote search hides by, so the worker cannot answer either
 * question differently from the API.
 *
 * @module
 */
import type { FoodDrizzle } from '../database/database.module.js';
import { CatalogNameMatcher } from '../foods/catalogNameMatcher.service.js';
import { CatalogOwnerReader } from '../foods/catalogOwnerReader.service.js';
import { FoodDao } from '../foods/dao/food.dao.js';
import { FoodForwardDao } from '../foods/dao/foodForward.dao.js';
import { FoodSearchDao } from '../foods/dao/foodSearch.dao.js';
import { FoodSourcesDao } from '../foods/dao/foodSources.dao.js';
import { FoodVariantDao } from '../foods/dao/foodVariant.dao.js';
import type { FoodMetrics } from '../observability/emfMetrics.js';
import type { WorkerCatalog } from './foodConsumer.service.js';

/**
 * Compose the worker's catalog over one client.
 *
 * @param db - The client every read goes through.
 * @param metrics - Where the owner reader's lineage and forward signals go.
 * @returns The worker's catalog.
 */
export function workerCatalogOf(db: FoodDrizzle, metrics: FoodMetrics): WorkerCatalog {
    const variants = new FoodVariantDao(db);

    return {
        names: new CatalogNameMatcher(new FoodSearchDao(db), variants),
        owners: new CatalogOwnerReader(
            new FoodSourcesDao(db),
            new FoodForwardDao(db),
            variants,
            new FoodDao(db),
            metrics,
        ),
    };
}
