# Runbook — GDPR erasure of copies (backups, queues, logs)

> **Scope.** GDPR Art. 17(1) requires erasing personal data across **all copies**, not just the
> primary store. Erasing a user's rows from RDS does not, by itself, remove the personal data that
> transiently exists in **automated backups, message queues, object-store versions, and logs**. This
> runbook states the residual windows (the accepted, time-boxed residual) and the **restore →
> re-erase** procedure for the one case that can resurrect erased data: a database restore taken
> before an erasure.
>
> Status: operational control for the shipped erasure path. The **cross-service erasure itself**
> (identity + recipe + food) is CR-002 (unbuilt); this runbook applies to whatever erasure is live.

---

## 1. Where erased personal data can transiently persist (residual windows)

All windows below are **bounded** — the residual self-expires. That bounded residual is the accepted
Art. 17 posture; the only unbounded hazard is a **manual RDS snapshot** (§4).

| Copy                                              | Retention (verified)                                 | Source                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **RDS automated backups** (point-in-time)         | **7 days**                                           | `packages/infra/global/lib/platform/data-stack.ts:148` (`backupRetention: Duration.days(7)`) |
| **RDS manual snapshots**                          | **UNBOUNDED** until deleted                          | operator-created; **not** governed by `backupRetention` — see §4                             |
| **SQS deletion / erasure queues**                 | 14 days (message retention) / 4 days (DLQ)           | `data-stack.ts:257,263`; `recipe-workers-stack.ts:184,206`                                   |
| **S3 versioned buckets** (recipe media/versions)  | non-current versions expire per lifecycle (≈30 days) | `data-stack.ts:296` (`expiration: Duration.days(30)`) — verify per bucket                    |
| **CloudWatch logs** — identity, identity-webhooks | 1 month                                              | `identity-service-stack.ts:176`, `webhooks-stack.ts:167,344,350`                             |
| **CloudWatch logs** — recipe-workers              | 2 weeks                                              | `recipe-workers-stack.ts:175`                                                                |
| **Sentry**                                        | per project retention (Sentry-side setting)          | out-of-repo; confirm in the Sentry org settings                                              |

**Logs already minimize going forward.** As of the observability-scrub change, person-linked ids
(Clerk `sub`, app ULID) are **pseudonymized** at the log/Sentry boundary (`anon_<hash>`), so _new_
log/Sentry entries do not carry a raw re-identifier. The residual is limited to **pre-scrub log lines
aging out** within the windows above — no action required; they expire automatically. (Free-text
error messages remain scrubbed for email/bearer/`sub`; ULIDs embedded in free text are the known
residual — see the scrubber's `scrubText` note.)

---

## 2. Does a normal erasure need any queue/log/S3 cleanup? — No

- **Queues.** An erasure message is consumed within seconds/minutes; DLQ entries are operational
  metadata (they carry a pseudonymizable id, not profile PII) and expire in ≤14 days. No manual purge.
- **S3.** The erasure worker deletes the owner's objects; the orphan-sweeper (hourly, both buckets)
  reclaims late writes. Non-current **versions** expire per the bucket lifecycle. No manual step.
- **Logs.** Minimized at write (pseudonymized) + bounded retention. No manual scrub.

The **only** manual GDPR action tied to erasure is a **database restore that predates it** (§3), plus
the standing **manual-snapshot discipline** (§4).

---

## 3. Restore → re-erase procedure (the one that can resurrect erased data)

A point-in-time restore or snapshot restore reintroduces every row that existed at the backup's
timestamp — **including users erased after that timestamp**. Whenever a restore is performed onto a
live/production database, the erasures that happened between the backup time and now MUST be replayed.

**Trigger:** any restore of a production RDS instance/cluster (DR, corruption recovery, rollback) from
a backup/snapshot older than the most recent erasure.

**Procedure:**

1. **Record the backup timestamp** `T_backup` of the restored data.
2. **Enumerate erasures since `T_backup`.** Query the erasure records that completed after `T_backup`:
    - recipe: `SELECT owner_id FROM account_erasure_jobs WHERE status = 'completed' AND updated_at >= '<T_backup>'`
    - identity: the erased-lifecycle rows (once CR-002 ships the audit trail R8, use `lifecycle_events`
      where `event = 'erased' AND occurred_at >= '<T_backup>'`; until then, cross-reference the deletion
      queue / operator record of honored erasure requests).
    - **The erasure job/audit rows survive the restore** iff they were created before `T_backup`; for
      erasures whose _audit_ row is itself newer than `T_backup`, reconcile against an out-of-band
      record (the ticket/request log) — do not rely solely on the restored DB to know who was erased.
3. **Re-run erasure for each `owner_id`.** Re-drive the erasure for the affected owners through the
   normal path (the recipe erasure endpoint / the deletion-worker orchestration) rather than ad-hoc
   `DELETE`s, so all legs (identity scrub/Clerk delete, recipe, food) run and are re-audited.
4. **Verify.** For each re-erased owner, confirm the erasure completion contract passed (no
   "erasure incomplete" alarm) and spot-check the primary stores.
5. **Record** the re-erasure batch (timestamps, owner count, trigger) in the incident/change log for
   Art. 30 accountability.

> Keep an **out-of-band list of honored erasure requests** (ticket ids + app ULIDs + completion time),
> independent of the database, so step 2 is possible even when the restore predates the audit rows.

---

## 4. Standing controls

- **No unbounded manual snapshots of production.** Manual RDS snapshots are **not** governed by the
  7-day `backupRetention` and persist until explicitly deleted — an indefinite copy of every user's
  PII. Rule: do not take manual prod snapshots for routine work; if one is required (e.g. a migration
  safety net), it MUST be tagged with an owner + expiry and deleted within a defined window (recommend
  ≤7 days to match automated backups). Audit existing manual snapshots periodically and expire them.
- **Retention is the residual bound.** The windows in §1 are the documented, accepted Art. 17
  residual. Shortening them (e.g. CloudWatch to 7 days) is the lever if the residual must be tighter;
  it trades against incident-investigation depth.
- **Sentry retention** is set in the Sentry org/project, not this repo — confirm it is bounded and
  compatible with the residual posture.

---

## 5. Not covered here (tracked elsewhere)

- **Forward log/Sentry minimization** — shipped (id pseudonymization at the scrub seams).
- **12-month tombstone → auto-erasure sweep (KTD-3)** — blocked on CR-002 U2 (the `tombstoned`
  lifecycle state does not exist yet); build the sweep with that unit.
- **Data-subject access/export (Art. 15/20)** — a separate feature (no export endpoint exists).
