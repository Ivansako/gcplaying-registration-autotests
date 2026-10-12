# Automation Client QA

Playwright + TypeScript end-to-end test automation with Allure reporting,
maintained by the Aloplay QA team. One repository, **six brands** — each
with its own Playwright config, page object(s), test specs and
`allure-results-*` / `allure-report-*` directories, so results never mix.

| Brand | Site | Suite type | Config | Status |
|---|---|---|---|---|
| **GCPlaying** | gcplaying0175.com | Full regression: registration, login, account area, cashier, content/legal/provider pages | `playwright.config.ts` (default) | Stable |
| **Wildies** | beta.wildies.com | i18n / translation coverage, 9 locales, desktop + mobile | `playwright.wildies.config.ts` | Stable (local runs) |
| **FerraPlay** | ferraplay.com | i18n / translation coverage, 8 locales, desktop + mobile (BQA-461) | `playwright.ferraplay.config.ts` | Active development |
| **Spinoloco** | spinoloco7545.com | Provider Launch QA: thumbnails, launch, real min-bet, categories | `playwright.spinoloco.config.ts` | Stable |
| **ShelbySpin** | shelbyspin3322.com | Provider language audit (Dutch, `nl`) — discovery report, not a gate | `playwright.shelbyspin.config.ts` | New (2026-10-08) |
| **Spinoloco345** | spinoloco345.com | Provider language audit (Portuguese, `pt`) — discovery report, not a gate | `playwright.spinoloco345.config.ts` | New (2026-10-08) |

## Repositories

- **GitHub (primary):** https://github.com/Ivansako/gcplaying-registration-autotests
  — all development happens here; GitHub Actions and the hosted run
  button live here.
- **Bitbucket (mirror):** https://bitbucket.org/aloplay/automation-client-qa
  — company copy in the Aloplay workspace (QA project). Not synced
  automatically: after pushing to GitHub, also push to Bitbucket:

  ```bash
  git remote add bitbucket https://bitbucket.org/aloplay/automation-client-qa.git   # once
  git push bitbucket master
  ```

## Setup

```bash
npm install
npx playwright install --with-deps chromium firefox
cp .env.example .env   # then fill in the real test-account credentials
```

All credentials (test accounts, Cloudflare Access tokens) come from
environment variables — locally from `.env` (gitignored), in CI from
GitHub Secrets. **Never commit real credentials.**

## Repository structure

```
playwright.config.ts                — GCPlaying (default config)
playwright.wildies.config.ts        — Wildies
playwright.ferraplay.config.ts      — FerraPlay
playwright.spinoloco.config.ts      — Spinoloco
playwright.shelbyspin.config.ts     — ShelbySpin
playwright.spinoloco345.config.ts   — Spinoloco345

pages/                              — page objects, one or more per brand
  RegistrationPage.ts, AccountPage.ts, BrandContentPage.ts   (GCPlaying)
  WildiesPage.ts, FerraPlayPage.ts, SpinolocoPage.ts,
  ShelbySpinPage.ts, Spinoloco345Page.ts

tests/                              — specs, prefixed by brand (see each brand below)
utils/                              — test data, locale lists, account pools,
                                      catalog scraping, issue analysis, language heuristic
scripts/                            — report post-processing, result cleanup,
                                      language reports, diagnostics, local runner UI
hosted/server.js                    — public "Run tests" button (Render)
.github/workflows/                  — GitHub Actions (main suite + diagnostics)
bitbucket-pipelines.yml             — Bitbucket diagnostic probe (see CI section)
```

## Brand 1 — GCPlaying (gcplaying0175.com)

