# 003B Public Versions: agent notes

Rules that are easy to get wrong. Read before working on this feature.

- **Planned, not built. Clarifications are ruled where marked, the rest assumed** (see the spec Clarifications). It sits behind one per-market
  switch, on in every market at launch (FR-090, ADR-0093 §6a). No test door.
- **The engine is 027's.** Facts sheet, writer, fact check and shingle measure live in `recipe-core/src/stepWriting/`
  and are designed in spec 027. Build them once, to 027's design. No mode flag in the engine. The title is built by
  003B code, not by the engine.
- **The writer sees the facts sheet and the source step text.** Never the address, statement, source title or headnote (owner to confirm). No Anthropic model (owner ruling 2026-11-17). The writer
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
- **The wording check runs on every save of a public version**, inside the recipe write, against the hashed fingerprint
  in the append-only source record. The source text is never kept for it.
- **Publish is one transaction**: server fact check, wording check, recipe insert under the unique
  source page key. Monitoring counts public versions per source from the source records. The 020 hold still applies.
- **Spend is operating cost** under call site `import-public-rewrite`. A ceiling denial is terminal and never
  redelivered. The cook's AI uses are never charged.
- **The dead end opens Pro's checkout** (amends 010-FR-042c for this screen only). Both billing periods stay visible,
  neither chosen. "Not now" is the same size as "Upgrade to Pro".
- **Banned copy words** live in one module that every copy guard imports, and 027's guard reads the same one (FR-064).
- **Public repo.** Write product behaviour only.
- **ADR-0093 carries the amendments** to 004, 016, 020, 021 and the paste spec. Do
  not write them again from 003B.
- **Credits disclose AI**: "Steps written by Commise with AI, checked by {cook}." Free sites add the domain line. Paid
  sites name no domain. Publishing needs age 16 or over.
