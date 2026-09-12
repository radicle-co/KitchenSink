-- Validation queries for 0026_publishing_rewards.sql (feature 015).
-- Run AFTER the migration. Every query is read-only. Each states its PASS condition explicitly.

-- Q1 — all four tables exist. PASS: 4 rows.
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = current_schema()
   AND table_name IN ('recipe_public_listings', 'reward_grants', 'recipe_impact_signals', 'contributor_standing')
 ORDER BY table_name;

-- Q2 — the FR-007i ratchet constraint is actually present. PASS: 1 row.
-- If this returns 0 rows the ratchet is application-discipline only, which is exactly what it must not be.
SELECT conname
  FROM pg_constraint
 WHERE conname = 'contributor_standing_ratchet';

-- Q3 — R6 reconciliation: materialized slot balance vs the ledger (source of truth).
-- PASS: 0 rows. Any row is a drift that silently grants or denies privacy.
-- (Compare against the service's materialized balance once E048 exists; pre-implementation this
--  establishes the ledger-side figure.)
SELECT owner_id, SUM(amount) AS ledger_slots
  FROM reward_grants
 WHERE kind = 'slot'
   AND reversed_at IS NULL
 GROUP BY owner_id
HAVING SUM(amount) > 50;   -- FR-007c: no account may exceed the 50-slot ceiling. PASS: 0 rows.

-- Q4 — SC-002: every ELIGIBLE listing carries an attestation. PASS: 0 rows.
-- A grant with no attestation is a defect, not a data-quality issue.
SELECT l.id, l.recipe_id, l.owner_id
  FROM recipe_public_listings l
 WHERE l.eligibility_decision = 'eligible'
   AND l.attestation_accepted_at IS NULL;

-- Q5 — R2: did the §4 restitution backfill run?
-- Expected 0 rows UNLESS the grandfathering decision (migration-plan.md §3) was explicitly taken.
-- A non-zero count here without that decision means slots were granted that nobody authorised.
SELECT count(*) AS restitution_listings
  FROM recipe_public_listings
 WHERE eligibility_decision = 'grandfathered';

-- Q6 — SC-003: no grant exists for a recipe whose provenance is imported or cloned. PASS: 0 rows.
-- This is the anti-inducement control (FR-001) asserted against real data rather than trusted.
SELECT g.id, r.id AS recipe_id, r.source_type
  FROM reward_grants g
  JOIN recipe_public_listings l ON l.id = g.listing_id
  JOIN recipes r ON r.id = l.recipe_id
 WHERE r.source_type <> 'user_created'
   AND g.reversed_at IS NULL;

-- Q7 — 012-FR-024: impact signals remain aggregate-only. PASS: 0 rows.
-- Fails loudly if anyone ever adds a column that could identify a viewer.
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND table_name = 'recipe_impact_signals'
   AND column_name NOT IN ('recipe_id', 'cook_count', 'save_count', 'updated_at');

-- Q8 — 2.2: impact signals did NOT re-introduce a duplicate rating aggregate. PASS: 0 rows.
-- `recipes.average_rating` / `recipes.rating_count` are the single source, trigger-maintained.
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND table_name = 'recipe_impact_signals'
   AND column_name LIKE '%rating%';
