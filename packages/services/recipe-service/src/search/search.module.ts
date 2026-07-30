import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { SearchController } from './search.controller.js';
import { SearchService, SEARCH_DAL } from './search.service.js';
import { SearchDal, FACET_SAMPLE_SIZE } from './dal/search.dal.js';

/**
 * Search module. Owns ranked full-text recipe search + facet aggregation. Wires the {@link SearchDal}
 * over the global Drizzle client, the {@link SearchService} that shapes the paginated envelope, and the
 * {@link SearchController} REST surface (`/v1/search/recipes`). The global `AuthMiddleware` (applied in
 * `AppModule`) populates `req.principal`, whose `userId` scopes visibility to public + owned recipes.
 */
@Module({
    controllers: [SearchController],
    providers: [
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
