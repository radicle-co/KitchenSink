-- 0082 — a held bulk-import item records WHY it was held, and the cook facts that decided it (review M1 on #220).
--
-- A hold keeps an item out of the save queue while `held_at_rev = decision_rev`, so only a decision of the cook released it.
-- That is right for a cause inside the item (a missing cuisine, servings or times, a refusal, a payload the save cannot read).
-- It is wrong for a cause the COOK'S FACTS decide: the label judged under their containment, or a create refused under their
-- plan. An upgrade changes the outcome with no decision at all, and the item stayed held for good under `saveRefused`.
--
--  - `held_reason`: why the save held the item: `item`, `unreadable`, `visibility` or `createRefused`. NULL for a hold written
--    before this file, which the service reads as `item` (only a decision releases it, as before).
--  - `held_cook_key`: for `visibility` and `createRefused` only, the cook facts the hold was judged under (`cookKeyOf`: the
--    principal kind, the containment and the plan). The save queue leaves the item out only for a cook with the same key.
--
-- Additive and expand-only (ADR-0035): two nullable columns, and no backfill. The CHECK admits a hold with NO reason, so the
-- running release, which writes `held_at_rev` alone, keeps working until the new one is deployed. It is added NOT VALID: it
-- binds every write at once, and 0083 scans the existing rows under a lighter lock. No GRANT: the service role's DML on this
-- table comes from 0059 (ADR-0039).

-- ⚠️ Bounded wait: ALTER TABLE takes ACCESS EXCLUSIVE on the table. A deploy that cannot take it in 5 s fails and a re-run
-- retries it (`migrationLockTimeout.test.ts` holds the rule).
SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_import_items
    ADD COLUMN held_reason text,
    ADD COLUMN held_cook_key text;

-- ⚠️ A CASE, not an OR of arms: a CHECK passes on NULL, and with `held_reason` NULL every `IN` arm is NULL, so an OR would
-- admit cook facts with no reason. Each branch here is a definite true or false.
ALTER TABLE recipe_import_items
    ADD CONSTRAINT recipe_import_items_held_reason_check CHECK (
        CASE
            WHEN held_reason IS NULL THEN held_cook_key IS NULL
            WHEN held_reason IN ('item', 'unreadable') THEN held_at_rev IS NOT NULL AND held_cook_key IS NULL
            WHEN held_reason IN ('visibility', 'createRefused') THEN held_at_rev IS NOT NULL AND held_cook_key IS NOT NULL
            ELSE false
        END
    ) NOT VALID;
