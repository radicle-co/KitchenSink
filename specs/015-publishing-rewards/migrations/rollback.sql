-- Rollback for 0025_publishing_rewards.sql (feature 015).
--
-- ⛔⛔ PRE-LAUNCH USE ONLY. THIS IS DESTRUCTIVE TO PERMANENT STATE.
--
-- `reward_grants` holds slot grants that FR-007b makes PERMANENT — never revoked for unpublishing, for a
-- lapsed subscription, or by the passage of time. Dropping the table destroys them irreversibly, which is
-- not a rollback of a feature but a breach of its central promise to every user who earned one.
--
-- AFTER THE FEATURE HAS BEEN LIVE TO REAL USERS: do NOT run this. Roll back the APPLICATION and leave the
-- tables in place. They are purely additive and completely inert when no code reads them — there is no
-- correctness reason to drop them and a severe one not to.
--
-- Order is reverse-dependency: grants reference listings.

DROP TABLE IF EXISTS reward_grants;
DROP TABLE IF EXISTS recipe_public_listings;
DROP TRIGGER IF EXISTS trg_contributor_standing_ratchet ON contributor_standing;
DROP FUNCTION IF EXISTS contributor_standing_ratchet();
DROP TABLE IF EXISTS contributor_standing;
DROP TABLE IF EXISTS recipe_impact_signals;