| Spec | What it covers |
|---|---|
| `registration.spec.ts` | Sign-up form validation (email, phone, password rules) + one real registration and one duplicate-email attempt |
| `brand-gcplaying.spec.ts` | Full brand smoke: register, then log back in |
| `authenticated-user.spec.ts` | Log in with an existing test account |
| `authenticated-account.spec.ts` | Header, navigation, account menu, Favorites, games reaching playable state, one real spin |
| `authenticated-profile.spec.ts` | Cashier, password change, Personal Details, address, verification, Refer a Friend |
| `brand-content-pages.spec.ts` / `brand-legal-pages.spec.ts` / `brand-providers.spec.ts` | Public content, footer/legal and provider pages |
| `brand-casino-ui.spec.ts` | Game search, side menu, language switcher (incl. RTL), footer payment logos |
| `forgot-password.spec.ts` | Forgot-password flow |
| `game-providers.spec.ts` | Game provider connectivity |

How the signup form works (verified live 2026-08-24): a modal
(`data-testid="signup-popup"`) opened by **Register** in the header.
Fields: Currency, Country, phone code, Phone, Email, Password. No
password confirmation, no Terms checkbox, no CAPTCHA. The **Sign up**
button stays `disabled` until every field is valid; the password is
checked live against a 5-item checklist.

**Open items** (marked `TODO` in the code):

1. `RegistrationPage.expectSuccess()` checks "modal closes + Log out or
   Deposit appears" — not yet confirmed against the real post-signup UI.
2. The `@duplicate` test only checks that the modal stays open, not the
   exact error text.

⚠️ `@positive` and `@duplicate` create real accounts on production.
Exclude them with `--grep-invert "@positive|@duplicate"`.

```bash
npm test                                   # chromium, firefox, mobile-chrome
npx playwright test --project=chromium
BASE_URL=https://staging.example.com/ npm test   # override target
npm run report
```

## Brand 2 — Wildies (beta.wildies.com)

Translation-coverage suite across **9 locales** (English, Nederlands,
Français, Italiano, Português, Ελληνικά, Suomi, Español, Svenska —
Deutsch removed 2026-10-06). Covers every anonymous page, Sportsbook
Lobby, Promotions, Tournaments, Login/Sign Up, Forgot Password,
duplicate-email registration, 404, account menu, every authenticated
page, Cashier (UI only), Game History, Sportsbook My Bets and
Gamification, on desktop and mobile. Red-or-green only.

Real money: **one** minimum-bet slot spin + **one** minimum-stake
sportsbook bet per full run, on a dedicated seed account; every other
authenticated check rotates through an account pool.

Last full baseline (2026-09-08, 10 locales at the time): 576 passed /
36 failed — the failures are known, triaged site bugs (untranslated
`notification.loginError` key, mobile Sportsbook/bottom-nav overlap,
Tournament "More info" buttons), not flakiness.

```bash
npm run test:wildies:full   # clean old results, then run
npm run report:wildies
```

## Brand 3 — FerraPlay (ferraplay.com)

Port of the Wildies i18n architecture (same underlying platform),
scoped by **BQA-461**. **8 locales**: English, Italiano, Português,
Ελληνικά, Español, Polski, Magyar, Français (Nederlands excluded on
request).

- `ferraplay-localizations.spec.ts` — locale switching mechanics (URL,
  dropdown, `<html lang>`, language persistence).
- `ferraplay-translation-coverage.spec.ts` — anonymous + authenticated
  pages, promotion/tournament detail pages in every locale, Gamification,
  per-page English-fallback baselines.
- One real seed spin per run; 3 funded test accounts in a pool.
- Out of scope: Sportsbook (the brand will not ship one).
- Findings so far: "TOP GAMES" header untranslated on IT/PT; the
  Responsible Gambling page says "Shelbyspin" instead of "FerraPlay" in
  every locale.
- Tooling: `scripts/ferraplay-locale-audit/` (capture + analyze),
  `scripts/ferraplay-game-scout.js`, `scripts/ferraplay-secrets-check.js`.

```bash
npm run test:ferraplay:full
npm run report:ferraplay
```

## Brand 4 — Spinoloco (spinoloco7545.com)

Provider Launch QA, 4 checks:

