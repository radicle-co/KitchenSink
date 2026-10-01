/**
 * The catalog owner reader over one Drizzle client, wired as `FoodsModule` wires it (curated plan U8 S4), for the
 * real-database suites that construct services by hand.
 */
import { CatalogOwnerReader } from '../../src/foods/catalogOwnerReader.service.js';
import type { FoodWriter } from '../../src/database/unitOfWork.js';
import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { FoodForwardDao } from '../../src/foods/dao/foodForward.dao.js';
import { FoodSourcesDao } from '../../src/foods/dao/foodSources.dao.js';
import { FoodVariantDao } from '../../src/foods/dao/foodVariant.dao.js';
import { FoodMetrics } from '../../src/observability/emfMetrics.js';

/**
 * Build the reader.
 *
 * @param db - The client every DAO reads through.
 * @param sink - Where the reader's metric lines go; discarded by default.
 * @returns The reader.
 */
export function makeCatalogOwnerReader(
    db: FoodWriter,
    sink: (line: string) => void = () => undefined,
): CatalogOwnerReader {
    return new CatalogOwnerReader(
        new FoodSourcesDao(db),
        new FoodForwardDao(db),
        new FoodVariantDao(db),
        new FoodDao(db),
        new FoodMetrics(sink),
    );
}
