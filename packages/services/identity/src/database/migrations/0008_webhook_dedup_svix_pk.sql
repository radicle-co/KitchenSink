-- A2: webhook dedup keys on the svix_id PRIMARY KEY (svix guarantees a unique id per delivery).
--
-- 0007 added UNIQUE(identity_id, event_type), which is wrong: it permits only ONE row per
-- (identity_id, event_type) pair. With recordOnce writing the placeholder ('unknown','unknown'),
-- only the first-ever event could record and dedup silently failed for every event thereafter; even
-- with real values it would collide on legitimate repeats (e.g. several user.updated for one user).
-- Drop it. IF EXISTS tolerates stages where 0007 was never applied.
ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS uq_webhook_events_identity_event;
