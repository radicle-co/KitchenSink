import { Module } from '@nestjs/common';

import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { AuthorHandlesDal } from '../authors/dal/authorHandles.dal.js';
import { CollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';
import { CollectionsDal } from './dal/collections.dal.js';

/**
 * Collections module (T041). Owns user recipe collections and their membership: CRUD, the visibility
 * toggle (FR-010), and add/remove of recipes (many-to-many, no-cascade delete). The Drizzle client is
 * injected into {@link CollectionsDal} from the global `DatabaseModule`.
 *
 * W5 Task 2: also wires its OWN {@link AuthorHandlesDal} instance over the shared Drizzle client (same
 * factory pattern `RecipesModule` uses for its embedded DALs) so `cloneCollection` can resolve the
 * source owner's CURRENT display handle to freeze onto the clone, WITHOUT importing an AuthorsModule.
 */
@Module({
    controllers: [CollectionsController],
    providers: [
        CollectionsService,
        CollectionsDal,
        {
            provide: AuthorHandlesDal,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): AuthorHandlesDal => new AuthorHandlesDal(db),
        },
    ],
    exports: [CollectionsService],
})
export class CollectionsModule {}
