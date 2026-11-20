# Python (3.10–3.13) — code-quality reference corpus

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID    | Smell                                                                            | Section                                  | Detected by | Default severity | Architecture |
| ----- | -------------------------------------------------------------------------------- | ---------------------------------------- | ----------- | ---------------- | ------------ |
| PY-01 | Mutable default argument                                                         | Correctness traps (language semantics)   | partial     | major            | no           |
| PY-02 | Mutable class-attribute / dataclass default                                      | Correctness traps (language semantics)   | partial     | major            | no           |
| PY-03 | Late-binding closure over a loop variable                                        | Correctness traps (language semantics)   | partial     | major            | no           |
| PY-04 | `is` / `is not` against a literal                                                | Correctness traps (language semantics)   | tool        | major            | no           |
| PY-05 | Mutating a collection while iterating it                                         | Correctness traps (language semantics)   | tool        | major            | no           |
| PY-06 | `zip()` silently truncating                                                      | Correctness traps (language semantics)   | tool        | major            | no           |
| PY-07 | Shadowing builtins / stdlib modules                                              | Correctness traps (language semantics)   | tool        | minor            | no           |
| PY-08 | `assert` used for runtime validation                                             | Correctness traps (language semantics)   | partial     | blocker          | no           |
| PY-09 | Bare / blind `except` and swallowed exceptions                                   | Error handling                           | partial     | blocker          | yes          |
| PY-10 | Re-raising without `from` (lost/garbled cause)                                   | Error handling                           | tool        | minor            | no           |
| PY-11 | Vanilla exceptions and messages built at the raise site                          | Error handling                           | tool        | minor            | yes          |
| PY-12 | Logging an exception without its traceback                                       | Error handling                           | tool        | minor            | no           |
| PY-13 | Wildcard imports                                                                 | Imports & module structure               | tool        | minor            | no           |
| PY-14 | Circular imports and function-local import workarounds                           | Imports & module structure               | tool        | major            | yes          |
| PY-15 | Import-time side effects (module-level work, heavy `__init__.py`)                | Imports & module structure               | judgement   | major            | yes          |
| PY-16 | Global mutable state                                                             | Imports & module structure               | partial     | major            | no           |
| PY-17 | Relative imports reaching across packages / private-member access                | Imports & module structure               | tool        | minor            | yes          |
| PY-18 | `Any` leakage and untyped boundaries                                             | Typing & boundaries                      | partial     | major            | yes          |
| PY-19 | Blanket `# type: ignore` / `# noqa`                                              | Typing & boundaries                      | tool        | minor            | no           |
| PY-20 | Implicit / misused `Optional`                                                    | Typing & boundaries                      | partial     | major            | no           |
| PY-21 | `TypedDict` / `dataclass` / `pydantic` chosen for the wrong job                  | Typing & boundaries                      | judgement   | major            | yes          |
| PY-22 | SQL built by string formatting                                                   | Security hygiene (bandit family)         | partial     | blocker          | no           |
| PY-23 | Shell injection via `subprocess`/`os.system`                                     | Security hygiene (bandit family)         | partial     | blocker          | no           |
| PY-24 | Unsafe deserialisation / dynamic code execution                                  | Security hygiene (bandit family)         | tool        | blocker          | yes          |
| PY-25 | HTTP calls without timeout / with TLS verification off                           | Security hygiene (bandit family)         | tool        | major            | yes          |
| PY-26 | Weak crypto / insecure randomness / hard-coded secrets / temp files              | Security hygiene (bandit family)         | tool        | blocker          | no           |
| PY-27 | Resources not managed by a context manager                                       | Resources, time, numbers, paths, logging | partial     | major            | no           |
| PY-28 | Naive datetimes                                                                  | Resources, time, numbers, paths, logging | tool        | major            | yes          |
| PY-29 | Floats for money / exact quantities                                              | Resources, time, numbers, paths, logging | judgement   | major            | yes          |
| PY-30 | `os.path` string plumbing                                                        | Resources, time, numbers, paths, logging | tool        | minor            | no           |
| PY-31 | Eager log formatting, `print` in libraries, root-logger calls                    | Resources, time, numbers, paths, logging | tool        | minor            | no           |
| PY-32 | N+1 queries / calls in loops                                                     | Performance hygiene                      | judgement   | major            | yes          |
| PY-33 | Materialising lists where iteration suffices                                     | Performance hygiene                      | tool        | minor            | no           |
| PY-34 | Long / branchy / many-argument functions                                         | Design & complexity                      | tool        | minor            | no           |
| PY-35 | Magic numbers and strings                                                        | Design & complexity                      | partial     | minor            | no           |
| PY-36 | God class / deep inheritance / classes where functions suffice                   | Design & complexity                      | partial     | major            | yes          |
| PY-37 | Boolean-trap parameters                                                          | Design & complexity                      | tool        | minor            | no           |
| PY-38 | Dead code: commented-out code, unused args/vars/imports, `async` with no `await` | Design & complexity                      | tool        | minor            | no           |
| PY-39 | Fire-and-forget tasks garbage-collected mid-flight                               | Async                                    | partial     | major            | yes          |
| PY-40 | Blocking calls inside `async def`                                                | Async                                    | partial     | major            | no           |
| PY-41 | Missing `await`                                                                  | Async                                    | partial     | major            | no           |
| PY-42 | Per-invocation initialisation in the handler (and the reverse)                   | AWS Lambda specifics                     | judgement   | minor            | yes          |
| PY-43 | Writing outside `/tmp` / assuming `/tmp` is clean or large                       | AWS Lambda specifics                     | judgement   | blocker          | yes          |
| PY-44 | Non-idempotent handlers                                                          | AWS Lambda specifics                     | judgement   | blocker          | yes          |

<!-- END GENERATED INDEX -->

Domain prefix: `PY-`. Every rule code, name, default-enabled flag, preview flag and threshold below was read
from the rendered ruff docs by raw scrape (not summarised) on 2026-09-13, unless marked `UNVERIFIED`.

## Scope & sources consulted

| Source                                                                                                                            | Version / date read                                 | URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ruff rules registry (969 rows, stable/preview/fix/default flags scraped)                                                          | ruff **0.16.7** (PyPI latest), docs read 2026-09-13 | https://docs.astral.sh/ruff/rules/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Ruff Default Rules page (413 codes scraped)                                                                                       | 0.16.x                                              | https://docs.astral.sh/ruff/default-rules/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Ruff v0.16.0 release blog (default set 59 → 413; 18 rules removed)                                                                | released 2026-07-23                                 | https://astral.sh/blog/ruff-v0.16.0 ; https://github.com/astral-sh/ruff/issues/27199                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Ruff settings (mccabe / pylint thresholds)                                                                                        | 0.16.x                                              | https://docs.astral.sh/ruff/settings/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Individual ruff rule pages (≈36 opened)                                                                                           | 0.16.x                                              | https://docs.astral.sh/ruff/rules/<rule-name>/                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| mypy command line (`--strict` flag list)                                                                                          | mypy **2.3.1** docs                                 | https://mypy.readthedocs.io/en/stable/command_line.html                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| mypy optional error codes                                                                                                         | mypy 2.3.1                                          | https://mypy.readthedocs.io/en/stable/error_code_list2.html ; https://mypy.readthedocs.io/en/stable/error_code_list.html                                                                                                                                                                                                                                                                                                                                                                                                  |
| Pylint all-options (thresholds)                                                                                                   | pylint **4.0.8** docs                               | https://pylint.readthedocs.io/en/stable/user_guide/configuration/all-options.html                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Semgrep rules repo (`python/**`, rule ids read from YAML)                                                                         | `develop` tree, 2026-09-13                          | https://github.com/semgrep/semgrep-rules/tree/develop/python                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Python docs: asyncio tasks / dev guide, datetime, dataclasses, typing, exceptions, logging HOWTO, programming FAQ, floating point | 3.13/3.14 docs, 2026-09-13                          | https://docs.python.org/3/library/asyncio-task.html ; https://docs.python.org/3/library/asyncio-dev.html ; https://docs.python.org/3/library/datetime.html ; https://docs.python.org/3/library/dataclasses.html ; https://docs.python.org/3/library/typing.html ; https://docs.python.org/3/library/exceptions.html ; https://docs.python.org/3/howto/logging.html ; https://docs.python.org/3/faq/programming.html ; https://docs.python.org/3/tutorial/floatingpoint.html ; https://docs.python.org/3/whatsnew/3.8.html |
| Pydantic models (`model_construct`)                                                                                               | pydantic **2.13.5**                                 | https://docs.pydantic.dev/latest/concepts/models/                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AWS Lambda best practices, execution environment, Python handler, ephemeral storage, container images                             | 2026-09-13                                          | https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html ; https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html ; https://docs.aws.amazon.com/lambda/latest/dg/python-handler.html ; https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html ; https://docs.aws.amazon.com/lambda/latest/dg/images-create.html                                                                                                                                                  |
| import-linter contract types                                                                                                      | import-linter **2.15**                              | https://import-linter.readthedocs.io/en/stable/contract_types.html                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| bandit (for S-rule provenance)                                                                                                    | bandit **1.9.4** (PyPI)                             | https://pypi.org/project/bandit/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Tooling baseline — what is and is NOT on by default (read this first)

