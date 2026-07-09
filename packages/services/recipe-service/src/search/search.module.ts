import { Module } from '@nestjs/common';

import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { SearchController } from './search.controller.js';
import { SearchService, SEARCH_DAL } from './search.service.js';
import { SearchDal } from './dal/search.dal.js';

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
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): SearchDal => new SearchDal(db),
        },
        SearchService,
    ],
    exports: [SearchService],
})
export class SearchModule {}
