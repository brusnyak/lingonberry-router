# Lingonberry Design & Style Guide

A portable, production-tested design system extracted from **ShipCheck** for building crisp, high-contrast, Day/Night/System developer tools and SaaS web apps across Lingonberry projects.

---

## 1. Visual Philosophy

- **Quiet Precision over Visual Noise**: Let whitespace, clean typography, and 1px hairline borders do the structural work. Avoid floating badges, heavy drop shadows, neon gradients, and cloned card grids.
- **60–30–10 Color Budget**:
  - **60% Neutral Canvas**: `bg-zinc-50` (Day) / `dark:bg-zinc-950` (Night)
  - **30% Structural Surfaces**: `bg-white` / `dark:bg-zinc-900/70` with `border-zinc-200 dark:border-zinc-800`
  - **10% High-Intent Accent**: Emerald (`emerald-600` / `dark:emerald-500`) reserved strictly for primary CTAs, active focus rings, and pass/verified states.
- **Zero-Slop Rules**:
  - **No static metadata pills**: Render timestamps, modes, counts, and statuses as plain text joined with typographic separators (`·`). Reserve pill/segmented styling strictly for clickable filter buttons.
  - **No decorative pulsing dots**: Never put `animate-pulse` status dots beside headings, logos, or footer text (only use motion when a live stream/scan is actively running).
  - **No thick left accent stripes**: Never use `border-l-4` or `border-l-2` colored callout bars; use subtle all-around 1px hairline borders instead.
  - **No mechanical prefixes**: Never prefix titles with `//`, `/* */`, `>_`, or `FEAT_01`. Use clean Title Case or quiet editorial numbering (`01. Validate & Crawl`).
  - **No cards inside cards**: Separate sub-sections inside a panel using `border-t` hairline dividers and vertical padding rather than nested bordered boxes.

---

## 2. Day / Night / Browser System Architecture

Always support **Day (`light`)**, **Night (`dark`)**, and **Browser System (`system`)** modes cleanly without contrast bugs or flash-of-wrong-theme.

### A. Tailwind v4 Variant (`src/index.css`)
Declare the class-based dark variant immediately below `@import "tailwindcss";`:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

And declare `color-scheme: light dark;` on `html` in `@layer base`.

### B. Anti-Flash Boot Script (`index.html`)
Place directly in `<head>` before mounting React, reading `<app>-theme` (`'light' | 'dark' | 'system'`):

```html
<script>
  (function () {
    try {
      var saved = localStorage.getItem('shipcheck-theme') || 'system';
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var isDark = saved === 'dark' || (saved === 'system' && prefersDark);
      document.documentElement.classList.toggle('dark', isDark);
    } catch (e) {}
  })();
</script>
```

### C. Body Surface Defaults
Pair `<body>` explicitly so SSR/initial paint matches:
```html
<body class="bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 antialiased selection:bg-emerald-500/20 selection:text-emerald-700 dark:selection:text-emerald-200">
```

### D. Surface & Text Pairing Table
Never rely on CSS `!important` inversion overrides. Always pair Day and Night tokens:

| Token Role | Day (`light`) | Night (`dark`) |
| :--- | :--- | :--- |
| App Canvas | `bg-zinc-50` | `dark:bg-zinc-950` |
| Primary Card / Ledger | `bg-white` | `dark:bg-zinc-900/70` |
| Recessed Code / Well | `bg-zinc-50` | `dark:bg-zinc-950` |
| Hairline Border | `border-zinc-200` | `dark:border-zinc-800` |
| Input Border | `border-zinc-300` | `dark:border-zinc-700` |
| Primary Heading / Text | `text-zinc-900` | `dark:text-zinc-50` / `dark:text-zinc-100` |
| Body Copy | `text-zinc-600` | `dark:text-zinc-400` |
| Muted Metadata | `text-zinc-500` | `dark:text-zinc-400` |
| Primary CTA Button | `bg-emerald-600 hover:bg-emerald-500 text-white` | same |
| Secondary Button | `border-zinc-300 bg-zinc-50 hover:bg-zinc-100 text-zinc-800` | `dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800 dark:text-zinc-200` |

### E. Semantic Accents (Always Paired With Label or Icon)
- **Pass / Healthy**: `text-emerald-700 dark:text-emerald-400`
- **Warning / Attention**: `text-amber-700 dark:text-amber-400`
- **Critical / Blocked**: `text-rose-700 dark:text-rose-400`
- **Info / Neutral Notice**: `text-sky-700 dark:text-sky-400`

---

## 3. Typography & Tabular Discipline (2 + 1 Font Rule)

Load via Google Fonts in `index.html` and map in `src/index.css` `@theme`:

- **Display / Headings (`h1–h4`)**: `Plus Jakarta Sans` (`font-semibold` / `font-bold`, `tracking-tight`, `text-wrap: balance` on hero headlines)
- **Body / UI Prose**: `DM Sans` (`14px–16px`, `leading-relaxed`)
- **Data / URLs / Code / Metrics**: `JetBrains Mono` paired with `font-variant-numeric: tabular-nums` (`font-mono tabular-nums`) so scores, HTTP codes, and relative timestamps align vertically without jitter.