**Ruff 0.16.0 (2026-07-23) changed the default rule set from 59 to 413 rules.** Any repo that relies on
defaults (no `select`) silently changed behaviour on upgrade; any repo with an explicit `select` did not. Two
consequences an agent must know:

1. **Removed from defaults** in 0.16.0: `E401 E402 E701 E702 E703 E711 E712 E713 E714 E721 E731 E741 E742
E743 F403 F405 F406 F722`. So `from x import *` (**F403/F405**) is **no longer flagged by default**, nor is
   `== None` (E711), `lambda` assignment (E731) or `l`/`O`/`I` names (E741). Restoring the old set is
   `select = ["E4", "E7", "E9", "F"]` (per blog).
2. The new defaults are a _subset of each family_. Per-family census of the 0.16.x registry (total non-removed
   rules / enabled-by-default / preview-only), scraped from the rules table:

| Family                                                                                                      | total | default | preview | Notes for a quality agent                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ----- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `F` Pyflakes                                                                                                | 43    | 39      | 0       | F403/F405 wildcard now OFF                                                                                        |
| `E` pycodestyle                                                                                             | 59    | 2       | 41      | only E722 bare-except, E902 on                                                                                    |
| `B` bugbear                                                                                                 | 43    | 29      | 4       | **B904 raise-without-from and B905 zip-strict are OFF**                                                           |
| `BLE` blind-except                                                                                          | 1     | 1       | 0       | BLE001 now on                                                                                                     |
| `S` bandit                                                                                                  | 71    | **3**   | 13      | only S102, S110, S112 on — **no S301 pickle, S506 yaml, S602 shell, S608 SQL, S113 timeout, S101 assert**         |
| `ANN` annotations                                                                                           | 9     | 0       | 0       | all OFF (ANN401 `Any`)                                                                                            |
| `C` bucket = `C4` (flake8-comprehensions C4xx) + `C90` (mccabe C901), counted together by the census script | 20    | 17      | 0       | not a per-family figure: the 17 default rules are all C4xx; the single C90 rule **C901 complex-structure is OFF** |
| `PLR` pylint-refactor                                                                                       | 31    | 13      | 10      | **PLR0911/0912/0913/0915/0917/2004 OFF; PLR0904/0914/0916/1702/6301 PREVIEW-only**                                |
| `PLW` pylint-warning                                                                                        | 29    | 20      | 4       | PLW0603 global-statement, PLW2901 OFF                                                                             |
| `PLC` pylint-convention                                                                                     | 16    | 8       | 3       | PLC0415 import-outside-top-level OFF                                                                              |
| `TRY` tryceratops                                                                                           | 9     | 5       | 0       | TRY002/004/201/203/401 on; TRY003/300/301/400 OFF                                                                 |
| `DTZ` datetimez                                                                                             | 10    | 10      | 0       | all on                                                                                                            |
| `ASYNC`                                                                                                     | 16    | 10      | 1       | ASYNC110 busy-wait, ASYNC109 OFF                                                                                  |
| `RUF`                                                                                                       | 77    | 36      | 26      | **RUF006 asyncio-dangling-task OFF**; RUF029 unused-async preview                                                 |
| `SIM`                                                                                                       | 30    | 21      | 0       | SIM105/108 OFF                                                                                                    |
| `PERF`                                                                                                      | 6     | 3       | 0       | PERF203/401/403 OFF                                                                                               |
| `PTH` pathlib                                                                                               | 35    | 2       | 0       | essentially OFF                                                                                                   |
| `T` (T10 debugger + T20 print)                                                                              | 3     | 1       | 0       | T100 on, **T201 print OFF**                                                                                       |
| `D` pydocstyle                                                                                              | 48    | 1       | 2       | OFF                                                                                                               |
| `N` pep8-naming                                                                                             | 16    | 1       | 0       | OFF                                                                                                               |
| `A` builtins shadowing                                                                                      | 6     | 0       | 0       | OFF                                                                                                               |
| `ARG` unused args                                                                                           | 5     | 0       | 0       | OFF                                                                                                               |
| `FBT` boolean trap                                                                                          | 3     | 0       | 0       | OFF                                                                                                               |
| `EM` errmsg                                                                                                 | 3     | 0       | 0       | OFF                                                                                                               |
| `ERA` eradicate                                                                                             | 1     | 0       | 0       | OFF                                                                                                               |
| `RET`                                                                                                       | 8     | 1       | 0       | only RET501                                                                                                       |
| `SLF`, `INP`, `TID`                                                                                         | 1/1/5 | 0/0/0   | 0/0/2   | OFF                                                                                                               |
| `PGH`                                                                                                       | 3     | 1       | 0       | **PGH003 blanket-type-ignore OFF**                                                                                |
| `G` logging-format / `LOG`                                                                                  | 8 / 7 | 4 / 5   | 0       | **G004 logging-f-string OFF**                                                                                     |

**High-value families to add explicitly** (ordered by defect-prevention yield for an agent): `B904`, `B905`,
`RUF006`, `S` (at least S301/S506/S602/S603/S607/S608/S113/S324/S501/S701), `C901`,
`PLR0911/0912/0913/0915/0917`, `PLR2004`, `PLW0603`, `ANN401` (+ANN001/ANN201 on public APIs), `PGH003`,
`TRY003/TRY300/TRY400`, `T201`, `ERA001`, `FBT001/FBT002/FBT003`, `ARG001/ARG002`, `A001/A002/A005`,
`F403/F405`, `SLF001`, `TID251/TID252`.

**Thresholds (ruff settings page, 0.16.x):** `lint.mccabe.max-complexity` default **10**;
`lint.pylint.max-args` **5**; `max-positional-args` **5**; `max-branches` **12**; `max-returns` **6**;
`max-statements` **50**; `max-locals` **15** (PLR0914 preview); `max-nested-blocks` **5** (PLR1702 preview);
`max-bool-expr` **5** (PLR0916 preview); `max-public-methods` **20** (PLR0904 preview);
`allow-magic-value-types` **`["str", "bytes"]`** — i.e. PLR2004 _does_ flag magic integers/floats by default
configuration.

**Class-size gap — ruff has no equivalent** of pylint `too-many-ancestors / R0901` (`max-parents` default
**7**), `too-many-instance-attributes / R0902` (`max-attributes` **7**), `too-few-public-methods / R0903`
(`min-public-methods` **2**), `cyclic-import / R0401`, `duplicate-code / R0801` (`min-similarity-lines` **4**)
— none appear in the 969-row ruff registry. Pylint 4.0.8 defaults otherwise match ruff (max-args 5,
max-branches 12, max-locals 15, max-returns 6, max-statements 50, max-public-methods 20, max-complexity 10,
max-module-lines 1000). **God-class / deep-inheritance detection in Python therefore needs pylint (or
judgement) even in a ruff-only repo.**

**mypy 2.3.1 `--strict` enables exactly:** `--disallow-any-generics --disallow-subclassing-any
--disallow-untyped-calls --disallow-untyped-defs --disallow-incomplete-defs --check-untyped-defs
--disallow-untyped-decorators --warn-redundant-casts --warn-unused-ignores --warn-return-any
--no-implicit-reexport --strict-equality --extra-checks`. It does **not** enable `--warn-unreachable`
(docs say so explicitly), `--disallow-any-explicit` (`[explicit-any]`), `--disallow-any-expr`, or the
optional error codes `ignore-without-code`, `possibly-undefined`, `truthy-bool`, `truthy-iterable`,
`redundant-expr`, `unused-awaitable`, `explicit-override`, `mutable-override`, `deprecated`,
`exhaustive-match`, `unimported-reveal`. Recommended strict-plus:
`--strict --warn-unreachable --enable-error-code ignore-without-code,possibly-undefined,truthy-bool,redundant-expr,unused-awaitable,explicit-override,exhaustive-match,deprecated`.
mypy 2.0 also made `--local-partial-types` and strict bytes (`bytearray`/`memoryview` no longer subtypes of
`bytes`) the default.

---

## Correctness traps (language semantics)

### PY-01 Mutable default argument

- **Signal:** `def f(x=[])`, `def f(x={})`, `def f(x=set())`, or any call in a default (`def f(now=datetime.now())`, `def f(cfg=load())`).
- **Tool coverage:** `ruff:B006 mutable-argument-default` (default ON, fix) ; `ruff:B008 function-call-in-default-argument` (default ON; ignores params with immutable annotations; extend with `lint.flake8-bugbear.extend-immutable-calls`) ; `ruff:B039 mutable-contextvar-default` (default ON) ; `semgrep:python.lang.correctness.common-mistakes.default-mutable-list.default-mutable-list`. partial: custom mutable classes called in defaults are caught by B008 but not if the callable is listed as immutable by config.
- **Why it hurts:** reliability — the default is evaluated once at `def` time (Python FAQ "Why are default values shared between objects?"), so state leaks between calls/requests; in a long-lived worker or warm Lambda this is cross-request data leakage.
- **Severity:** major — blocker if the shared object can hold per-user data in a server/Lambda.
- **Remediation:** `None` sentinel + `if x is None: x = []`; for dataclasses `field(default_factory=list)` — trap: using `x = x or []` treats a caller-passed empty list as "missing" and silently replaces it.
- **Not a finding when:** default is a deliberate module-level singleton constant (ruff B008 doc shows `ERROR = ValueError(...)` then `def add_host(error: Exception = ERROR)`), or the object is never mutated and annotated as an immutable type (`Sequence`, `Mapping`, `frozenset`).
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/mutable-argument-default/ ; https://docs.astral.sh/ruff/rules/function-call-in-default-argument/ ; https://docs.python.org/3/faq/programming.html

