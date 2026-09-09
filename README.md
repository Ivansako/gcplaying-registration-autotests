# Automation Client QA

Playwright + TypeScript end-to-end test automation, with Allure reporting.
This repository is **not** a single test suite for one site — it covers
**three separate brands**, each with its own scope, page objects, and CI
entry point:

| Brand | Site | What's covered |
|---|---|---|
| **GCPlaying** | gcplaying0175.com | Registration, login, full authenticated account area, cashier, content/legal/provider pages, casino UI extras |
| **Wildies** | beta.wildies.com | Full i18n / translation coverage across 10 locales |
| **Spinoloco** | spinoloco7545.com | Provider Launch QA — thumbnails, categories, game launch, real-money min-bet spins |

Each brand has its own Playwright config, its own `allure-results-*` /
`allure-report-*` output directory, and its own case in the shared GitHub
Actions workflow — they never mix results with each other.

## Setup

```bash
npm install
npx playwright install --with-deps chromium firefox
```

## Repository structure

```
playwright.config.ts             — GCPlaying config (default)
playwright.wildies.config.ts     — Wildies config (its own account pool / locales)
playwright.spinoloco.config.ts   — Spinoloco config (its own accounts / sharding)

pages/
  RegistrationPage.ts            — GCPlaying signup/login modal
  AccountPage.ts                 — GCPlaying authenticated account area (cashier, profile, favorites, verification)
  BrandContentPage.ts            — GCPlaying public content/legal/provider pages, search, side menu, language switch
  WildiesPage.ts                 — Wildies-wide page object (navigation, locale handling, account menu, screenshots, sportsbook)
  SpinolocoPage.ts               — Spinoloco catalog, pagination, game launch, categories

tests/
  registration.spec.ts                    — GCPlaying: sign up form validation + real registration
  brand-gcplaying.spec.ts                 — GCPlaying: full brand test (register + log back in)
  authenticated-user.spec.ts              — GCPlaying: log in and inspect the authenticated session
  authenticated-account.spec.ts           — GCPlaying: header, nav, account menu, favorites, real spin
  authenticated-profile.spec.ts           — GCPlaying: cashier, password, personal details, address, verification
  brand-content-pages.spec.ts             — GCPlaying: public content pages
  brand-legal-pages.spec.ts               — GCPlaying: footer / legal pages
  brand-providers.spec.ts                 — GCPlaying: provider pages
  brand-casino-ui.spec.ts                 — GCPlaying: search, side menu, language switcher, footer payment logos
  forgot-password.spec.ts                 — GCPlaying: forgot-password flow
  game-providers.spec.ts                  — GCPlaying: game provider connectivity check
  wildies-localizations.spec.ts           — Wildies: locale switching (URL + sidebar dropdown)
  wildies-translation-coverage.spec.ts    — Wildies: full translation coverage, every page × every locale
  spinoloco-thumbnails-categories.spec.ts — Spinoloco: thumbnail + category checks (full catalog)
  spinoloco-game-launch.spec.ts           — Spinoloco: every game opens with no tech error (sharded)
  spinoloco-real-bet.spec.ts              — Spinoloco: one real minimum-bet spin per provider

utils/                             — shared helpers (test data, locale lists, account pools, catalog scraping, issue tracking)
scripts/                           — report post-processing, result cleanup, local runner UI
hosted/server.js                   — public "Run tests" button (see below)
```

## Brand 1 — GCPlaying (gcplaying0175.com)

### How the signup form works (verified live 2026-08-24)

Registration opens as a modal (`data-testid="signup-popup"`) via the
**Register** button in the header (only visible for an anonymous session —
a logged-in browser shows balance + "Log out" instead).

Form fields: Currency (USD/EUR, default USD), Country (default United Arab
Emirates), Code — phone country code (default +971), Phone, Email,
Password. **There is no password-confirmation field and no Terms
checkbox** — agreement to Terms & Conditions and 18+ is implied by linked
text under the submit button. No CAPTCHA (reCAPTCHA/hCaptcha/Turnstile)
was found in the form markup.

Validation is fully client-side: the **Sign up** button has a native
`disabled` attribute that only clears once every field is valid. Password
strength is checked live against a 5-item checklist ("Between 8-30
characters", "At least one number", "No spaces", "At least one lowercase",
"At least one capital") — each item is highlighted ✓/✗ as you type via
`WizPasswordHints_true__*` / `WizPasswordHints_false__*` CSS classes.

### Scope

- Registration form validation (empty/invalid email, phone, password —
  all negative paths) plus one real successful registration and one real
  duplicate-email attempt (`registration.spec.ts`).
- Full brand smoke: register, then log back in (`brand-gcplaying.spec.ts`).
- Authenticated account area: header (balance/deposit/notifications/menu),
  main navigation, account menu sections, Favorites toggle, 5 games
  reaching a playable state, one real spin that decreases balance
  (`authenticated-account.spec.ts`).
- Cashier, password change, Personal Details (edit/cancel, DOB picker,
  communication language, a confirmed real bug on save-with-no-changes),
  address update, verification page, Refer a Friend
  (`authenticated-profile.spec.ts`).
- Public content pages, legal/footer pages, provider pages, forgot
  password flow (`brand-content-pages.spec.ts`,
  `brand-legal-pages.spec.ts`, `brand-providers.spec.ts`,
  `forgot-password.spec.ts`).
- Casino UI extras: game search, side menu nav items, language switcher
  (with RTL check), footer payment method logos
  (`brand-casino-ui.spec.ts`).
- Game provider connectivity — 36 of 51 providers checked as of
  2026-08-25 (`game-providers.spec.ts`).

### Known limitations

Two things were verified logically rather than live, to avoid creating
extra accounts on production during form recon — re-check on first real
run (marked with `TODO` comments in the code):