---

## 4. Layout Proportions & Spacious Rhythm

- **Top Navigation Bar (`TopBar`)**:
  - Strictly one row (`h-18`), three zones separated by `gap-10`:
    1. Single clean text wordmark (`whitespace-nowrap shrink-0`, no subtitle chips).
    2. 3–5 single-line text links (`whitespace-nowrap shrink-0`, subtle `hover:underline underline-offset-4`).
    3. 1 primary auth/action control on the right.
- **Page Containers**:
  - Landing / Showcase views: `max-w-7xl mx-auto px-6 sm:px-10 py-14 sm:py-20 lg:py-24 space-y-24 lg:space-y-28`
  - Workspace / Report / Settings views: `max-w-6xl mx-auto px-6 sm:px-10 py-12 sm:py-16 space-y-10`
- **Asymmetric Hero Split**:
  - Use a `12`-column grid (`grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start`):
    - Left (`lg:col-span-7 space-y-8`): Clear headline, concise subcopy, unified command-bar form (`p-2 rounded-xl`, `h-12` input + primary button), and quiet single-line secondary links.
    - Right (`lg:col-span-5`): Crisp live ledger (`px-6 py-4` rows divided by `divide-y`).
- **Hairline Grid Instead of Cloned Cards**:
  - For 6 capabilities/features, render one unified container (`border-t border-l rounded-xl overflow-hidden`) with `p-7 sm:p-8 border-r border-b` cells rather than 6 separate floating shadowed cards.
- **Single-Line Controls**:
  - Every button, tab, and nav item uses `whitespace-nowrap shrink-0` so labels never wrap onto two lines.

---

## 5. Lingonberry Creator Signature & Footer Lockup

Every Lingonberry project footer uses a quiet single-row layout (`max-w-7xl mx-auto px-6 sm:px-10 py-10`) containing:
1. Brand + concise navigation links on the left.
2. Theme switcher (`Day | Night | System` segmented button group) + **Created by Lingonberry** signature lockup on the right.

### Signature Assets & Blend Rules
Store both signature assets under `/public/assets/aistudio/`:
- Day (black ink on white background): `/assets/aistudio/black_sign_90f7a0a1.png`
- Night (white ink on black background): `/assets/aistudio/white_sign_8726de1f.png`

Render them side-by-side with theme classes and blend modes so the paper background disappears seamlessly on both Day (`zinc-50`) and Night (`zinc-950`) canvases:

```tsx
<div className="flex items-center gap-2.5 pl-4 border-l border-zinc-200 dark:border-zinc-800">
  <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
    Created by <span className="font-medium text-zinc-800 dark:text-zinc-200">Lingonberry</span>
  </span>
  <img
    src="/assets/aistudio/black_sign_90f7a0a1.png"
    alt="Lingonberry creator signature"
    className="h-7 w-auto object-contain dark:hidden mix-blend-multiply select-none"
  />
  <img
    src="/assets/aistudio/white_sign_8726de1f.png"
    alt="Lingonberry creator signature"
    className="h-7 w-auto object-contain hidden dark:block mix-blend-screen select-none"
  />
</div>
```

---

## 6. Component & UX Patterns

- **Command-Bar Forms**: Place the icon, input, and submit CTA inside a single `focus-within:ring-2 focus-within:ring-emerald-500/40` container instead of stacking detached inputs and buttons.
- **Progressive Disclosure for Technical Config**: Lead with 1-command actions or plain-English workflows; tuck raw JSON configs behind a collapsed `<details>` accordion.
- **Image & Screenshot Resilience**: Always validate `data:image/` or `https://` URLs, set `referrerPolicy="no-referrer"`, keep interactive previews inside clean `aspect-video` frames, and offer a click-to-enlarge modal (`role="dialog"`) for detailed inspection.
- **State Completeness**: Every async list or report must render matching skeleton loaders, actionable empty states, and clear inline alerts (`role="alert"`).

---

## 7. Prompt Starter for New Lingonberry Projects

Copy this into any AI coding agent when bootstrapping a new Lingonberry app:

```text
Follow DESIGN_GUIDE.md strictly:
- Dual Day/Night/System theme via `@custom-variant dark` + anti-flash script + `ThemeProvider`.
- Zinc neutral canvas (`zinc-50` / `zinc-950`), single-elevation hairline surfaces (`zinc-200` / `zinc-800`), Emerald-600 primary CTAs only.
- Fonts: Plus Jakarta Sans (display), DM Sans (body), JetBrains Mono + `tabular-nums` (metrics/URLs/code).
- Generous breathing room (`max-w-7xl px-6 sm:px-10`, `gap-12 lg:gap-16`), zero static metadata pills, zero decorative pulsing dots, zero `//` headings, zero nested cards.
- Include the Day/Night/System switcher and adaptive Lingonberry signature lockup in the footer.
```
