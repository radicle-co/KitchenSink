/**
 * The bulk import module (ADR-0072): the `/api/v1/import` surface over the three import repositories.
 *
 * DESIGN PATTERN: **Composition root** for the import. Each repository is built over the shared Drizzle client (the
 * embedded-DAL pattern `RecipesModule` uses), and is provided under a STRING token so a test hands a service a narrow fake.
 * The import READS the recipe service's collaborators and writes none of them: a recipe is saved through
 * `RecipesService.create`, a food is bound through `IngredientsService`, and the private-slot count stays the recipe
 * service's ({@link privateSlotsOf} is a Port over it, ADR-0073).
 *
 * `RecipesModule` exports what the advance step drives (`RecipesService`, `ParseJobsService`, `MatchProposalService`, the match
 * store, the verification read model and the curation sink); `IngredientsModule` exports the food collaborators.
 */
import { Module } from '@nestjs/common';

import { ImportAllowanceDal } from '../common/dal/importAllowance.dal.js';
import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { RecipeImportItemsDal } from './dal/recipeImportItems.dal.js';
import { RecipeImportLinesDal } from './dal/recipeImportLines.dal.js';
import { RecipeImportsDal } from './dal/recipeImports.dal.js';
import { DEFAULT_IMPORT_ADVANCE_LIMITS } from './domain/importLimits.js';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';
import {
    IMPORT_ADVANCE_LIMITS,
    RECIPE_IMPORT_ITEMS_DAL,
    RECIPE_IMPORT_LINES_DAL,
    RECIPE_IMPORTS_DAL,
} from './import.tokens.js';
import { ImportAdvanceService } from './importAdvance.service.js';
import { ImportLineView } from './importLineView.js';
import { ImportStepService } from './importStep.service.js';
import { ImportViewBuilder } from './importView.builder.js';
import { PRIVATE_SLOTS, privateSlotsOf } from './privateSlots.port.js';

@Module({
    imports: [RecipesModule, IngredientsModule],
    controllers: [ImportController],
    providers: [
        {
            provide: RECIPE_IMPORTS_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): RecipeImportsDal => new RecipeImportsDal(db),
        },
        {
            provide: RECIPE_IMPORT_ITEMS_DAL,
            inject: [DrizzleProvider, ImportAllowanceDal],
            useFactory: (db: RecipeDrizzle, allowance: ImportAllowanceDal): RecipeImportItemsDal =>
                new RecipeImportItemsDal(db, allowance),
        },
        {
            provide: RECIPE_IMPORT_LINES_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): RecipeImportLinesDal => new RecipeImportLinesDal(db),
        },
        // Stateless SQL over a handle each call passes in; the same instance serves the item DAL and the view.
        ImportAllowanceDal,
        { provide: IMPORT_ADVANCE_LIMITS, useValue: DEFAULT_IMPORT_ADVANCE_LIMITS },
        {
            provide: PRIVATE_SLOTS,
            inject: [RecipesService],
            useFactory: privateSlotsOf,
        },
        ImportViewBuilder,
        ImportLineView,
        ImportService,
        ImportStepService,
        ImportAdvanceService,
    ],
})
export class ImportModule {}
