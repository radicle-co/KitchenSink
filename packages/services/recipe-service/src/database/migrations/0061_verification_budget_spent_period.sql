-- 0061 — a paste-match review the spend ceiling refused is RECORDED, with the spend period it was refused in.
--
-- ADR-0024 §3 and ADR-0071 §7 (owner ruling 2026-10-26): on the paste path a ceiling denial is not retried. The worker
-- stores the fact on the review's own attempt row, under its verification key, and acknowledges the message. The cook
-- then sees every food as a choice (`matchStateOf`, reason `reviewBudgetSpent`).
--
-- ⛔ WHY A COLUMN ON THE ATTEMPT ROW, NOT A VERDICT. A verdict says the model judged the line; an absent verdict is the
-- only thing that lets a line publish unchecked, and "budget spent" is not a judgement (ADR-0024: recording a billing
-- denial as one invents the wrong-DISAGREE outcome). The attempt row is the existing per-key bookkeeping the claim has
-- already written before any reservation, and `recordVerdict` deletes it, so a real verdict retires the fact with it.
--
-- ⛔ THE PERIOD IS CAPTURED AT RESERVE (ADR-0024 §2) and stored with the fact. The fact counts as "spent" only while that
-- period is the current UTC month, so a new month, or a ceiling raised later, never leaves a line stuck as spent: the
-- next matches call sends the review again once the period has moved on.
--
-- ⚠️ EXPAND-FIRST (ADR-0035): a nullable column nothing wrote before. An older worker never sets it, an older service
-- never reads it, and NULL means "no budget outcome", which is what every existing row is.
-- ⚠️ `lock_timeout`: ALTER TABLE takes ACCESS EXCLUSIVE, and the runner's own lock_timeout covers only its advisory lock.
--   A deploy that cannot take the table lock in 5 s fails and a re-run retries it, instead of stalling every query
--   queued behind it (food 0025 to 0027 do the same; `migrationLockTimeout.test.ts` holds the rule).

SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_verification_attempts
    ADD COLUMN IF NOT EXISTS budget_spent_period text;

ALTER TABLE recipe_verification_attempts
    ADD CONSTRAINT recipe_verification_attempts_budget_spent_period_shape
    CHECK (budget_spent_period IS NULL OR budget_spent_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
