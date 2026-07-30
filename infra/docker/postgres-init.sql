-- infra/docker/postgres-init.sql (T006a)
--
-- Runs ONCE, on first initialization of the Postgres data volume (mounted into
-- `/docker-entrypoint-initdb.d/`). Enables the two extensions the recipe schema depends on so a
-- fresh local/CI database matches the shared RDS instance (where they are pre-bootstrapped):
--
--   * pgcrypto — `gen_random_uuid()` for the UUID primary keys.
--   * pg_trgm  — the GIN trigram index behind fuzzy ingredient autocomplete
--                (`idx_ingredients_name_trgm ... gin_trgm_ops`).
--
-- The `0001_initial.sql` migration also issues `CREATE EXTENSION IF NOT EXISTS` for both, so this file
-- is belt-and-suspenders: it guarantees the extensions exist even before migrations run, and the
-- `IF NOT EXISTS` guards make the two paths idempotent together.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