1. **Success screen** (`RegistrationPage.expectSuccess`) — currently
   checked as modal closing + "Log out" or "Deposit" appearing. If a real
   registration shows a welcome/bonus modal instead, update this method.
2. **Duplicate-email message** — the `@duplicate` test currently only
   checks that the modal does NOT close (i.e. no success), not the exact
   error text. If the server shows something like "Email already exists",
   add an exact text assertion in `tests/registration.spec.ts`.

## Brand 2 — Wildies (beta.wildies.com)

612-test i18n/translation coverage suite across **10 live locales**
(English, Nederlands, Français, Italiano, Português, Ελληνικά, Deutsch,
Suomi, Español, Svenska). Covers every anonymous page, the Sportsbook
Lobby (odds widget iframe), Promotions, Tournaments, Login/Sign Up,
Forgot Password, duplicate-email registration, the 404/error boundary,
the account avatar dropdown, every authenticated account page, Cashier
(UI-only), Game History, Sportsbook My Bets, and Gamification — desktop
and mobile viewports.

Real money is spent **once per full run**: one minimum-bet slot spin +
one minimum-stake sportsbook bet on a dedicated seed account. A pool of
other funded accounts round-robins through every other authenticated
check.

Confirmed baseline (2026-09-08 full run, 2.9h): 576 passed / 36 failed —
remaining failures are a handful of known, already-triaged findings (an
untranslated `notification.loginError` i18n key on 5 locales, a
mobile-only Sportsbook widget/bottom-nav overlap that's a confirmed
real site bug and explicitly out of this suite's scope, and a couple of
Tournament "More info" button failures), not test flakiness.

Run locally:

```bash
npm run test:wildies:full   # clean previous results, then run
npm run report:wildies      # generate + open the Allure report
```

## Brand 3 — Spinoloco (spinoloco7545.com)

Provider Launch QA suite, 4 checks:

1. **Thumbnails** — every Casino/Live Casino game has a real image.
2. **Game launch** — every game opens with no tech error. The catalog is
   huge (4000+ Slots alone), so this check is sharded by calendar day
   rather than covering everything in one run.
3. **Real minimum-bet spin** — one per provider (67 providers total),
   using manually-investigated per-provider click coordinates (each
   provider's game engine renders in an opaque canvas inside a
   cross-origin iframe, so there's no generic "click here" that works
   across engines).
4. **Categories** — every game is filed under at least one thematic
   category.

This suite is red-or-green only (no orange "broken" findings) — a bad
thumbnail/launch/category IS the exact thing each check exists to catch,
so it fails the test directly rather than being logged as an incidental
finding.

Locale is 100% server-enforced by geo-IP on this site, so every selector
is written locale-independently (no hardcoded English/Polish/Italian
text).

Run locally:

```bash
npm run test:spinoloco
npm run report:spinoloco
```

## Running tests (GCPlaying, default config)

```bash
npm test                 # all browsers (chromium, firefox, mobile-chrome)
npx playwright test --project=chromium
npm run test:headed      # with a visible browser
npm run test:debug       # step-by-step debugging
npx playwright test -g "Successful registration"   # a specific test
```

Override the target site (e.g. for staging):

```bash
BASE_URL=https://staging.gcplaying0175.com/ npm test
```

⚠️ The `@positive` and `@duplicate` tests perform a real registration
form submission. Run them against a test environment/test emails
(mailinator.com), or exclude them on production:

```bash
npx playwright test --grep-invert "@positive|@duplicate"
```

## Allure reports

Each brand writes to its own results directory
(`allure-results` / `allure-results-wildies` / `allure-results-spinoloco`)
via `allure-playwright`.

```bash
npm run report              # GCPlaying
npm run report:wildies      # Wildies
npm run report:spinoloco    # Spinoloco
```

## Running via GitHub Actions

Repository: https://bitbucket.org/aloplay/automation-client-qa (mirrored
from https://github.com/Ivansako/gcplaying-registration-autotests, which
also carries the GitHub Actions workflow).

1. Open the **Actions** tab → workflow **"Run autotests"**.
2. Click **Run workflow** and choose:
   - `spec` — which suite to run: `registration` / `brand-gcplaying` /
     `authenticated-account` / `game-providers` / `wildies-i18n` /
     `spinoloco-provider-launch` / `all`;
   - `include_form_submitting` — whether to include `@positive`/
     `@duplicate` (creates a real account on the target site — off by
     default);
   - `base_url` — optional override (e.g. a staging URL).
3. Once the run finishes, open the run itself → **Artifacts** section →
   download `allure-report`, unzip it, and open `index.html` locally.

⚠️ GitHub Pages isn't available for private repos on the free tier, so
the report is published as a downloadable artifact rather than a
permanent link. On GitHub Pro/Team/Enterprise this can switch to Pages
for one stable URL for the whole team.

To give teammates access to the repository, add them under
**Settings → Collaborators and teams**.

## Hosted "Run tests" button

`hosted/server.js` is a small Node HTTP server deployed on Render
(`gcplaying-registration-autotests.onrender.com`). It dispatches the same
`.github/workflows/tests.yml` via `workflow_dispatch`, polls run status
with a progress bar + ETA, and serves the resulting Allure report at
`/report` — no need to touch the Actions tab or download artifacts
manually. Auto-deploys on every push to `master`.

Categories in the dropdown: Development, Product, Localization, Payments,
Provider Launch, Brand Launch, Legal Check, All suites.

Note: the underlying GitHub token only has `Actions: Read and write`
scope — it can dispatch/poll/cancel runs but cannot read or write
repository Secrets. Adding/checking GitHub Secrets always has to be done
manually via the repo's **Settings → Secrets** UI.
