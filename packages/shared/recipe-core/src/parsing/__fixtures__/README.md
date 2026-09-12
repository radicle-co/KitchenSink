# Foodness word-set fixtures (plan U6, KTD-E)

`foodnessHoldout.tsv` — the untouched holdout the champion prompt was measured on
(`docs/reports/2026-08-30-001-foodness-prompt-optimization.md`): 10,002 rows of
`kind<TAB>label<TAB>word`. Material: public-domain dictionary words (`words_alpha`) and USDA SR Legacy
catalog names plus curated equipment/unit/plain/tricky sets — **never** the restricted 1919 corpus.

⛔ This fixture is what makes the tolerance-band verification EXECUTABLE (the plan's own requirement): the
operator runner (`scripts/foodnessHoldoutRun.ts` here) replays the SHIPPED modules over these words and
compares against the band — overall ≥ 97.5%, food-loss FN within +50% of the report's 8 — because the
model id is not a pinned model VERSION and Bedrock offers no snapshot pinning: a profile shift under an
unchanged prompt SHA is the MODEL-DRIFT signal, not a code defect (the PG18 re-baseline reasoning).

Labels carry measured noise (~45% of dictionary "false positives" are real obscure foods the labeling
missed — `liquorice`, `pekoe`, `bullaces`), so the band is the contract, not per-word equality.
