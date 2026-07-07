import { Module } from '@nestjs/common';

/**
 * Recipes module skeleton. Owns recipe CRUD and ownership (`owner_id`/`created_by` = app-user ULID).
 * Controllers, services, and DAOs are added in a later phase.
 */
@Module({})
export class RecipesModule {}
