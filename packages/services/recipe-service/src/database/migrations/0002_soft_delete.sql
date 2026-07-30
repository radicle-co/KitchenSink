-- 0002: soft-delete tombstone (T118 / C-007)
--
-- Additive delta applied AFTER 0001 by the in-VPC migration runner. Adds the recipe soft-delete
-- tombstone and redefines the owner index as PARTIAL over active rows: every production read path
-- filters `deleted_at IS NULL` (data-model "Read-path filter rule"), so the plain owner index from 0001
-- is superseded by a partial one that indexes only live recipes.
-- Implements: T118, C-007.

ALTER TABLE "recipes" ADD COLUMN "deleted_at" timestamp with time zone;

DROP INDEX IF EXISTS "idx_recipes_owner_id";
CREATE INDEX "idx_recipes_owner_id" ON "recipes" USING btree ("owner_id") WHERE "deleted_at" IS NULL;
