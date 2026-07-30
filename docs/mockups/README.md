# Commise — Figma Make Mockup Archive

Archive of the Figma Make-generated site for offline reference and design token extraction.

## Files

| File                   | Purpose                                                   | Size     |
| ---------------------- | --------------------------------------------------------- | -------- |
| `index.html`           | Entry point (requires JS runtime)                         | 68 lines |
| `_runtimes/*.js`       | Figma Sites runtime (JS execution engine)                 | 1.1 MB   |
| `_components/v2/*.js`  | Component bundle (React/Tailwind compiled)                | 211 KB   |
| `_components/v2/*.css` | All styles, design tokens, Tailwind classes               | 141 KB   |
| `_json/**/*.json`      | Page data / node tree (very small — rendered server-side) | ~2.5 KB  |

## How to View

Since this is a **JavaScript-rendered** Figma Make site (not static HTML), you must serve it from a local web server:

```bash
cd docs/mockups
python3 -m http.server 8080
# Then open http://localhost:8080 in your browser
```

Or with Node:

```bash
npx serve . -p 8080
```

Or with PHP:

```bash
php -S localhost:8080
```

**Do NOT** open `index.html` directly via `file://` — the JS runtime requires a real HTTP origin.

## Design Tokens Extracted

### Color Palette

Values below are the SHIPPED `@commise/ui` tokens, and the archive is held to them by a test
(`packages/tools/test-utils/src/__tests__/mockupContrast.test.ts`) — see
"Accessibility corrections applied to this archive" below.

| Token                   | Hex       | Name               | Label it carries as a fill               |
| ----------------------- | --------- | ------------------ | ---------------------------------------- |
| `--color-seafoam`       | `#31807A` | Primary dark       | `white` (4.67:1)                         |
| `--color-seafoam-light` | `#5BA8A0` | Primary            | accent only — never a fill under a label |
| `--color-coral`         | `#E8917A` | Accent/secondary   | `charcoal` (5.29:1)                      |
| `--color-sand`          | `#FAF6F0` | Background         | surface                                  |
| `--color-sky`           | `#8ECAE6` | Tertiary accent    | `charcoal` (7.09:1)                      |
| `--color-white`         | `#FFFFFF` | Surface            | surface                                  |
| `--color-charcoal`      | `#2D3436` | Text primary       | `white` (12.68:1)                        |
| `--color-slate`         | `#636E72` | Text secondary     | —                                        |
| `--color-mist`          | `#B2BEC3` | Borders/dividers   | hairline only — never text               |
| `--color-pearl`         | `#F5F5F5` | Muted backgrounds  | surface                                  |
| `--color-ocean-dark`    | `#2A6B65` | Teal TEXT on light | `white` (6.20:1)                         |
| `--color-success`       | `#4CAF7C` | Success            | `charcoal` (4.67:1)                      |
| `--color-warning`       | `#F5B041` | Warning            | `charcoal` (6.74:1)                      |
| `--color-error`         | `#C05238` | Error FILL         | `white` (4.66:1)                         |
| `--color-error-dark`    | `#B1442B` | Error TEXT         | `white` (5.63:1)                         |
| `--color-premium`       | `#D4A574` | Premium/gold       | `charcoal` (5.70:1)                      |

### Semantic Colors

| Token           | Value                      |
| --------------- | -------------------------- |
| `--background`  | `#FAF6F0`                  |
| `--foreground`  | `#2D3436`                  |
| `--card`        | `#FFFFFF`                  |
| `--primary`     | `#5BA8A0`                  |
| `--secondary`   | `#E8917A`                  |
| `--muted`       | `#F5F5F5`                  |
| `--accent`      | `#8ECAE6`                  |
| `--destructive` | `#C05238`                  |
| `--border`      | `rgba(178, 190, 195, 0.3)` |
| `--ring`        | `#5BA8A0`                  |

### Typography Scale

| Token               | Size      | Line Height |
| ------------------- | --------- | ----------- |
| `--text-display-xl` | 3rem      | 1.2         |
| `--text-display-lg` | 2.25rem   | 1.2         |
| `--text-display-md` | 1.75rem   | 1.2         |
| `--text-heading-lg` | 1.5rem    | 1.2         |
| `--text-heading-md` | 1.25rem   | 1.2         |
| `--text-heading-sm` | 1.125rem  | 1.2         |
| `--text-body-lg`    | 1.125rem  | 1.5         |
| `--text-body-md`    | 1rem      | 1.5         |
| `--text-body-sm`    | 0.875rem  | 1.5         |
| `--text-caption`    | 0.75rem   | 1.4         |
| `--text-overline`   | 0.6875rem | 1.4         |

### Font Families

- **Playfair Display**: Headings, display text (imported from Google Fonts)
- **Inter**: Body text, UI (imported from Google Fonts)
- **JetBrains Mono**: Code, data, monospace (imported from Google Fonts)

### Spacing Scale (Base 8px)

| Token       | Value          |
| ----------- | -------------- |
| `--space-1` | 0.25rem (4px)  |
| `--space-2` | 0.5rem (8px)   |
| `--space-3` | 0.75rem (12px) |
| `--space-4` | 1rem (16px)    |
| `--space-5` | 1.5rem (24px)  |
| `--space-6` | 2rem (32px)    |
| `--space-7` | 3rem (48px)    |
| `--space-8` | 4rem (64px)    |
| `--space-9` | 6rem (96px)    |

