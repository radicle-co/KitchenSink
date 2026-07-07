import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/config.module.js';
import { CommonModule } from './common/common.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RecipesModule } from './recipes/recipes.module.js';
import { IngredientsModule } from './ingredients/ingredients.module.js';
import { VersionsModule } from './versions/versions.module.js';
import { PhotosModule } from './photos/photos.module.js';
import { CollectionsModule } from './collections/collections.module.js';
import { SearchModule } from './search/search.module.js';
import { AccountModule } from './account/account.module.js';

@Module({
    imports: [
        AppConfigModule,
        CommonModule,
        DatabaseModule,
        HealthModule,
        AuthModule,
        RecipesModule,
        IngredientsModule,
        VersionsModule,
        PhotosModule,
        CollectionsModule,
        SearchModule,
        AccountModule,
    ],
})
export class AppModule {}
