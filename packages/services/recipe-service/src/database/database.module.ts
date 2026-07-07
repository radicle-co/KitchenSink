import { Module } from '@nestjs/common';

/**
 * Database module skeleton. Owns the Drizzle provider over the shared RDS `kitchensink_recipes`
 * logical database (passwordless RDS-IAM, `recipe_app` role). Schema, DAOs, and the pool provider
 * are added in a later phase.
 */
@Module({})
export class DatabaseModule {}
