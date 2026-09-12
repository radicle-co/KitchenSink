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

| Copy                                              | Retention (verified)                                 | Source                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **RDS automated backups** (point-in-time)         | **7 days**                                           | `packages/infra/global/lib/platform/DataStack.ts:148` (`backupRetention: Duration.days(7)`)     |
| **RDS manual snapshots**                          | **UNBOUNDED** until deleted                          | operator-created; **not** governed by `backupRetention` — see §4                                |
| **SQS deletion / erasure queues**                 | 14 days (message retention) / 4 days (DLQ)           | `DataStack.ts:257,263`; `RecipeWorkersStack.ts:184,206`                                         |
| **S3 versioned buckets** (recipe media/versions)  | non-current versions expire per lifecycle (≈30 days) | `DataStack.ts:296` (`expiration: Duration.days(30)`) — verify per bucket                        |
| **CloudWatch logs** — identity, identity-webhooks | 1 month                                              | `IdentityServiceStack.ts:176`, `WebhooksStack.ts:167,344,350`                                   |
| **CloudWatch logs** — recipe-workers              | 2 weeks                                              | `RecipeWorkersStack.ts:175`                                                                     |
| **Sentry**                                        | per project retention (Sentry-side setting)          | out-of-repo; confirm in the Sentry org settings                                                 |
| **Vercel Web Analytics** (web page views)         | **24 h** visitor hash, then aggregate-only — see §1a | `packages/apps/commise/web/src/lib/analyticsRedaction.ts` (redaction); retention is Vercel-side |

**Logs already minimize going forward.** As of the observability-scrub change, person-linked ids
(Clerk `sub`, app ULID) are **pseudonymized** at the log/Sentry boundary (`anon_<hash>`), so _new_
log/Sentry entries do not carry a raw re-identifier. The residual is limited to **pre-scrub log lines
aging out** within the windows above — no action required; they expire automatically. (Free-text
error messages remain scrubbed for email/bearer/`sub`; ULIDs embedded in free text are the known
residual — see the scrubber's `scrubText` note.)

### 1a. Vercel Web Analytics — a sink that is OUTSIDE the Art. 17 erasure surface (reasoned, not assumed)

`<RedactedAnalytics />` (mounted once, in `packages/apps/commise/web/src/app/[locale]/layout.tsx`) reports a
page view per navigation to Vercel Web Analytics. It is listed here because it is a copy of behavioural data
living outside the primary database — but it does **not** carry a per-data-subject record we could erase, for
three stacked reasons. **All three are conditions, not permanent facts** — see the invalidating changes below.

1. **What it collects, after redaction.** The `beforeSend` interceptor
   (`web/src/lib/analyticsRedaction.ts`) projects every event URL onto `origin + pathname` and nothing else:
   the **entire query string is dropped** (default-deny — no allowlist, no denylist), along with the fragment
   and any URL userinfo, and email/bearer-shaped substrings are scrubbed out of the path. That is what keeps
   `/[locale]/discover`'s free-text `query` and its `dietaryFlags` — vegan / gluten-free / kosher, i.e.
   plausibly health-condition or religious-observance data and therefore **Art. 9 special category** — off
   the wire entirely, together with the credential-shaped `__clerk_handshake` / `__clerk_ticket`. What
   remains: host, locale, route path, and opaque **content** ULIDs (a recipe/collection id). Vercel adds its
   own request-derived attributes (referrer, device/OS/browser, coarse geography).
2. **No identifier we hold is ever sent.** The app passes no app ULID, no Clerk `sub`, and no email to
   analytics — it calls no `track()` at all, and the redacted URL cannot contain one. The visitor is
   identified only by a **hash Vercel computes from the incoming request** (cookieless), which Vercel
   discards after **24 hours**; only aggregate counts survive. So for a given data subject there is **no key
   to search by** — not for us, and not for Vercel on a forwarded request. A content ULID in a path is the
   id of a _recipe_, not of a viewer: joining it back to our database reveals an owner, not who did the
   viewing, so it yields no viewer-level record either.
3. **The residual is bounded and self-expiring.** Within the ≤24 h window the pseudonymous hash makes those
   page views arguably personal data; past it, what is left is anonymous statistics (recital 26) and outside
   the GDPR entirely. That is the same bounded-residual posture as every other row in §1, at the shortest
   window of any of them.

**Conclusion: OUTSIDE the Art. 17 surface — no erasure action on a deletion request, and no manual step.**
The residual expires on its own within 24 h.

**What would invalidate this and pull analytics INSIDE the surface** (treat any of these as a privacy change
needing its own review, not a refactor): removing or weakening the `beforeSend` interceptor; mounting
`@vercel/analytics` anywhere other than `<RedactedAnalytics />`; calling `track()` with an app ULID, Clerk
`sub`, email, or any other user identifier in the event name or properties; putting a user identifier into a
URL **path** segment (paths survive redaction by design — only the query string is dropped); or enabling a
Vercel feature that persists a durable per-visitor identifier beyond the 24 h hash.

---

## 2. Does a normal erasure need any queue/log/S3 cleanup? — No

- **Queues.** An erasure message is consumed within seconds/minutes; DLQ entries are operational
  metadata (they carry a pseudonymizable id, not profile PII) and expire in ≤14 days. No manual purge.
- **S3.** The erasure worker deletes the owner's objects; the orphan-sweeper (hourly, both buckets)
  reclaims late writes. Non-current **versions** expire per the bucket lifecycle. No manual step.
- **Logs.** Minimized at write (pseudonymized) + bounded retention. No manual scrub.
- **Vercel Web Analytics.** Nothing to erase and nothing to search by — see §1a for the reasoning and for
  the changes that would invalidate it.

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
