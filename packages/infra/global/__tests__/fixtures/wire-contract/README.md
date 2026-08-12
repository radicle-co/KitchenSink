# `wire-contract` fixtures

Each directory is a **deliberately non-compliant** stand-in for a client package, used by
`../../wire-contract-consumers.test.ts` to watch one rule of `docs/CODING_STANDARDS.md` §15 / ADR-0014 go
red. `compliant/` and `design-tokens/` are the negative controls: they must stay silent, so the gate is
provably satisfiable rather than merely strict.

Sources carry a **`.ts.fixture`** extension, not `.ts`. That is load-bearing:

- they import `@kitchensink/schema-thing`, a package that does not exist, because the import rules are part of
  what is being tested — a real `.ts` file would fail `tsc --noEmit` for a reason unrelated to the rule;
- `prettier --check .` and the editor's module resolution both leave an unknown extension alone.

The test reads them as TEXT and hands them to the pure `auditConsumerPackage`, which is why the pure/impure
split in the rules module exists at all.
