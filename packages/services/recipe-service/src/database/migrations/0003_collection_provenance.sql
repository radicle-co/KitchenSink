-- 0003: collection clone provenance (T119 / FR-011)
--
-- Additive delta applied AFTER 0002. Adds:
--   * collections.source_collection_id — self-FK snapshot of the source at clone time. ON DELETE SET
--     NULL: deleting a source collection orphans the clone's provenance pointer rather than cascading.
--   * recipe_collections.added_via — how a recipe entered the collection (manual | clone_seed | pull).
--     NOT NULL DEFAULT 'manual' backfills every existing membership to 'manual'.
-- Implements: T119, FR-011.

ALTER TABLE "collections"
    ADD COLUMN "source_collection_id" uuid REFERENCES "collections"("id") ON DELETE SET NULL;

CREATE INDEX "idx_collections_source_collection" ON "collections" USING btree ("source_collection_id")
    WHERE "source_collection_id" IS NOT NULL;

ALTER TABLE "recipe_collections"
    ADD COLUMN "added_via" text DEFAULT 'manual' NOT NULL;

ALTER TABLE "recipe_collections"
    ADD CONSTRAINT "recipe_collections_added_via_check" CHECK ("added_via" IN ('manual', 'clone_seed', 'pull'));
