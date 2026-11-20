# 027 Flow Steps: agent notes

Rules that are easy to get wrong. Read before working on this feature.

- **Planned, not built. Every clarification is assumed** (spec C-1 to C-21). The name "Flow Steps" waits for the
  owner. A rename touches copy and `recipes.flowSteps.*` keys only. Tables (`recipe_rewritten_steps`) and the route (`/rewritten-steps`) are neutral on purpose.
- **The writer sees facts only, for every recipe.** `buildStepPrompt(sheet: FactsSheet)` is arity-pinned and its
  system prompt is pinned by SHA-256. Do not add a "wording" parameter for recipes the cook wrote.
- **The fact check is two-way and deterministic.** Nothing dropped, nothing added (008-FR-034a), across the whole
  recipe as multisets. Durations must survive or Cooking Mode timers break. No LLM judge.
- **No Anthropic model (owner ruling 2026-11-17), no own keys.** Bedrock non-Anthropic only, under the one verification role, new
  `SPEND_CALL_SITES` member `step-rewrite-cook`. Never a second Bedrock grantee.
- **Ceiling denial is terminal.** `gatedConverse` redelivers a denial by default. This step must end `budgetSpent`, refund in full, take no use and ack the message.
- **Cache-aside on the saved-content digest** (steps, ingredient lines, language). Never the device draft (DD26).
  Validity ignores engine version. Single flight is the partial unique index on pending jobs, not a header.
- **Nothing regenerates without the cook.** A stale version shows as out of date. No background or on-open update.
- **Attach is private to the owner.** Replace is an Apply Command through `RecipesService.update`
  (`expectedVersion` + digest). It needs a recipe published once, so a version always exists (ADR-0058).
- **A replace never changes the rights label.** Another site's steps go public only through the two doors of 003B-FR-015.
  Attach changes no label either.
- **One engine.** Whichever of 027 and 003B ships first builds `recipe-core/src/stepWriting/`. The other and 020's
  suggestion consume it with their own call site, charge rule and sink. No mode flag inside the engine. The wording
  check runs on a hashed fingerprint of the original, never on stored text.
- **One banned-word list**, defined by 003B-FR-064 and held in one module. A test enforces it over `recipes.flowSteps.*`.
- **No credit key of its own** for a public version of an imported recipe: 027 uses 003B's `review.credit` and
  `review.creditPaid`.