### Border Radius

| Token           | Value    |
| --------------- | -------- |
| `--radius-sm`   | 0.375rem |
| `--radius-md`   | 0.75rem  |
| `--radius-lg`   | 1.25rem  |
| `--radius-xl`   | 1.75rem  |
| `--radius-full` | 9999px   |

### Shadows

| Token           | Value                                  |
| --------------- | -------------------------------------- |
| `--shadow-sm`   | `0 1px 3px rgba(45,52,54,0.04)`        |
| `--shadow-md`   | `0 4px 6px -1px rgba(45,52,54,0.07)`   |
| `--shadow-lg`   | `0 10px 15px -3px rgba(45,52,54,0.08)` |
| `--shadow-xl`   | `0 20px 25px -5px rgba(45,52,54,0.09)` |
| `--shadow-glow` | `0 0 32px rgba(49,128,122,0.25)`       |

### Gradients

| Token                   | Value                                                |
| ----------------------- | ---------------------------------------------------- |
| `--gradient-beach-glow` | `linear-gradient(135deg, #FAF6F0, #F0F7F4, #E8F4F8)` |

### Chart Colors

| Token              | Value     |
| ------------------ | --------- |
| `--chart-calories` | `#31807A` |
| `--chart-protein`  | `#F5B041` |
| `--chart-carbs`    | `#8ECAE6` |
| `--chart-fat`      | `#E8917A` |
| `--chart-fiber`    | `#4CAF7C` |

`calories` and `protein` were both `#5BA8A0` in the original export — two series rendering as one
indistinguishable line (defect B25a). Each series now gets a distinct hue, matching `chart` in
`@commise/ui/src/tokens/colors.ts`.

## Accessibility corrections applied to this archive

This archive is the visual contract for feature 001, which makes it a **regression generator** when it drifts
from the shipped design system: a later "match the mockups" pass faithfully re-introduces whatever the product
just fixed, with the design docs as justification. So the archive is not frozen at what Figma Make exported —
it is kept in step with `@commise/ui`, and a test
(`packages/tools/test-utils/src/__tests__/mockupContrast.test.ts`) fails the build when the two disagree or
when any accent fill/label pair drops below WCAG 2.1 AA.

Changes made to the original export, **colour and label-class only** (no layout, copy or structure):

| What                                       | Original       | Now                  | Why                                                                     |
| ------------------------------------------ | -------------- | -------------------- | ----------------------------------------------------------------------- |
| `--color-seafoam`                          | `#3D8B85`      | `#31807A`            | white-on-seafoam was 4.02:1 (#113)                                      |
| `--color-error`                            | `#E17055`      | `#C05238`            | white-on-error was 3.16:1; `--color-error-dark` added for the text role |
| `text-white` on `bg-coral`                 | white          | `text-charcoal`      | 2.40:1 → 5.29:1                                                         |
| `text-white` on `bg-premium`               | white          | `text-charcoal`      | 2.23:1 → 5.70:1                                                         |
| `text-white` on `bg-success`               | white          | `text-charcoal`      | 2.72:1 → 4.67:1                                                         |
| `text-white` icon on `bg-warning`          | white          | `text-charcoal`      | 1.88:1 → 6.74:1 (SC 1.4.11)                                             |
| `text-white` icon on `bg-sky`              | white          | `text-charcoal`      | 1.79:1 → 7.09:1 (SC 1.4.11)                                             |
| `text-white/90` on `bg-seafoam`            | 90% white      | `text-white`         | 4.11:1 → 4.67:1                                                         |
| cook mode `text-seafoam` on `bg-charcoal`  | seafoam        | `text-seafoam-light` | 2.72:1 → 4.56:1                                                         |
| cook mode `text-slate` on `bg-charcoal`    | slate          | `text-mist`          | 2.42:1 → 6.67:1                                                         |
| cook mode `text-charcoal` on `bg-charcoal` | charcoal       | `text-white`         | 1.00:1 → 12.68:1                                                        |
| `--chart-calories` / `--chart-protein`     | both `#5BA8A0` | distinct hues        | two series rendered as one (B25a)                                       |

`text-white` is KEPT on `bg-seafoam`, `bg-error` and `bg-charcoal` — those three fills carry a white label by
design, and the token moves above are what make them legible.

## Known Limitations

- **No server-side rendering**: The JSON data is minimal (~2.5 KB). Most content is rendered client-side by the Figma Sites runtime.
- **Fonts loaded from CDN**: The CSS imports Google Fonts. For 100% offline use, download the fonts locally.
- **Not modifiable**: This is a compiled artifact from Figma Make, not a source design file. For edits, return to Figma Make and re-export.

## Screenshot

Since the site requires JavaScript to render, no static screenshot was captured here. Use `npx playwright screenshot http://localhost:8080 mockup.png` to capture one.

## Source

- **Original URL**: https://jazz-spec-04687086.figma.site
- **Figma Make File**: https://www.figma.com/make/hK2jtHo5Pdrk55l4goBacx/Design-System-and-Mockups?t=3bRqlQNHJ5ly41km-1
- **Scraped on**: June 1, 2026
- **Runtime**: Figma Sites (sites-runtime) + Components v2
