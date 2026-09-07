# `@kitchensink/docs-site`

The engineering documentation site. Docusaurus 3, assembled at build time from material that lives
elsewhere in this repository and **stays there**.

```bash
npm run docs:dev   --workspace=@kitchensink/docs-site   # dev server, hot reload, http://localhost:3000
npm run docs:build --workspace=@kitchensink/docs-site   # production build into build/
npm run docs:serve --workspace=@kitchensink/docs-site   # serve the production build
npm run test       --workspace=@kitchensink/docs-site   # the ingestion layer's unit + guard tiers
```

## ⛔ The site is PUBLIC

`.github/workflows/docs.yml` publishes it to Vercel on every push to `main`, and on demand, **with no
login in front of it.** Anyone with the URL can read all of it.

That is an owner ruling, and it reverses the original design. This package was built to publish behind
Vercel Authentication scoped to All Deployments, and the workflow refused to deploy unless the API
reported that scope. The protection is **not available on this team's plan, and it fails open**:
measured 2026-09-02, the API accepts the `ssoProtection` setting and does not enforce it, and a real
preview deployment served real content to an anonymous request. An assertion against an API that lies is
worse than no assertion, because it is what everyone downstream relies on. ⛔ Do not re-add it on the
strength of the API accepting the setting; that is exactly what was already tried.

The control moved from "nobody can read it" to **"there is nothing in it worth reading"**, which holds
only because two things enforce it:

- **The allowlist** (`include` in `src/content/contentRegistry.ts`) — `docs/` also holds working
  material that is correspondence rather than documentation, and none of it ships. Widening a glob
  publishes whatever it reaches.
- **The AWS account id is absent, and checked.** A document that needs to name the account it measured
  against writes `` `<aws-account-id>` `` instead of the digits. `docs.yml` scans the BUILT site before
  the artifact is uploaded — on pull requests too, so an offending document is red before it merges —
  and `packages/infra/global/__tests__/assertNoAwsAccountIds.test.ts` scans the sources on the ordinary
  test tier. Both run `scripts/assertNoAwsAccountIds.mjs`, which DERIVES the ids from the repository's
  own ARNs rather than hardcoding one, so neither the guard nor its failure output ever restates the
  value. If either goes red, scrub the document — do not weaken the guard.

The project keeps **no custom domain and no branch domain**, still — the reason is no longer protection
(nothing is protected) but ADR-0001 item 2's measurement that a branch domain resolves to the wrong
deployment, plus the plain fact that one generated `*.vercel.app` is all the site needs.
`packages/infra/global/__tests__/docsSiteDeployGuards.test.ts` asserts that the workflow never grows a
domain-attaching step, that the account-id scan gates the artifact, and that the post-deploy probe
demands a `200` carrying this site's own generator tag. The workflow's own header lists exactly what the
owner must create in Vercel and GitHub.

`DOCS_SITE_URL` supplies the site's canonical URL at build time; a local build has no deployment
identity and falls back to an unresolvable placeholder.

## The one rule

**No AUTHORED document is copied into this package.** The Docusaurus docs plugin mounts the real
directories, so a page on this site cannot drift from the file it renders. A second copy of an ADR is
the failure this repository keeps paying for.

⚠️ **The one exception, and why it is not that failure.** A `generated` section whose directory sits
inside another section's — which every one of them does, since the handbook mounts `docs` and the
generators write to `docs/generated/*` — is mounted from a gitignored build-time MIRROR under
`content/mirrored/`, refilled from scratch on every run. That is forced by Docusaurus:
`plugin-content-docs` builds its webpack rule from the content DIRECTORY, webpack applies every
matching rule, and two instances over nested trees therefore run both MDX loaders over the same file.
The build dies with `Can't resolve '@site/.docusaurus/…/handbook/…json'`, and `exclude:` does not fix
it — that option only feeds `isMDXPartial`, so the loader still runs and SSG fails one layer later
inside `DocItem`. The rule the mirror preserves is about DRIFT: an authored document's source of truth
is the file, so copying it forks the truth; a generated corpus's source of truth is its generator, so
a rebuilt mirror forks nothing. `contentRegistry.test.ts` asserts the no-nesting property against a
registry in which every generator has run, precisely because the placeholders hid this for weeks.

## The data contract for the generators

Three sections are **generated** by other tools. This site consumes them; it never writes them.

| Section        | Reads from                       | Route             |
| -------------- | -------------------------------- | ----------------- |
| Infrastructure | `docs/generated/infrastructure/` | `/infrastructure` |
| Components     | `docs/generated/components/`     | `/components`     |
| Design system  | `docs/generated/design/`         | `/design`         |

What a generator has to satisfy — and only this:

1. **Write at least one `.md` (or `.mdx`) file** anywhere under its directory, at any depth. That is
   the entire presence test. A directory holding only `manifest.json` counts as **not generated** — by
   design, because mounting it would produce a documentation section that documents nothing.
