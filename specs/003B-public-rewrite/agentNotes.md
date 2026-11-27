# 003B Public Versions: agent notes

Rules that are easy to get wrong. Read before working on this feature.

- **MVP scope (owner rulings 2026-11-21)**: US1 to US5, the reader-market resolver (C-31) and the classifier's open-source branch, which ships with US1. US6 is not in the MVP (owner cut 2026-11-21). Bulk import ("Make the rest public") belongs to spec 004, and a copy of a public version going public to `021-FR-005`. A cook's copy of a public version gets only the FR-062a guard: no public door takes a `user_created` recipe with `source_record_id`.
- **Planned, not built. Clarifications are ruled where marked, the rest assumed** (see the spec Clarifications). It sits behind one per-market
  switch, on in every market at launch (FR-090, ADR-0093 §6a). No test door. The reader's market rule is C-31, built in T383.
- **The engine is 027's.** Facts sheet, writer, fact check and shingle measure live in `recipe-core/src/stepWriting/`
  and are designed in spec 027. Build them once, to 027's design. No mode flag in the engine. The title is built by
  003B code, not by the engine.
- **The writer sees the facts sheet and the source step text.** Never the address, statement, source title or headnote (ruled 2026-11-17). No Anthropic model (owner ruling 2026-11-17). The writer
  never fetches. A link import fetches on the device first and the server second, never for a known paid site. Paste detection never fetches.
- **The classifier is an allowlist that fails closed.** Open: own claimed site (live claim), an honoured licence that allows
  commercial use, curator public domain, a listed US federal publisher. Everything else is third-party. A missing input
  reads as third-party, never open. An unread paid, opt-out or signature signal is `unknown`: the rewrite path to public with `credit.written` only, never `privateOnly` (FR-012b). The server computes it. The client never does.
- **No facts cards** (owner ruling 2026-11-15). Do not build one, and do not offer one as a fallback.
- **Paid sources go public only as a page Commise writes in full**, under spec FR-017: no opt-out, older than
  `PAID_CONTENT_HOLD_MONTHS` (6, one named constant), counted from the page date or the first import, never a signature recipe from one
  source. No caps of any kind (owner ruling 2026-11-15). The credit names no site. The private copy keeps the wording, is never shared or exported (the account data export is the one exception, ADR-0093 §5), and the household sees
  only the Commise version. The paid list is 004-FR-014's list. Do not make a second one.
- **One public version per source page**, whoever imports it (FR-034). A later cook is pointed to it.
- **Two doors to public for a third-party recipe** (FR-015): Publish of the Commise-written version (default), or the cook's own "Adapted by you" rewrite through the similarity check and 020's review (never for a paid source). Not the visibility toggle, not a clone, not a 027 replace.
- **The page key is released** on delete, 020 rejection and opt-out (FR-034a). Hold it while a version is hidden by a report.
- **The fingerprint key** is a Secrets Manager secret, rotation keeps old versions readable (FR-050a).
- **The wording check runs before any write that leaves a recipe with `source_record_id` set (a public version) published and public**, inside the recipe write, against the hashed fingerprint
  in the append-only source record. The source text is never kept for it. The job holds the source step text in `source_steps` only until it ends, so a retry sends the same text (FR-033).
- **Publish is one transaction**: server fact check, wording check, recipe insert under the unique
  source page key. Monitoring counts public versions per source from the source records. The 020 hold still applies.
- **Spend is operating cost** under call site `import-public-rewrite`. A ceiling denial is final and never
  redelivered. The cook's AI uses are never charged.
- **The dead end opens Pro's checkout** (amends 010-FR-042c for this screen only). Both billing periods stay visible,
  neither chosen. "Not now" is the same size as "Upgrade to Pro".
- **Banned copy words** live in one module that every copy guard imports, and 027's guard reads the same one (FR-064).
- **Public repo.** Write product behaviour only.
- **ADR-0093 carries the amendments** to 004, 016, 020, 021 and the paste spec. Do
  not write them again from 003B.
- **Credits disclose AI**: "Steps written by Commise with AI, checked by {cook}." Free sites add the domain line. Paid
  sites name no domain. Publishing needs age 16 or over.
- **The item's draft is `recipe_import_items.payload`.** Only `claimSave` (every save that ends the paste in a recipe, FR-016a) clears it. The worker, the expiry and the sweep never touch it. An explicit discard on the public-only path deletes the import (`ImportService.delete`). A job's text is cleared at most 73 h 15 min after Start while the sweep runs. The attempt count has a holder chosen by the job's stored `path` (never inferred from `private_recipe_id`): the item for `public`, `recipes.public_attempts` for `both` and `later`; the job has no `attempts` column. The AI-use counters are held by the item when the job has an import item and by the job when it has none.
- **Lock order** for every paste and job transaction: import header, item, allowance, DD33, private recipe, job. Every writer that touches a holder and the job locks the holder (item or recipe) and then the job (the worker claim, the result write, the lazy expiry, retry, and the sweep, which uses `SKIP LOCKED` on both). The later route's Start locks the recipe `FOR NO KEY UPDATE` before it reads the latest job. The purge skips at the header and runs after the sweep. Every route on the import path locks header, item `FOR UPDATE`, job (the later route: recipe `FOR NO KEY UPDATE`, job). The item's key is `(import_id, ordinal)`, and the charge scope comes from `item.channel`.
- **ADR-0072's purge is unchanged.** It keeps its `updated_at` scan. The import-path routes (Start, retry, Publish, keepPrivate, cancel) set `recipe_imports.updated_at = now()`, so a job never outlives the purge (data model). The tick's order is in the data model's job retention paragraph, and each step runs inside `runMaintenanceSweeps`, which keeps going when an earlier step fails.
- **No per-cook read cap and no new ledger channel for the writer.** FR-086's metric watches the read-then-cancel loop, which is a known, accepted risk.
- **T346 is web-only.** The native paste screen and its tests ship with the mobile paste PR, under the owner exception in `docs/design/pasteImport/spec.md` ("Owner exception to the both-platforms rule").