1. **Thumbnails** — every Casino / Live Casino game has a real image.
2. **Game launch** — every game opens with no tech error; sampled per
   provider (5 games each).
3. **Real minimum-bet spin** — one per provider (~32 providers), using
   per-provider click coordinates (`utils/spinolocoBetCoordinates.ts`)
   since game engines render in cross-origin canvases.
4. **Categories** — every game sits in at least one thematic category.

Red-or-green only. Locale is geo-IP enforced, so selectors are
locale-independent.

```bash
npm run test:spinoloco
npm run report:spinoloco
```

## Brands 5 & 6 — ShelbySpin and Spinoloco345 (provider language audits)

Discovery suites, **not** pass/fail gates: open one representative game
per provider in the target language and record which providers still
launch in English, to hand that list to the providers.

| | ShelbySpin | Spinoloco345 |
|---|---|---|
| Target language | Dutch (`nl`) | Portuguese (`pt`) |
| How the locale is set | Site's own sidebar language switcher — **no VPN** (an NL IP triggers a regulatory game block) | Geo-IP only, no switcher; the run fails fast if the network doesn't resolve to `pt` |
| Spec | `shelbyspin-provider-localization.spec.ts` | `spinoloco345-provider-localization.spec.ts` |
| Output | `shelbyspin-dutch-localization-report.json` + `shelbyspin-screenshots/` | `spinoloco345-pt-localization-report.json` + `spinoloco345-screenshots/` |
| Credentials | `SHELBYSPIN_TEST_USER_EMAIL` / `_PASSWORD` | `SPINOLOCO345_TEST_USER_EMAIL` / `_PASSWORD` |

Language is detected from the game frame's URL parameters
(`utils/gameLanguageHeuristic.ts`); a screenshot is always attached for
manual review when no parameter is found.

```bash
npm run test:shelbyspin:full && npm run report:shelbyspin:language
npm run test:spinoloco345:full && npm run report:spinoloco345:language
```

The `report:*:language` scripts turn the JSON into a Markdown table
ready to send to providers.

## Allure reports

Every brand has `npm run report:<brand>` (generate + open). GCPlaying
uses the plain `npm run report`. Post-processing scripts
(`promote-broken-steps.js`, `wildies-no-broken.js`) map findings to
Allure's red/orange statuses.

## CI

### GitHub Actions

Workflow **"Run autotests"** (`.github/workflows/tests.yml`), manual
`workflow_dispatch` with inputs:

- `spec`: `registration` / `brand-gcplaying` / `authenticated-account` /
  `game-providers` / `wildies-i18n` / `ferraplay-i18n` /
  `spinoloco-provider-launch` / `all`
- `include_form_submitting` — include `@positive` / `@duplicate` (off by default)
- `base_url` — optional override

The Allure report is uploaded as a run artifact. ShelbySpin and
Spinoloco345 are not wired into CI yet (local runs only).

Diagnostic workflows: `cf-access-probe.yml`,
`wildies-header-diagnostic.yml`, `ferraplay-secrets-check.yml`.

**Known issue:** GitHub-hosted runners' IPs are geo-blocked by Wildies
(and likely FerraPlay), so those suites currently run locally.

### Bitbucket Pipelines

`bitbucket-pipelines.yml` contains only a reachability probe: it
screenshots beta.wildies.com from a Bitbucket runner to check whether
Bitbucket's IP range avoids the geo-block. If it does, Bitbucket could
become the CI path for Wildies/FerraPlay. Requires repository variables
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`.

### Hosted "Run tests" button

`hosted/server.js` — a small Node server on Render
(`gcplaying-registration-autotests.onrender.com`). Dispatches the same
GitHub workflow, shows progress with ETA, and serves the Allure report
at `/report`. Auto-deploys on every push to `master`. Its GitHub token
has `Actions: Read and write` only — Secrets must be managed manually in
the repo settings.

Locally, `npm run ui` starts an equivalent runner UI.