2. **Commit the output**, the way this repository commits every other generated artefact.
3. **Every internal Markdown link must resolve**, either to another document in the same directory or
   to a real file elsewhere in the repository. A link to a file that does not exist **fails the
   build** (`onBrokenLinks: 'throw'`); a link to a real repository file outside the published corpus
   is silently rewritten to a GitHub link (see `src/content/repositoryLinkFallback.ts`).
4. **`.md` is parsed as CommonMark, not MDX** (`markdown.format: 'md'`). Raw `<`, `{` and `${…}` are
   safe. JSX and expressions will not be evaluated — use `.mdx` if a page genuinely needs them.
5. **No index page is required.** Navigation is autogenerated from the directory tree, and the navbar
   link addresses the sidebar rather than a route, so it lands on whatever the first document is.
6. **Front matter is optional.** `title` and `sidebar_label` are honoured if present.

Nothing else is needed. The moment the directory holds Markdown, the placeholder disappears and the
real content is mounted at the same route — **no change to this package**.

### What the infrastructure generator additionally owes its readers

Its pages describe **what a commit declares**, never what is deployed. That distinction is the reason
the section exists, and the site can only carry it so far: the landing page and the footer state it,
and the placeholder states it, but once the real pages are mounted the site cannot inject a banner
into content it does not author. **The generator should state it on its own pages.**

## Degrading honestly

`src/content/` is the whole ingestion layer, and every rule in it is unit tested:

| Module                      | Responsibility                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `contentRegistry.ts`        | The one authoritative list of what the site is made of. Paths, routes, include allowlists.       |
| `resolveContentSources.ts`  | Pure policy: what a source's absence MEANS. Required ⇒ build failure. Generated ⇒ placeholder.   |
| `loadContentSources.ts`     | The filesystem adapter. The only I/O.                                                            |
| `docsPluginOptions.ts`      | Registry value ⇒ Docusaurus plugin instance.                                                     |
| `navbarItems.ts`            | Registry value ⇒ navbar.                                                                         |
| `repositoryLinkFallback.ts` | Pure policy: a link out of the corpus becomes a repository link; a link to nothing stays broken. |

The two absences are treated differently on purpose. A missing **required** source (someone moved the
ADRs) is a regression and throws. A missing **generated** source is an ordinary state and mounts a
placeholder — so the route still exists, the navbar link still works, and the page says what is
missing and where it will land. Nothing is ever fabricated to fill a gap.

## Adding a content source

Add an entry to `CONTENT_SOURCES` in `src/content/contentRegistry.ts`. That is the whole change; the
plugin instance, the navbar entry and the sidebar all derive from it. A `generated` entry also needs a
placeholder directory with one Markdown file in it — `contentRegistry.test.ts` fails if you forget.

`include` is an **allowlist**, deliberately, not an `exclude` blocklist. `docs/` also holds working
material (reviews, plans, brainstorms, reports, competitive analyses) which is correspondence rather
than documentation. A blocklist would admit the next working directory somebody adds; an allowlist
admits nothing by accident, and the guard tier fails the build if any single glob stops reaching files.

## Localization — an explicit call

**This site is not localized, and deliberately is not wired into the product's localization path.**

The repository's rule that user-facing strings go through localization is about **product UI**. This
is internal developer documentation whose entire corpus — 31 ADRs, the coding standards, the
engineering quality bar, the runbooks — is English prose that no one is going to translate. Routing
half a dozen navbar labels through `@commise/i18n` while the documents themselves stay English would
be the appearance of compliance rather than the substance of it, and it would couple a build tool to
the product's i18n package for no reader's benefit.

Docusaurus's own i18n is configured with a single `en` locale, so adding a second is a config change
rather than a rewrite if that ever becomes wanted.

## Known friction

- **`npm run boundaries` reports phantom undeclared dependencies after a local build.** `turbo
boundaries` walks the package directory including gitignored output, and `.docusaurus/` is thousands
  of generated modules. Run `git clean -Xdf` first. Do **not** declare or baseline them. CI on a clean
  checkout is unaffected. (`scripts/boundariesRatchet.mjs` documents this.)
- **This package has no `"type": "module"`, and that is not an oversight.** Docusaurus emits a
  CommonJS server bundle and evaluates it during SSR; with `"type": "module"` the build dies on
  `require.resolveWeak is not a function` **after** webpack reports both compilations green. Measured,
  not guessed. Two consequences follow: `eslint.config.mjs` carries its extension, and `tsconfig.json`
  overrides `module` to `Preserve` so the type-checker agrees with how these files are actually
  evaluated (vitest and Docusaurus both load them as ESM).
- **Vitest warns that `vitest.config.ts` uses ESM syntax in a CommonJS file.** Cosmetic — vitest
  transpiles it. The file must keep the `.ts` extension because
  `packages/infra/global/__tests__/vitestTempRoot.test.ts` globs `vitest*.config.ts` and would go
  blind to any other one.
- **The build script is `docs:build`, not `build`.** That keeps Docusaurus out of `turbo run build`,
  so `npm run build` at the repo root costs exactly what it did before this package existed.