### PY-02 Mutable class-attribute / dataclass default

- **Signal:** `class A: items: list[int] = []` (non-dataclass), or `@dataclass` field defaulting to a mutable object that _is hashable_ (custom class instance), or a call in a dataclass default.
- **Tool coverage:** `ruff:RUF012 mutable-class-default` (default ON) ; `ruff:RUF009 function-call-in-dataclass-default-argument` (default ON) ; `ruff:RUF045 implicit-class-var-in-dataclass` (preview). Runtime: since Python 3.11 `@dataclass` raises `ValueError` for any **unhashable** default (before 3.11 only list/dict/set). partial: a hashable-but-mutable object default passes both the runtime check and RUF012.
- **Why it hurts:** reliability — every instance shares one object; mutations in one instance appear in all.
- **Severity:** major.
- **Remediation:** initialise in `__init__`, `field(default_factory=...)`, annotate intentional sharing with `typing.ClassVar[...]`, or use immutable types (`tuple`, `frozenset`, `MappingProxyType`) — trap: `ClassVar` silences RUF012 but does not make the object immutable.
- **Not a finding when:** Pydantic `BaseModel` fields (pydantic copies defaults per instance — `UNVERIFIED` for all versions, check the model's docs), enum members, or `ClassVar` constants never mutated.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/mutable-class-default/ ; https://docs.python.org/3/library/dataclasses.html

### PY-03 Late-binding closure over a loop variable

- **Signal:** `lambda`/nested `def` inside a `for`/comprehension that references the loop variable and is called later (`callbacks.append(lambda: handle(i))`, `[lambda x: x + i for i in range(3)]` → `[3,3,3]`).
- **Tool coverage:** `ruff:B023 function-uses-loop-variable` (default ON). partial: closures over a variable reassigned later outside a loop are not flagged.
- **Why it hurts:** correctness — every callback sees the last iteration value; typical in event handlers, `ThreadPoolExecutor.submit(lambda: …)`, retry registrations.
- **Severity:** major (silent wrong target); minor if immediately invoked.
- **Remediation:** bind at definition: default arg `lambda x, i=i:` or `functools.partial` — trap: the `i=i` default adds a public parameter a caller can override; prefer `partial` in APIs.
- **Not a finding when:** the function is called synchronously within the same iteration (e.g. `sorted(key=lambda r: r[col])` inside the loop body) — B023 still fires; suppress with a code-scoped `# noqa: B023` and a reason.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/function-uses-loop-variable/ ; https://docs.python.org/3/faq/programming.html

### PY-04 `is` / `is not` against a literal

- **Signal:** `x is 7`, `status is "ok"`, `x is ()`.
- **Tool coverage:** `ruff:F632 is-literal` (default ON, fix) ; CPython emits `SyntaxWarning: "is" with 'int' literal` since 3.8 ; `semgrep:python.lang.correctness.common-mistakes.is-comparison-string.string-is-comparison`.
- **Why it hurts:** correctness — works by accident under interning in CPython and fails for other values/implementations.
- **Severity:** major.
- **Remediation:** `==`; keep `is` for `None`, `True`/`False` singletons, sentinels and enum members.
- **Not a finding when:** `x is None`, `x is SENTINEL` (module-level `object()`), `x is MyEnum.A`.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/ (F632 row) ; https://docs.python.org/3/whatsnew/3.8.html

### PY-05 Mutating a collection while iterating it

- **Signal:** `for x in items: … items.append/remove/pop(…)`; `for k in d: del d[k]`.
- **Tool coverage:** `ruff:B909 loop-iterator-mutation` (**preview only**) ; `ruff:PLW2901 redefined-loop-name` (off, related) ; `semgrep:python.lang.correctness.list-modify-iterating.list-modify-while-iterate` ; `semgrep:python.lang.correctness.dict-modify-iterating.dict-del-while-iterate` (id `UNVERIFIED` — file present, id not read). Runtime: dict size change raises `RuntimeError`; lists silently skip.
- **Why it hurts:** correctness — skipped elements or infinite loops.
- **Severity:** major.
- **Remediation:** iterate a copy (`for x in list(items)`) or build a new collection with a comprehension.
- **Not a finding when:** the loop `break`s immediately after the mutation.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/loop-iterator-mutation/

### PY-06 `zip()` silently truncating

- **Signal:** `zip(a, b)` where both are expected equal length (parallel arrays, header/row pairing).
- **Tool coverage:** `ruff:B905 zip-without-explicit-strict` (**OFF by default**, fix; requires 3.10+ `strict=`).
- **Why it hurts:** correctness — a short list drops data without error (lost rows, mis-paired columns).
- **Severity:** major when lengths are an invariant; minor otherwise.
- **Remediation:** `zip(a, b, strict=True)`; `strict=False` explicitly where truncation is intended — trap: the autofix inserts `strict=False`, making the bug explicit rather than fixing it.
- **Not a finding when:** one argument is an infinite iterator (`itertools.count()`, `repeat`).
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/ (B905 row, fix flag) ; https://docs.astral.sh/ruff/rules/zip-without-explicit-strict/

### PY-07 Shadowing builtins / stdlib modules

- **Signal:** variables/params/attributes named `id`, `type`, `list`, `input`, `filter`, `hash`; a module file named `logging.py`, `types.py`, `email.py`, `secrets.py`.
- **Tool coverage:** `ruff:A001 builtin-variable-shadowing`, `A002 builtin-argument-shadowing`, `A004 builtin-import-shadowing`, `A005 stdlib-module-shadowing` (all **OFF by default**).
- **Why it hurts:** readability + correctness — later `list(...)` in the same scope raises `TypeError: 'list' object is not callable`; A005 module shadowing breaks imports for _other_ modules depending on `sys.path` order.
- **Severity:** minor (variables) / major (A005 module names in a package on `sys.path`).
- **Remediation:** Rename Variable (`id` → `user_id`); rename module.
- **Not a finding when:** the name is an attribute/field that mirrors an external schema (`id` on an ORM model, pydantic field with alias) — A003 is for attributes and is commonly configured off for this reason.
- **Architecture:** no (A005 can be: package-layout issue).
- **Sources:** https://docs.astral.sh/ruff/rules/ (A-family rows)

### PY-08 `assert` used for runtime validation

- **Signal:** `assert user.is_admin`, `assert amount > 0, "..."` in non-test code paths handling input/authz.
- **Tool coverage:** `ruff:S101 assert` (OFF by default; exempts `TYPE_CHECKING` blocks) ; `ruff:RUF018 assignment-in-assert` (default ON). partial: S101 cannot distinguish invariants from input validation.
- **Why it hurts:** security/reliability — assertions are stripped under `python -O`; an authz or bounds check disappears in an optimised deployment.
- **Severity:** blocker for authz/input validation; minor for internal invariants.
- **Remediation:** explicit `if not cond: raise ValueError/PermissionError(...)`; for types use `typing.assert_never` / narrowing — trap: enabling S101 repo-wide floods tests; enable with `per-file-ignores` for `tests/**`.
- **Not a finding when:** in tests; type-narrowing asserts for the checker in trusted internal code; debug-only invariants whose removal is harmless.
- **Architecture:** no (yes if it is the only authorization check → escalate security).
- **Sources:** https://docs.astral.sh/ruff/rules/assert/

## Error handling

### PY-09 Bare / blind `except` and swallowed exceptions

- **Signal:** `except:`; `except Exception:` / `except BaseException:` whose body is `pass`, `continue`, `return None`, or a log without traceback.
- **Tool coverage:** `ruff:E722 bare-except` (default ON) ; `ruff:BLE001 blind-except` (default ON; _not_ flagged if re-raised or logged via `logging.exception`/`exc_info`) ; `ruff:S110 try-except-pass` (default ON) ; `ruff:S112 try-except-continue` (default ON) ; `ruff:SIM105 suppressible-exception` (off) ; `ruff:B012 jump-statement-in-finally` (default ON) ; `semgrep:python.lang.best-practice.logging-error-without-handling.logging-error-without-handling`. partial: a handler that logs `exc_info` then returns a default value passes BLE001 but still converts a failure into a wrong answer — judgement.
- **Why it hurts:** reliability/operability — catches `KeyboardInterrupt`/`SystemExit` (bare/BaseException), hides bugs as success, makes incidents undiagnosable.
- **Severity:** blocker when it masks data-integrity or authz failures; major otherwise.
- **Remediation:** catch the narrowest expected type; use `contextlib.suppress(SpecificError)` for intentional ignores; top-level boundaries (request handler, worker loop) may catch broadly **and** log with traceback **and** emit a metric — trap: replacing `except Exception: pass` with `logger.error(e)` passes S110 but still loses the traceback (see PY-12).
- **Not a finding when:** at a process/task boundary that logs with `logger.exception` and re-raises or marks the unit failed; cleanup-then-`raise`.
- **Architecture:** yes when the swallow is at a service/queue boundary (retry/DLQ semantics) — escalate to architecture/reliability.
- **Sources:** https://docs.astral.sh/ruff/rules/blind-except/ ; https://docs.astral.sh/ruff/rules/try-except-pass/

### PY-10 Re-raising without `from` (lost/garbled cause)

- **Signal:** inside `except X as e:` a `raise NewError(...)` with no `from e` / `from None`.
- **Tool coverage:** `ruff:B904 raise-without-from-inside-except` (**OFF by default**) ; `ruff:TRY201 verbose-raise` (default ON — `raise e` instead of bare `raise`) ; `ruff:PLE0704 misplaced-bare-raise` (default ON).
- **Why it hurts:** operability — without `from`, `__cause__` is unset and the traceback reads "During handling of the above exception, another exception occurred", implying a bug in the handler; `from None` sets `__suppress_context__` and hides the original from display (still in `__context__`).
- **Severity:** minor — major at library/API boundaries where translated errors are the only diagnostics.
- **Remediation:** `raise DomainError(...) from exc`; `from None` only when the original is noise or leaks secrets; use `exc.add_note()` (3.11+) to add context without re-wrapping.
- **Not a finding when:** bare `raise` re-raise.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/raise-without-from-inside-except/ ; https://docs.python.org/3/library/exceptions.html

### PY-11 Vanilla exceptions and messages built at the raise site

- **Signal:** `raise Exception("...")`; `raise ValueError(f"...")` repeated with varying text; `isinstance` check raising `ValueError`; `try: … except X: raise`.
- **Tool coverage:** `ruff:TRY002 raise-vanilla-class` (default ON) ; `ruff:TRY004 type-check-without-type-error` (default ON) ; `ruff:TRY203 useless-try-except` (default ON) ; `ruff:TRY003 raise-vanilla-args` (OFF) ; `ruff:EM101 raw-string-in-exception`, `EM102 f-string-in-exception` (OFF) ; `ruff:PLW0133 useless-exception-statement` (default ON — exception constructed but not raised) ; `ruff:B016 raise-literal` (default ON).
- **Why it hurts:** maintainability — callers cannot catch by type, so they match on message strings (Connascence of Meaning); inconsistent messages.
- **Severity:** minor; major in libraries/public APIs.
- **Remediation:** custom exception hierarchy with a module base class; message built in `__init__` — trap: TRY003/EM are noisy; apply to library code, not scripts.
- **Not a finding when:** built-ins that are idiomatic with messages (`NotImplementedError`, TRY003 exempts some); scripts/CLIs.
- **Architecture:** yes if the exception type is part of a public/cross-package contract.
- **Sources:** https://docs.astral.sh/ruff/rules/raise-vanilla-args/ ; https://docs.astral.sh/ruff/rules/ (TRY/EM rows)

### PY-12 Logging an exception without its traceback

- **Signal:** inside `except`: `logger.error(f"failed: {e}")` / `logger.error(str(e))`; `logging.exception(...)` _outside_ an except block.
- **Tool coverage:** `ruff:TRY400 error-instead-of-exception` (OFF) ; `ruff:TRY401 verbose-log-message` (default ON — redundant exception object in `logging.exception`) ; `ruff:LOG014 exc-info-outside-except-handler` (default ON) ; `ruff:G201 logging-exc-info` (default ON).
- **Why it hurts:** operability — stack trace lost; incident needs a redeploy to diagnose.
- **Severity:** minor → major in service code.
- **Remediation:** `logger.exception("context msg", extra={...})`.
- **Not a finding when:** expected, fully-understood domain errors logged at `warning` intentionally (e.g. validation failures).
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/error-instead-of-exception/

## Imports & module structure

### PY-13 Wildcard imports

- **Signal:** `from pkg import *` outside `__init__.py` re-export surfaces.
- **Tool coverage:** `ruff:F403 undefined-local-with-import-star`, `ruff:F405 undefined-local-with-import-star-usage` — **REMOVED from default set in ruff 0.16.0**; must be selected explicitly.
- **Why it hurts:** maintainability — namespace pollution, undetectable undefined names (Python FAQ), silent shadowing when the source module adds a name.
- **Severity:** minor (scripts) / major (library).
- **Remediation:** explicit imports; define `__all__` in the exporting module.
- **Not a finding when:** a package `__init__.py` that re-exports a submodule which declares `__all__`, or `from .settings_base import *` config layering (Django) — still prefer explicit.
- **Architecture:** no.
- **Sources:** https://astral.sh/blog/ruff-v0.16.0 ; https://docs.python.org/3/faq/programming.html

### PY-14 Circular imports and function-local import workarounds

- **Signal:** `ImportError: cannot import name … (most likely due to a circular import)`; `import` statements inside functions "to avoid cycles"; `from a import X` at top of `b` while `a` imports `b`.
- **Tool coverage:** `pylint:cyclic-import / R0401` ; `ruff:PLC0415 import-outside-top-level` (OFF; flags the workaround, not the cycle) ; `ruff:TC004 runtime-import-in-type-checking-block` (default ON) ; `import-linter` contracts `Layers`, `Forbidden`, `Independence`, `Acyclic siblings`, `Protected` (2.15). ruff has **no cycle detection**.
- **Why it hurts:** maintainability/testability — import order becomes load-bearing; modules can't be tested in isolation; the Python FAQ notes cycles fail specifically with `from module import name` at top level.
- **Severity:** major (a cycle between domain packages); minor (one-off local import for heavy deps).
- **Remediation:** Extract Module for the shared piece; Dependency Inversion (protocol in the lower layer); `if TYPE_CHECKING:` + `from __future__ import annotations` for type-only cycles; encode layering as an import-linter `layers` contract so it can't regress — trap: moving the import into the function hides the cycle rather than removing it.
- **Not a finding when:** local import to defer an expensive optional dependency or platform-specific module (FAQ explicitly allows), or a CLI entry point reducing startup time.
- **Architecture:** yes — package layering/dependency direction; escalate to architecture.
- **Sources:** https://docs.python.org/3/faq/programming.html ; https://pylint.readthedocs.io/en/stable/user_guide/messages/refactor/cyclic-import.html ; https://docs.astral.sh/ruff/rules/import-outside-top-level/ ; https://import-linter.readthedocs.io/en/stable/contract_types.html

### PY-15 Import-time side effects (module-level work, heavy `__init__.py`)

- **Signal:** at module scope or in `__init__.py`: network/DB connections, reading files/env and raising, `logging.basicConfig()`, `os.environ[...]` required at import, registering signal handlers, starting threads, `requests.get`, large model loads; `__init__.py` importing every submodule.
- **Tool coverage:** none — judgement. Adjacent: `ruff:PLW0603 global-statement` (OFF) ; `ruff:LOG015 root-logger-call` (default ON) ; `ruff:TID253 banned-module-level-imports` (OFF; configure for heavy modules).
- **Why it hurts:** testability (importing a module for a unit test opens a socket), startup latency, import cycles, surprise failures in tooling (docs builds, `pytest --collect-only`); in libraries, `basicConfig` hijacks the host application's logging.
- **Severity:** major for libraries and shared packages; minor in an application entry-point module.
- **Remediation:** lazy initialisation behind a function (`functools.cache`'d factory), explicit `main()`/app factory, dependency injection — trap: in AWS Lambda the _opposite_ is desired for SDK clients (see PY-36); distinguish "cheap, idempotent client construction" from "I/O that can fail".
- **Not a finding when:** constants, compiled regexes, logger _creation_ (`logging.getLogger(__name__)`), Lambda handler modules constructing SDK clients.
- **Architecture:** yes when a shared package does it — affects every consumer; escalate.
- **Sources:** https://docs.python.org/3/howto/logging.html (Configuring Logging for a Library) ; https://docs.astral.sh/ruff/rules/global-statement/

### PY-16 Global mutable state

- **Signal:** `global x` in functions; module-level dicts/lists used as caches/registries mutated at runtime; `functools.lru_cache` on instance methods.
- **Tool coverage:** `ruff:PLW0603 global-statement` (OFF) ; `ruff:PLW0602 global-variable-not-assigned` (default ON) ; `ruff:PLW0604 global-at-module-level` (default ON) ; `ruff:B019 cached-instance-method` (default ON — memory leak: cache holds `self`). partial: mutation through a module-level container without `global` is invisible to tools.
- **Why it hurts:** reliability/testability — test order dependence, thread-safety, cross-request leakage in servers/warm Lambdas (AWS explicitly warns not to keep user data in the execution environment).
- **Severity:** major; blocker if user data crosses requests.
- **Remediation:** pass state explicitly; encapsulate in an object with a defined lifecycle; `contextvars.ContextVar` for request scope; cache with explicit bounds/TTL keyed on arguments only.
- **Not a finding when:** immutable config loaded once; process-wide registries populated only at import (plugin registry) and read-only afterwards.
- **Architecture:** sometimes — caches/registries shared across tenants.
- **Sources:** https://docs.astral.sh/ruff/rules/global-statement/ ; https://docs.astral.sh/ruff/rules/cached-instance-method/ ; https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html

### PY-17 Relative imports reaching across packages / private-member access

- **Signal:** `from ...other_pkg.internal import _helper`; `obj._private` from outside the defining module.
- **Tool coverage:** `ruff:TID252 relative-imports` (OFF; `ban-relative-imports = "parents"`) ; `ruff:SLF001 private-member-access` (OFF) ; `ruff:TID251 banned-api` (OFF; configurable) ; `import-linter` `Forbidden`/`Protected` contracts.
- **Why it hurts:** encapsulation/modifiability — the consumer depends on internals that change without notice.
- **Severity:** minor within a package, major across packages.
- **Remediation:** expose a public function; Move Function; `import-linter` contract.
- **Not a finding when:** tests accessing internals of their own module deliberately (prefer public surface still); `_replace`/`_asdict` on namedtuples (public API with underscore).
- **Architecture:** yes across packages.
- **Sources:** https://docs.astral.sh/ruff/rules/ (TID/SLF rows)

## Typing & boundaries

### PY-18 `Any` leakage and untyped boundaries

- **Signal:** `def f(data: Any) -> Any`; `dict[str, Any]` passed deep into domain code; `json.loads(...)` result used without validation; functions with no annotations called from typed code; `cast(...)` to paper over a boundary.
- **Tool coverage:** `ruff:ANN401 any-type` (OFF) ; `ruff:ANN001`/`ANN201` (OFF) ; `mypy --strict` (`--disallow-untyped-defs`, `--disallow-untyped-calls`, `--warn-return-any`, `--disallow-any-generics`) ; **not** in `--strict`: `--disallow-any-explicit` `[explicit-any]`, `--disallow-any-expr`. partial: `Any` returned from third-party untyped libs spreads silently unless `--disallow-any-expr`/`no-any-unimported`.
- **Why it hurts:** type-safety erosion — the checker proves nothing downstream of an `Any`; runtime `KeyError`/`AttributeError` far from the source.
- **Severity:** major at I/O boundaries (HTTP payloads, queue messages, env, DB rows); minor internally.
- **Remediation:** Parse, don't validate — convert at the edge into a validated type (`pydantic.BaseModel.model_validate`/`TypeAdapter`, `msgspec`, or a `dataclass` built by a parser); use `object` instead of `Any` for "anything" so the checker forces narrowing — trap: `TypedDict` gives zero runtime checking (typing docs: "There is no runtime checking"), so `cast(MyTypedDict, json.loads(s))` is a lie.
- **Not a finding when:** `**kwargs: Any` forwarding (ANN401 has `allow-star-arg-any`); genuinely heterogeneous containers with an immediate `isinstance` narrow.
- **Architecture:** yes when the untyped value is a cross-service/wire contract — escalate (contract ownership).
- **Sources:** https://docs.astral.sh/ruff/rules/any-type/ ; https://mypy.readthedocs.io/en/stable/command_line.html ; https://docs.python.org/3/library/typing.html

### PY-19 Blanket `# type: ignore` / `# noqa`

- **Signal:** `# type: ignore` without `[code]`; `# noqa` without codes; stale ignores.
- **Tool coverage:** `ruff:PGH003 blanket-type-ignore` (OFF) ; `ruff:PGH004 blanket-noqa` (OFF, fix) ; `ruff:RUF100 unused-noqa` (default ON) ; mypy `--warn-unused-ignores` (in `--strict`) ; mypy `--enable-error-code ignore-without-code` (not in `--strict`).
- **Why it hurts:** type-safety erosion — a blanket ignore suppresses _future_ unrelated errors on that line.
- **Severity:** minor each; major as a trend (count per diff).
- **Remediation:** `# type: ignore[attr-defined]  # reason`; fix the type; stub the untyped dependency.
- **Not a finding when:** coded, justified ignore on an untyped third-party call.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/blanket-type-ignore/ ; https://mypy.readthedocs.io/en/stable/error_code_list2.html

### PY-20 Implicit / misused `Optional`

- **Signal:** `def f(x: int = None)`; `Optional[T]` return where `None` means "error"; `x: str | None` then used without a narrow; `if value:` on `int | None` (treats `0` as missing).
- **Tool coverage:** `ruff:RUF013 implicit-optional` (default ON; misses type aliases) ; `ruff:RUF036 none-not-at-end-of-union` (OFF) ; mypy strict catches unnarrowed use ; mypy `truthy-bool` (optional code) catches `if obj:` on always-truthy types; `possibly-undefined`. partial: "None as error signal" is judgement.
- **Why it hurts:** correctness — falsy `0`/`""` treated as absent; `None` propagates to crash far away.
- **Severity:** major when `None` encodes failure.
- **Remediation:** `is None` checks; raise instead of returning `None` for errors; result/union types (`Found | NotFound`) with exhaustive `match` + `typing.assert_never` / mypy `exhaustive-match`.
- **Not a finding when:** `None` genuinely means "absent" and callers must handle it.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/implicit-optional/ ; https://mypy.readthedocs.io/en/stable/error_code_list2.html

### PY-21 `TypedDict` / `dataclass` / `pydantic` chosen for the wrong job

- **Signal:** `TypedDict` for untrusted input with no validator; pydantic models used as internal domain entities with validators doing I/O; `model_construct()` on external data; dataclass with `__post_init__` doing heavy validation duplicating a pydantic layer; `extra="allow"` on API request models.
- **Tool coverage:** none — judgement. `semgrep` custom rule for `\.model_construct\(`.
- **Why it hurts:** security/correctness — pydantic docs: `model_construct()` "does not do any validation … can create models which are invalid", and with `extra='forbid'` it silently ignores extra data instead of raising.
- **Severity:** major (blocker if `model_construct` on request data).
- **Remediation:** Validate at the boundary with pydantic (`model_validate`, `TypeAdapter`); inside the domain use frozen `dataclass(frozen=True, slots=True)` value objects; `TypedDict` only for already-trusted dict shapes (e.g. typing `**kwargs`) — trap: pydantic v2 docs note `model_construct` is often _not_ faster; profile before using it for speed.
- **Not a finding when:** `model_construct` on data just produced by `model_dump` of a validated model.
- **Architecture:** yes if it defines a wire/persisted contract.
- **Sources:** https://docs.pydantic.dev/latest/concepts/models/ ; https://docs.python.org/3/library/typing.html

## Security hygiene (bandit family)

### PY-22 SQL built by string formatting

- **Signal:** `cursor.execute(f"SELECT … {x}")`, `"… %s" % x`, `"…" + x`, `.format()` into `execute`/`text()`/`raw()`.
- **Tool coverage:** `ruff:S608 hardcoded-sql-expression` (**OFF by default**) ; `semgrep:python.lang.security.audit.formatted-sql-query.formatted-sql-query` ; `semgrep:python.lang.security.audit.sqli.psycopg-sqli.psycopg-sqli` (also asyncpg/aiopg/pg8000 variants) ; `semgrep:python.aws-lambda.security.tainted-sql-string.tainted-sql-string` ; `semgrep:python.django.security.injection.sql.sql-injection-using-db-cursor-execute.*`. partial: S608 is heuristic (FPs on SQL-looking log strings; FNs on dynamic identifiers); taint through helpers needs Semgrep Pro/CodeQL.
- **Why it hurts:** security — CWE-89 injection.
- **Severity:** blocker if any component is user-influenced; major otherwise (pattern will be copied).
- **Remediation:** parameterised queries (driver placeholders / SQLAlchemy `bindparam`); for identifiers use `psycopg.sql.Identifier` / allow-list — trap: quoting values manually.
- **Not a finding when:** interpolating only constants from a closed allow-list (still prefer the driver's identifier API).
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/hardcoded-sql-expression/ ; https://github.com/semgrep/semgrep-rules/tree/develop/python/lang/security

### PY-23 Shell injection via `subprocess`/`os.system`

- **Signal:** `subprocess.run(cmd, shell=True)` with any interpolation; `os.system(f"...")`; `subprocess.run(["tool", …])` with no `check=`; partial executable paths.
- **Tool coverage:** `ruff:S602 subprocess-popen-with-shell-equals-true`, `S604 call-with-shell-equals-true`, `S605 start-process-with-a-shell`, `S603 subprocess-without-shell-equals-true` (noisy, FP-prone per its doc), `S607 start-process-with-partial-path` — **all OFF** ; `ruff:PLW1510 subprocess-run-without-check` (default ON) ; `semgrep:python.lang.security.audit.subprocess-shell-true.subprocess-shell-true` ; `semgrep:python.lang.security.audit.dangerous-subprocess-use-audit.*` ; `semgrep:python.lang.correctness.unchecked-returns.unchecked-subprocess-call`.
- **Why it hurts:** security (CWE-78); reliability — non-zero exit silently ignored.
- **Severity:** blocker with untrusted input.
- **Remediation:** list-form argv, `shell=False`, `shlex.quote` only when a shell is unavoidable, `check=True`, absolute executable path, timeout — trap: PLW1510's fix inserts `check=False`, codifying the silent failure.
- **Not a finding when:** constant argv in build scripts.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/subprocess-without-shell-equals-true/ ; https://docs.astral.sh/ruff/rules/subprocess-run-without-check/

### PY-24 Unsafe deserialisation / dynamic code execution

- **Signal:** `pickle.load(s)`, `shelve`, `dill`, `yaml.load(` without `SafeLoader`, `eval(`, `exec(`, `marshal.loads`, `importlib.import_module(user_value)`.
- **Tool coverage:** `ruff:S301 suspicious-pickle-usage` (OFF) ; `ruff:S506 unsafe-yaml-load` (OFF) ; `ruff:S307 suspicious-eval-usage` (OFF) ; `ruff:S102 exec-builtin` (default ON) ; `semgrep:python.lang.security.deserialization.pickle.avoid-pickle` (+`avoid-dill`, `avoid-shelve`) ; `semgrep:python.lang.security.deserialization.avoid-pyyaml-load.avoid-pyyaml-load` ; `semgrep:python.lang.security.audit.eval-detected.eval-detected` ; `semgrep:python.lang.security.audit.non-literal-import.non-literal-import`.
- **Why it hurts:** security — arbitrary code execution (CWE-502).
- **Severity:** blocker if data crosses a trust boundary (S3 object, queue message, cache, upload).
- **Remediation:** JSON/msgspec; `yaml.safe_load`; HMAC-sign pickles only between trusted components (ruff doc) — trap: "the cache is internal" — caches are shared attack surface.
- **Not a finding when:** pickling within one process (multiprocessing) of self-produced objects; `ast.literal_eval` (safe for literals).
- **Architecture:** yes if a serialised format crosses a service/storage boundary.
- **Sources:** https://docs.astral.sh/ruff/rules/suspicious-pickle-usage/ ; https://docs.astral.sh/ruff/rules/unsafe-yaml-load/

### PY-25 HTTP calls without timeout / with TLS verification off

- **Signal:** `requests.get(url)` with no `timeout=`; `verify=False`; `httpx` client without timeout config (`UNVERIFIED` — httpx defaults to a 5s timeout).
- **Tool coverage:** `ruff:S113 request-without-timeout` (OFF) ; `ruff:S501 request-with-no-cert-validation` (OFF) ; `ruff:ASYNC210 blocking-http-call-in-async-function` (default ON) ; `semgrep:python.lang.security.audit.network.disabled-cert-validation.*` (id `UNVERIFIED`).
- **Why it hurts:** reliability — a hung upstream pins a worker forever (Release It! "integration point" failure); security — MITM.
- **Severity:** major (blocker for verify=False in prod paths).
- **Remediation:** explicit `(connect, read)` timeouts; session reuse; retries via `urllib3.Retry`/`tenacity` with backoff+jitter — library-first, don't hand-roll.
- **Not a finding when:** tests with a local mock server.
- **Architecture:** yes when it's an inter-service call (timeouts budget across the call graph).
- **Sources:** https://docs.astral.sh/ruff/rules/ (S113/S501 rows)

### PY-26 Weak crypto / insecure randomness / hard-coded secrets / temp files

- **Signal:** `hashlib.md5(` for security, `random.random()` for tokens, `password = "..."`, `tempfile.mktemp(`, `/tmp/fixed-name`, binding `0.0.0.0`.
- **Tool coverage:** `ruff:S324 hashlib-insecure-hash-function`, `S311 suspicious-non-cryptographic-random-usage`, `S105 hardcoded-password-string`, `S106`, `S108 hardcoded-temp-file`, `S104 hardcoded-bind-all-interfaces` (all OFF) ; `semgrep:python.lang.correctness.tempfile.mktemp.tempfile-insecure` ; `semgrep:python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure`.
- **Why it hurts:** security.
- **Severity:** blocker for secrets/tokens; minor for md5 used as a non-security checksum.
- **Remediation:** `secrets.token_urlsafe`, `hashlib.sha256`/`usedforsecurity=False` for checksums, `tempfile.NamedTemporaryFile`/`mkstemp`, secrets manager.
- **Not a finding when:** md5 for cache keys/ETags with `usedforsecurity=False`; `random` for simulations/jitter.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/ (S rows)

## Resources, time, numbers, paths, logging

### PY-27 Resources not managed by a context manager

- **Signal:** `f = open(...)` without `with`; `conn = pool.getconn()` without `try/finally`; `tempfile.NamedTemporaryFile()` assigned; `Session()` not closed.
- **Tool coverage:** `ruff:SIM115 open-file-with-context-handler` (default ON) ; `ruff:PLW1514 unspecified-encoding` (**preview**) ; `semgrep:python.lang.best-practice.open-never-closed.open-never-closed` ; `semgrep:python.lang.correctness.tempfile.flush.tempfile-without-flush`. partial: DB connections/sockets/clients are not covered by SIM115.
- **Why it hurts:** reliability — fd/connection exhaustion under load; data not flushed on error.
- **Severity:** major in long-running processes.
- **Remediation:** `with`/`async with`; `contextlib.ExitStack` for dynamic counts; `closing()`; explicit `encoding="utf-8"`.
- **Not a finding when:** ownership is intentionally transferred and closed by the receiver (document it).
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/ (SIM115 row)

### PY-28 Naive datetimes

- **Signal:** `datetime.now()`, `datetime.utcnow()`, `datetime.utcfromtimestamp()`, `strptime` without `%z`, comparing aware vs naive, storing naive timestamps.
- **Tool coverage:** `ruff:DTZ001`–`DTZ012`, `DTZ901 datetime-min-max` (**all 10 default ON** in 0.16) — e.g. `DTZ005 call-datetime-now-without-tzinfo`, `DTZ003 call-datetime-utcnow`, `DTZ007 call-datetime-strptime-without-zone`. `datetime.utcnow()`/`utcfromtimestamp()` are **deprecated since 3.12**.
- **Why it hurts:** correctness — `utcnow()` returns a _naive_ object that `.timestamp()` interprets as local time; DST bugs; `TypeError` comparing aware/naive.
- **Severity:** major for persisted/compared timestamps.
- **Remediation:** `datetime.now(tz=UTC)` (3.11+ `datetime.UTC`); `zoneinfo.ZoneInfo` for display zones; store UTC ISO-8601 — library-first, don't hand-roll offsets.
- **Not a finding when:** a documented local-wall-clock value (e.g. a user's chosen alarm time) stored with its zone separately.
- **Architecture:** yes if a persisted/wire timestamp format changes.
- **Sources:** https://docs.astral.sh/ruff/rules/call-datetime-now-without-tzinfo/ ; https://docs.python.org/3/library/datetime.html

### PY-29 Floats for money / exact quantities

- **Signal:** `price: float`, `round(total * 1.2, 2)`, summing currency floats, `==` on floats.
- **Tool coverage:** none — judgement (`ruff:PLW0177 nan-comparison` default ON covers only NaN). `semgrep:python.django.correctness.use-decimalfield-for-money.*` (Django only; id `UNVERIFIED`).
- **Why it hurts:** correctness — most decimal fractions have no exact binary representation (Python tutorial "Floating-Point Arithmetic").
- **Severity:** major (blocker for billing/ledger).
- **Remediation:** `decimal.Decimal` with an explicit context/quantize, or integer minor units; `math.isclose` for float comparisons.
- **Not a finding when:** scientific/statistical quantities, approximate nutrition figures where tolerance is specified.
- **Architecture:** yes if the type is in a persisted schema or wire contract.
- **Sources:** https://docs.python.org/3/tutorial/floatingpoint.html

### PY-30 `os.path` string plumbing

- **Signal:** `os.path.join`, `os.path.exists`, `open(os.path.join(...))`, string concatenation of paths.
- **Tool coverage:** `ruff:PTH100`–`PTH2xx` (35 rules, only PTH124/PTH210 default) e.g. `PTH118 os-path-join`, `PTH123 builtin-open`.
- **Why it hurts:** readability/portability — minor.
- **Severity:** minor.
- **Remediation:** `pathlib.Path` — trap (from PTH123 doc): pathlib can be slower in hot loops; don't churn working code purely for style.
- **Not a finding when:** hot paths, or libraries needing `str` paths for C extensions.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/builtin-open/

### PY-31 Eager log formatting, `print` in libraries, root-logger calls

- **Signal:** `logger.info(f"...")`, `logger.debug("%s" % x)`, `print(` in non-CLI modules, `logging.info(` (root), `logging.basicConfig` in a library.
- **Tool coverage:** `ruff:G004 logging-f-string` (OFF), `G002`/`G003` (OFF) ; `ruff:LOG015 root-logger-call` (default ON) ; `ruff:T201 print` (OFF; fix _removes_ the print — unsafe) ; `ruff:PLE1205/PLE1206` logging arg count (default ON).
- **Why it hurts:** performance (formatting when level disabled), operability (unstructured logs, values not in `extra`), library hygiene (logging HOWTO: libraries should not configure handlers; add `NullHandler` at most).
- **Severity:** minor; major for `print` of sensitive data.
- **Remediation:** `logger = logging.getLogger(__name__)`; `logger.info("msg %s", x)` or `extra={...}`; structured logger (e.g. Powertools Logger in Lambda).
- **Not a finding when:** CLI output; f-string logging in code where the message is cheap and structured logging isn't used (G004 is style-level).
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/logging-f-string/ ; https://docs.astral.sh/ruff/rules/print/ ; https://docs.python.org/3/howto/logging.html

## Performance hygiene

### PY-32 N+1 queries / calls in loops

- **Signal:** `for x in items: session.query(...)` / `repo.get(x.id)` / `client.get_item(...)` / `requests.get(...)`; ORM lazy-loaded relationship accessed in a loop.
- **Tool coverage:** none — judgement. `semgrep:python.django.performance.access-foreign-keys.*` (Django-only, id `UNVERIFIED`). `ruff:PERF203 try-except-in-loop` (OFF; only enforced <3.11 — zero-cost exceptions in 3.11+).
- **Why it hurts:** performance/cost — O(n) round-trips; latency, DB connection saturation, API rate limits.
- **Severity:** major on request paths; minor in batch scripts with small n.
- **Remediation:** batch APIs (`WHERE id = ANY(:ids)`, `BatchGetItem`), eager loading (`selectinload`), DataLoader pattern; bounded concurrency (`asyncio.Semaphore`/`TaskGroup`) — trap: unbounded `gather` over thousands of calls trades N+1 for a thundering herd.
- **Not a finding when:** n is bounded and tiny by construction and documented.
- **Architecture:** yes when it crosses a service boundary (chatty interface) — escalate.
- **Sources:** judgement; https://docs.astral.sh/ruff/rules/try-except-in-loop/

### PY-33 Materialising lists where iteration suffices

- **Signal:** `sum([x for x in ...])`, `any([...])`, `list(x)[0]`, `for x in list(d.keys())`, manual append loops.
- **Tool coverage:** `ruff:C419 unnecessary-comprehension-in-call` (default ON) ; `ruff:RUF015 unnecessary-iterable-allocation-for-first-element` (default ON) ; `ruff:PERF101 unnecessary-list-cast` (default ON) ; `ruff:PERF401 manual-list-comprehension` (OFF) ; `ruff:PERF403 manual-dict-comprehension` (OFF) ; `ruff:PLC0206 dict-index-missing-items` (default ON).
- **Why it hurts:** performance/memory; `any([...])` loses short-circuiting.
- **Severity:** minor.
- **Remediation:** generator expressions, `next(iter(...))`, comprehensions — trap: a generator is single-pass; converting a list that is iterated twice breaks correctness.
- **Not a finding when:** the sequence is reused, needs `len`, or iteration mutates the source (copy is deliberate — PY-05).
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/ (C419/RUF015/PERF rows)

## Design & complexity

### PY-34 Long / branchy / many-argument functions

- **Signal:** McCabe > 10; > 12 branches; > 6 returns; > 50 statements; > 5 args / > 5 positional; > 15 locals; nesting > 5; > 5 boolean sub-expressions.
- **Tool coverage:** `ruff:C901 complex-structure` (OFF; `max-complexity` 10) ; `ruff:PLR0912 too-many-branches` (OFF; 12) ; `ruff:PLR0911 too-many-return-statements` (OFF; 6) ; `ruff:PLR0915 too-many-statements` (OFF; 50) ; `ruff:PLR0913 too-many-arguments` (OFF; 5; exempts `@typing.override`) ; `ruff:PLR0917 too-many-positional-arguments` (OFF; 5; added 0.16.0 as stable) ; `ruff:PLR0914 too-many-locals`, `PLR1702 too-many-nested-blocks`, `PLR0916 too-many-boolean-expressions` (**preview**). No cognitive-complexity rule in ruff (see XC cognitive complexity; SonarQube `python:S3776` `UNVERIFIED` here).
- **Why it hurts:** maintainability/testability — path explosion; cannot be unit-tested exhaustively.
- **Severity:** minor at threshold; major at ~2× threshold or when the function mixes I/O and decisions.
- **Remediation:** Extract Function, Decompose Conditional, Replace Conditional with Polymorphism / dispatch dict (PLR0911 doc example), Introduce Parameter Object / keyword-only args (`*`) for PLR0917 — trap: splitting into many 3-line functions that pass 8 values around (Data Clumps) is not an improvement.
- **Not a finding when:** flat `match` over a closed enum with trivial arms (high cyclomatic, low cognitive); generated parsers; CLI arg wiring.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/settings/ ; https://docs.astral.sh/ruff/rules/too-many-branches/ ; https://docs.astral.sh/ruff/rules/too-many-positional-arguments/ ; https://docs.astral.sh/ruff/rules/too-many-locals/

### PY-35 Magic numbers and strings

- **Signal:** comparisons against unexplained literals (`if retries > 3`, `if status == 7`), repeated string keys (`row["usr_nm"]`) across modules.
- **Tool coverage:** `ruff:PLR2004 magic-value-comparison` (OFF; `allow-magic-value-types` default `["str", "bytes"]` so **ints/floats are flagged**, strings are not). partial: repeated string keys/dict-as-struct — judgement.
- **Why it hurts:** maintainability — Connascence of Meaning; changes need shotgun edits.
- **Severity:** minor; major when the value is a business rule duplicated in several places.
- **Remediation:** Replace Magic Literal (named constant), `enum.Enum`/`StrEnum`, `Literal[...]` types.
- **Not a finding when:** `0`, `1`, `-1`, `2` in arithmetic idioms; HTTP status codes via `http.HTTPStatus` is better but `== 200` in tests is fine.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/magic-value-comparison/ ; https://docs.astral.sh/ruff/settings/

### PY-36 God class / deep inheritance / classes where functions suffice

- **Signal:** class > 20 public methods, > 7 instance attributes, > 7 ancestors; a class with one public method plus `__init__` (should be a function); class of only `@staticmethod`s used as a namespace; mixin towers; `Manager`/`Helper`/`Utils` names.
- **Tool coverage:** `pylint:too-many-public-methods / R0904` (20), `too-many-instance-attributes / R0902` (7), `too-many-ancestors / R0901` (7), `too-few-public-methods / R0903` (min 2) ; ruff only has `PLR0904` (**preview**) and `PLR6301 no-self-use` (**preview**) — **no ruff equivalent for R0901/R0902/R0903**. partial: cohesion (TCC/LCOM) is judgement — see XC Lanza-Marinescu God Class.
- **Why it hurts:** maintainability — Divergent Change; hard to test; inheritance couples subclasses to parent internals (fragile base class).
- **Severity:** major.
- **Remediation:** Extract Class, Replace Superclass with Delegate, Replace Subclass with Delegate, module-level functions for stateless helpers — trap: R0903 flags legitimate dataclasses/protocols; configure `exclude-too-few-public-methods` or ignore for data holders.
- **Not a finding when:** framework-mandated base classes (Django CBVs, `unittest.TestCase`), `Protocol`s, dataclasses/pydantic models.
- **Architecture:** yes when the class spans multiple bounded contexts — escalate.
- **Sources:** https://pylint.readthedocs.io/en/stable/user_guide/configuration/all-options.html ; https://pylint.readthedocs.io/en/stable/user_guide/messages/refactor/too-many-ancestors.html

### PY-37 Boolean-trap parameters

- **Signal:** `def render(item, compact: bool = False)`, call sites `render(x, True)`.
- **Tool coverage:** `ruff:FBT001 boolean-type-hint-positional-argument`, `FBT002 boolean-default-value-positional-argument`, `FBT003 boolean-positional-value-in-call` (all OFF; dunders, setters and `@override` exempt).
- **Why it hurts:** readability; a flag that switches behaviour is often two functions (Remove Flag Argument).
- **Severity:** minor; major when the flag switches substantially different behaviour.
- **Remediation:** Remove Flag Argument (split), keyword-only `*, compact: bool`, or `Enum`.
- **Not a finding when:** keyword-only booleans that toggle a trivial display detail.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/boolean-type-hint-positional-argument/

### PY-38 Dead code: commented-out code, unused args/vars/imports, `async` with no `await`

- **Signal:** `# old_impl(x)` blocks; unused parameters; unused imports; `async def` that never awaits.
- **Tool coverage:** `ruff:ERA001 commented-out-code` (OFF; FP-prone per doc) ; `ruff:ARG001`–`ARG005` (OFF) ; `ruff:F401 unused-import`, `F841 unused-variable` (default ON) ; `ruff:RUF029 unused-async` (**preview**) ; `ruff:RUF052 used-dummy-variable` (preview) ; `vulture` (whole-program dead code, `UNVERIFIED` not opened).
- **Why it hurts:** maintainability — Lava Flow; unused `async` forces every caller into async context.
- **Severity:** minor.
- **Remediation:** delete (VCS remembers); for interface-mandated args prefix `_`.
- **Not a finding when:** args required by a callback/override signature (use `_arg` or `@override`), re-exports in `__init__.py` listed in `__all__`.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/commented-out-code/ ; https://docs.astral.sh/ruff/rules/unused-async/

## Async

### PY-39 Fire-and-forget tasks garbage-collected mid-flight

- **Signal:** `asyncio.create_task(coro())` / `asyncio.ensure_future(...)` as a bare expression statement; **also** `_ = asyncio.create_task(...)` inside a loop (the name is rebound each iteration, dropping earlier references).
- **Tool coverage:** `ruff:RUF006 asyncio-dangling-task` (**OFF by default in 0.16**) ; mypy optional `unused-awaitable` (not in `--strict`). ⚠️ mypy's own docs suggest silencing `unused-awaitable` with `_ = asyncio.create_task(f())` — that silences the checker **without** creating a durable strong reference, so it can still lose the task. partial: tasks stored in a local that goes out of scope before completion are missed by both.
- **Why it hurts:** reliability — Python docs: "The event loop only keeps weak references to tasks. A task that isn't referenced elsewhere may get garbage collected at any time, even before it's done." Heisenbug: work silently never completes; exceptions never retrieved.
- **Severity:** major (blocker if the task performs writes/acks).
- **Remediation:** `asyncio.TaskGroup` (3.11+) for structured concurrency; otherwise a module/obj-level `set` + `task.add_done_callback(tasks.discard)`; handle exceptions in a done-callback — trap: in AWS Lambda a background task still pending when the handler returns is frozen with the environment and may never run.
- **Not a finding when:** the returned task is stored in a long-lived container or awaited later.
- **Architecture:** yes if used as a substitute for a queue (durability) — escalate.
- **Sources:** https://docs.astral.sh/ruff/rules/asyncio-dangling-task/ ; https://docs.python.org/3/library/asyncio-task.html ; https://mypy.readthedocs.io/en/stable/error_code_list2.html

### PY-40 Blocking calls inside `async def`

- **Signal:** in `async def`: `time.sleep`, `requests.*`, `open()`/`Path.read_text`, `subprocess.run`, sync DB drivers (psycopg2, boto3), CPU-heavy loops, `while not done: await asyncio.sleep(0.1)` polling.
- **Tool coverage:** `ruff:ASYNC251 blocking-sleep-in-async-function`, `ASYNC210 blocking-http-call-in-async-function`, `ASYNC230 blocking-open-call-in-async-function`, `ASYNC220/221/222` subprocess (all default ON) ; `ruff:ASYNC110 async-busy-wait` (OFF) ; `semgrep:python.lang.correctness.sync-sleep-in-async-code.sync-sleep-in-async-code` ; runtime: asyncio debug mode (`PYTHONASYNCIODEBUG=1`) logs callbacks slower than `loop.slow_callback_duration`. partial: boto3/sync ORM/CPU work not detected — judgement.
- **Why it hurts:** performance/reliability — blocks the whole event loop; all concurrent requests stall; health checks time out.
- **Severity:** major on servers.
- **Remediation:** async libraries (httpx.AsyncClient, anyio file APIs, asyncpg/psycopg3 async), `asyncio.to_thread(...)` / `loop.run_in_executor` for unavoidable blocking I/O, `ProcessPoolExecutor` for CPU; `asyncio.Event` instead of polling.
- **Not a finding when:** one-shot startup code before the loop serves traffic.
- **Architecture:** no.
- **Sources:** https://docs.astral.sh/ruff/rules/blocking-open-call-in-async-function/ ; https://docs.python.org/3/library/asyncio-dev.html

### PY-41 Missing `await`

- **Signal:** calling an `async def` without `await` (`client.close()` where `close` is async); `RuntimeWarning: coroutine '...' was never awaited`.
- **Tool coverage:** mypy default error code `[unused-coroutine]` ("Error: missing await") — on without `--strict` ; `ruff:ASYNC105 trio-sync-call` (default ON, trio only) ; `ruff:PLE1142 await-outside-async` (default ON). partial: a coroutine assigned to a variable or passed to a non-awaiting function is not flagged.
- **Why it hurts:** correctness — the operation never runs.
- **Severity:** major.
- **Remediation:** `await`; enable mypy on the package.
- **Not a finding when:** coroutine intentionally passed to `TaskGroup.create_task`/`gather`.
- **Architecture:** no.
- **Sources:** https://mypy.readthedocs.io/en/stable/error_code_list.html

## AWS Lambda specifics

### PY-42 Per-invocation initialisation in the handler (and the reverse)

- **Signal:** `boto3.client(...)`, DB connection, model load, `json.load(open("big.json"))` _inside_ `lambda_handler`; conversely, per-request/user data cached in module globals.
- **Tool coverage:** none — judgement.
- **Why it hurts:** performance/cost — AWS: "Initialize SDK clients and database connections outside of the function handler … Subsequent invocations processed by the same instance … can reuse these resources"; security — AWS: "don't use the execution environment to store user data, events, or other information with security implications."
- **Severity:** minor (latency) → blocker (user data in globals).
- **Remediation:** construct clients at module scope; lazily-initialised cached factory for expensive, conditionally-needed resources; separate handler from core logic for testability (AWS Python best practices) — trap: the Init phase is limited to **10 seconds** (not for provisioned concurrency/SnapStart); heavy module-scope work that exceeds it is retried at first invoke under the function timeout — move very heavy loads to lazy init.
- **Not a finding when:** resources that must be per-tenant/per-request (credentials scoped to the caller).
- **Architecture:** yes for connection-pool sizing vs concurrency (RDS connection exhaustion) — escalate.
- **Sources:** https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html ; https://docs.aws.amazon.com/lambda/latest/dg/python-handler.html ; https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html

### PY-43 Writing outside `/tmp` / assuming `/tmp` is clean or large

- **Signal:** libraries that write caches to `$HOME`/package dir on import (NLTK downloads, matplotlib/HF caches), `open("output.txt","w")` relative to CWD, assuming `/tmp` empty at start, large downloads to `/tmp`.
- **Tool coverage:** none — judgement (`ruff:S108 hardcoded-temp-file` OFF flags `/tmp` literals, the opposite concern).
- **Why it hurts:** reliability — `OSError: [Errno 30] Read-only file system`; AWS container-image docs: images "must be able to run on a read-only file system" with writable `/tmp` of 512–10,240 MB; runtime docs: a Lambda reset "does not clear the /tmp directory content before the next init phase" → stale/partial files across invocations; `/tmp` quota overflow.
- **Severity:** blocker (cold-start crash) when an import-time dependency writes to a read-only path.
- **Remediation:** point library caches at build-time-baked assets or `/tmp` via env (`NLTK_DATA`, `HF_HOME`, `MPLCONFIGDIR`); unique `tempfile.mkdtemp()` per invocation and clean up; size `EphemeralStorage` — trap: unit tests run on a writable FS and never reproduce it; test the built artifact in the Lambda runtime image.
- **Not a finding when:** deliberate `/tmp` caching of static assets keyed by content hash (AWS recommends caching static assets in `/tmp`).
- **Architecture:** yes — packaging/deployable shape; escalate to infra owner.
- **Sources:** https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html ; https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html ; https://docs.aws.amazon.com/lambda/latest/dg/images-create.html

### PY-44 Non-idempotent handlers

- **Signal:** SQS/SNS/EventBridge handler that inserts/charges/sends without a dedupe key; partial-batch failures raising for the whole batch.
- **Tool coverage:** none — judgement.
- **Why it hurts:** correctness — AWS: "Write idempotent code … gracefully handle duplicate events"; at-least-once delivery causes double effects.
- **Severity:** blocker for payments/emails; major otherwise.
- **Remediation:** idempotency key + conditional write (`INSERT … ON CONFLICT DO NOTHING`, DynamoDB conditional put), Powertools for AWS Lambda Idempotency utility (library-first), partial batch response for SQS.
- **Not a finding when:** naturally idempotent operations (PUT of full state).
- **Architecture:** yes — delivery semantics; escalate.
- **Sources:** https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html

## Open questions / unverified

- Semgrep ids marked `UNVERIFIED`: `dict-modify-iterating` file id, `disabled-cert-validation` id, Django `use-decimalfield-for-money` and `access-foreign-keys` ids (files exist in `semgrep-rules/develop`, ids not read).
- httpx default timeout (5 s) not opened this session.
- Pydantic per-instance copying of mutable field defaults — not re-read in current docs.
- `vulture` and SonarQube Python cognitive-complexity rule key (`python:S3776`) not opened.
- `B023` false-positive guidance for immediately-invoked closures is judgement; the ruff page does not discuss it.
- Ruff's default set is new (0.16.0, July 2026) and GitHub issue #27199 records that 18 removals were not listed in BREAKING_CHANGES — expect the set to move again; re-scrape `/default-rules/` rather than trusting this table long-term.
- Bandit CLI (as opposed to ruff `S`) test IDs (B1xx–B7xx) were not individually opened; ruff doc pages cite them (e.g. S608 → bandit B608).
