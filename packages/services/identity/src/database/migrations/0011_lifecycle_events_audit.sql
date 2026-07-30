-- CR-002 R8: the append-only Art. 30 audit trail for account lifecycle transitions.
--
-- One immutable row per closure / erasure / reactivation, written in the SAME transaction as the state change
-- it records, so the audit can never drift from the mutable users.status column. Rows are NEVER updated or
-- deleted. `user_id` is the durable app ULID, deliberately NOT an FK: the referenced users row is scrubbed but
-- never hard-deleted, and the audit must outlive any given lifecycle state.
CREATE TABLE lifecycle_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    event TEXT NOT NULL,
    trigger_source TEXT NOT NULL,
    actor TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lifecycle_events_user_id_idx ON lifecycle_events (user_id);
