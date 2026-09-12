import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { FoodServiceClients } from '../ingredients/FoodServiceClients.factory.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { SearchController } from './search.controller.js';
import { SearchService, SEARCH_DAL } from './search.service.js';
import { SearchDal, FACET_SAMPLE_SIZE } from './dal/search.dal.js';
import { FoodFilterExpansionGateway } from './foodFilterExpansion.gateway.js';

/**
 * Search module. Owns ranked full-text recipe search + facet aggregation. Wires the {@link SearchDal}
 * over the global Drizzle client, the {@link SearchService} that shapes the paginated envelope, and the
 * {@link SearchController} REST surface (`/api/v1/search/recipes`). The global `AuthMiddleware` (applied in
 * `AppModule`) populates `req.principal`, whose `userId` scopes visibility to public + owned recipes.
 *
 * A food filter is widened to each root's live variants by the {@link FoodFilterExpansionGateway}, over the
 * per-caller food client factory `IngredientsModule` owns and exports (curated U9).
 */
@Module({
    imports: [IngredientsModule],
    controllers: [SearchController],
    providers: [
        {
            provide: FoodFilterExpansionGateway,
            inject: [FoodServiceClients],
            useFactory: (clients: FoodServiceClients): FoodFilterExpansionGateway =>
                new FoodFilterExpansionGateway(clients),
        },
        {
            provide: SEARCH_DAL,
            inject: [DrizzleProvider, ConfigService],
            // The cover-photo LATERAL yields an object key; the DAL resolves it to an absolute CDN URL
            // against CLOUDFRONT_URL (same base the recipes vertical uses for embedded photo URLs).
            useFactory: (db: RecipeDrizzle, config: ConfigService): SearchDal =>
                new SearchDal(db, FACET_SAMPLE_SIZE, config.getOrThrow<string>('CLOUDFRONT_URL')),
        },
        SearchService,
    ],
    exports: [SearchService],
})
export class SearchModule {}
