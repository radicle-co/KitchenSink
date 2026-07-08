import { Module } from '@nestjs/common';

import { CollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';
import { CollectionsDal } from './dal/collections.dal.js';

/**
 * Collections module (T041). Owns user recipe collections and their membership: CRUD, the visibility
 * toggle (FR-010), and add/remove of recipes (many-to-many, no-cascade delete). The Drizzle client is
 * injected into {@link CollectionsDal} from the global `DatabaseModule`.
 */
@Module({
    controllers: [CollectionsController],
    providers: [CollectionsService, CollectionsDal],
    exports: [CollectionsService],
})
export class CollectionsModule {}
