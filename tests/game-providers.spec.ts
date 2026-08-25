import { test } from '@playwright/test';
import { allure } from 'allure-playwright';

/**
 * FerraPlay.com — game provider connectivity findings (2026-08-25).
 *
 * These are NOT live browser-automation tests. The site's games render
 * inside cross-origin canvas/WebGL iframes with no accessible DOM, so a
 * generic Playwright script cannot reliably drive every provider's
 * bespoke UI (confirmed by hands-on investigation across 6+ providers
 * before this pass — bet controls, spin triggers and intro-carousel
 * dismissal all differ per provider, sometimes per game). Instead, each
 * provider was checked interactively (real account, real balance, one
 * real spin at the lowest reachable bet per working provider) and the
 * observed result is recorded here as a Playwright + Allure test so it
 * shows up in the same reporting pipeline as the registration suite.
 *
 * Test outcome mirrors the real-world finding: providers where a spin
 * actually executed and the balance decreased are recorded as PASSED;
 * providers that failed to load or never accepted a spin are recorded
 * as FAILED, with the failure message carrying the full description of
 * what was observed and what to check manually.
 */

type Status = 'working' | 'broken' | 'live-casino';

interface ProviderResult {
  name: string;
  status: Status;
  tags: string[];
  description: string;
  reviewNote?: string;
}

const RESULTS: ProviderResult[] = [
  {
    name: 'Pragmatic Play',
    status: 'broken',
    tags: ['@auth-error'],
    description:
      'Game "Gates of Olympus" loads fully — assets, reels and the bet-configuration UI all render ' +
      'correctly, and the bet could be reduced to this game\'s minimum (€0.20, via Coin Value ' +
      '€0.01 × 20 units). However, triggering a spin (double-click on the spin control; a plain ' +
      'click did not register at all) does not execute a real-money round. Instead the game engine shows ' +
      'a "Please log in" message overlay, and the account balance is unchanged. The FerraPlay site itself ' +
      'shows the account as logged in (balance and profile menu visible in the header) at the exact same ' +
      'time, so this is not a real logout — it strongly points to a session/auth-token handshake issue ' +
      'between FerraPlay\'s backend and the Pragmatic Play RGS (remote game server): the game client is not ' +
      'receiving a valid/current auth token when it requests to place the bet.',
    reviewNote:
      'Check the game-launch token generation for the Pragmatic Play integration (token expiry/refresh ' +
      'logic), and check server-side logs for the specific bet-placement request that triggers this ' +
      '"please log in" response.',
  },
  {
    name: 'NetEnt',
    status: 'broken',
    tags: ['@system-error'],
    description:
      'Two different games tested ("Jack Hammer", "Dazzle Me Megaways") fail identically and immediately: ' +
      'the game area shows the literal untranslated text `game.page.systemError` instead of loading. The ' +
      'browser console confirms a compounding frontend bug: `MISSING_MESSAGE: game.page.systemError (en)` ' +
      '— the frontend has no translated string configured for this error key, so the raw key leaks to ' +
      'the user instead of a readable message. The existence of a dedicated systemError key implies the ' +
      'frontend anticipates a backend/game-launch failure and tries to show an error screen for it, meaning ' +
      'the real root cause is server-side (the NetEnt game-launch/session request is failing) and the ' +
      'missing translation is a secondary, cosmetic bug on top of it.',
    reviewNote:
      '(1) Add the missing `game.page.systemError` translation for the `en` locale so users see a real ' +
      'error instead of a raw key. (2) Check server-side logs for the NetEnt game-launch endpoint to find ' +
      'why every NetEnt title fails to launch.',
  },
  {
    name: 'Novomatic',
    status: 'broken',
    tags: ['@stuck-loading'],
    description:
      'Two different games tested ("Book of Ra Deluxe", "40 Mega Hotfire") both hang indefinitely on the ' +
      'game\'s own branded splash/loading screen — no progress bar, no spinner, no error — for ' +
      '15-20+ seconds with zero visible change. Unlike NetEnt, no console errors were thrown, suggesting a ' +
      'silent hang rather than a thrown exception: likely a network request to the Novomatic game server ' +
      'that never resolves, or a required JS init callback/event that never fires so the splash screen is ' +
      'never dismissed.',
    reviewNote:
      'Check the network tab for the Novomatic game-launch request that never returns a response, and ' +
      'verify there is timeout/retry/error-fallback logic for this call (there does not appear to be any).',
  },
  {
    name: 'Hacksaw Gaming',
    status: 'working',
    tags: ['@working'],
    description:
      'Real spin confirmed on "Le Bandit". After clicking through the game\'s intro/feature-explainer ' +
      'carousel and switching to fullscreen mode (the bet/spin control bar was completely hidden until ' +
      'fullscreen was toggled — a minor UX quirk worth noting, not a functional bug), the bet was ' +
      'already at what appears to be this game\'s minimum (€2.00). Triggering the spin required ' +
      'pressing the Space key while the game canvas had focus — a plain click and even a double-click ' +
      'directly on the spin icon did not register at all, only the Space key worked. Balance decreased from ' +
      '€30.00 to €28.00, confirming a real wager was placed and resolved.',
    reviewNote:
      'No backend issue found. Only note: this provider\'s spin control seems to only listen for a ' +
      'keyboard event (Space) rather than mouse clicks on this render path — unusual, worth a quick ' +
      'look at whether real players relying on mouse/touch-only input can actually spin.',
  },
  {
    name: 'Play\'n GO',
    status: 'broken',
    tags: ['@unresponsive-ui'],
    description:
      'Two different games tested ("Tome of Madness", "Rich Wilde and the Book of Dead") both complete ' +
      'their loading progress bar (reaches 100%) and reach a "tips / feature preview" intro screen — ' +
      'but this screen\'s "Continue" button and "Don\'t show again" checkbox are completely unresponsive to ' +
      'clicks, double-clicks, and the Enter/Space keys. The game never proceeds past this intro screen, so ' +
      'no bet or spin could ever be attempted.',
    reviewNote:
      'Likely a client-side event-binding bug in Play\'n GO\'s intro overlay component: the button is ' +
      'visually rendered but not wired to a click handler (possible causes: a z-index/pointer-events CSS ' +
      'issue where an invisible layer intercepts the click, or a JS init race condition where the handler ' +
      'attaches after the button already rendered).',
  },
  {
    name: 'EVOLUTION',
    status: 'live-casino',
    tags: ['@live-casino'],
    description:
      'Loads a live-dealer video table correctly. This is a live-casino provider, not a slot — there ' +
      'is no "spin" mechanic to test here, so pass/fail in the working/broken sense does not directly ' +
      'apply. Flagged as loading correctly for completeness.',
  },
  {
    name: 'BTG',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €2.00, balance €28.00 → €26.00.',
  },
  {
    name: 'Popiplay',
    status: 'broken',
    tags: ['@system-error'],
    description:
      'Fails identically to NetEnt: shows the same untranslated `game.page.systemError` key immediately on ' +
      'load, with no game content ever rendering.',
    reviewNote:
      'Worth checking whether NetEnt and Popiplay share the same underlying aggregator/integration path on ' +
      'FerraPlay\'s backend — the identical failure signature suggests a shared root cause rather than ' +
      'two independent bugs.',
  },
  {
    name: 'Pgsoft',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €2.00, balance €26.00 → €24.00.',
  },
  {
    name: 'Fugaso',
    status: 'broken',
    tags: ['@stuck-loading'],
    description:
      'The game\'s splash/branding animation loops indefinitely and never hands off to the actual game. ' +
      'Similar family of bug to Novomatic\'s hang, but here it manifests as a repeating animation rather ' +
      'than a static frozen frame — suggesting the initialization callback that should stop the intro ' +
      'loop and mount the game canvas never fires.',
  },
  {
    name: 'Nolimit City',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €1.00, balance €24.00 → €23.00.',
  },
  {
    name: 'YOriginal',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €0.20 (very low minimum), balance €23.00 → €22.80.',
  },
  {
    name: 'Onlyplay',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €0.20, balance €22.80 → €22.60.',
  },
  {
    name: 'Ebaka',
    status: 'broken',
    tags: ['@unresponsive-ui'],
    description:
      'Game "Tower" loads its UI fully, but the "Bet" button did not respond to any interaction attempts ' +
      '(click, double-click) — balance never changed despite the button appearing enabled.',
    reviewNote:
      'This is a non-standard game type ("Tower", not a typical slot reel) which may use a different input ' +
      'paradigm — worth a manual look at the actual bet-placement click handler for this specific ' +
      'game.',
  },
  {
    name: 'Bgaming',
    status: 'broken',
    tags: ['@unresponsive-ui'],
    description:
      'Game fully loaded — assets, reels and bet display all rendered correctly — but the spin ' +
      'control did not respond to any interaction method tried (click, double-click, Space key with focus). ' +
      'Unlike Hacksaw Gaming (where Space worked), nothing triggered a spin here.',
    reviewNote:
      'Inspect this game\'s actual spin-trigger event binding — it may require a different key, or a ' +
      'mousedown+mouseup sequence with specific timing that a synthetic click does not reproduce.',
  },
  {
    name: 'BELATRA',
    status: 'broken',
    tags: ['@stuck-loading'],
    description:
      'Static loading screen with no progress-indicator movement for 20+ seconds — same silent-hang ' +
      'category as Novomatic.',
  },
  {
    name: 'Amigo',
    status: 'broken',
    tags: ['@render-failure'],
    description:
      'After the loading sequence completes, the game area renders as a completely blank black screen with ' +
      'no visible content — a different failure mode than a stuck loader. Suggests the game\'s ' +
      'rendering canvas/iframe initializes but fails to actually draw anything (possible WebGL context ' +
      'failure, a missing asset causing the render loop to bail out, or a swallowed JS error).',
    reviewNote:
      'Browser console was not fully captured for this provider during this pass — recommend a manual ' +
      'recheck with devtools console open to catch the specific error.',
  },
  {
    name: 'Pragmatic Live',
    status: 'live-casino',
    tags: ['@live-casino'],
    description:
      'Loads a live game-show style table correctly. Live-casino provider, not a slot — no spin ' +
      'mechanic to test.',
  },
  {
    name: 'JustSlots',
    status: 'broken',
    tags: ['@stuck-loading'],
    description: 'Stuck on an intro splash screen, completely unresponsive to interaction.',
  },
  {
    name: 'Trusty Gaming',
    status: 'broken',
    tags: ['@stuck-loading'],
    description: 'Loading spinner shown but never completes, even after an extended wait.',
  },
  {
    name: 'BF GAMES',
    status: 'broken',
    tags: ['@stuck-loading'],
    description:
      'Loading progress bar gets stuck around ~95% and does not move further even after 90+ seconds of ' +
      'waiting — notably longer than the wait given to other "stuck" providers, reinforcing this is a ' +
      'genuine hang rather than just slow loading.',
  },
  {
    name: 'Kitsune Studios',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €2.00, balance €22.60 → €20.60.',
  },
  {
    name: 'NowNow Gaming',
    status: 'broken',
    tags: ['@stuck-loading'],
    description:
      'Game shows an animated "water curtain" transition effect that plays indefinitely and never reveals ' +
      'the actual reels/game underneath — same family of bug as Fugaso\'s looping intro.',
  },
  {
    name: 'Penguin King',
    status: 'broken',
    tags: ['@stuck-loading'],
    description: 'Hangs on a splash screen with a shimmer/loading bar animation that never reaches completion.',
  },
  {
    name: 'Reevo',
    status: 'broken',
    tags: ['@stuck-loading'],
    description: 'Loading spinner never completes.',
  },
  {
    name: 'Platipus',
    status: 'broken',
    tags: ['@stuck-loading'],
    description:
      'Gets stuck cycling through a 3-slide feature-preview carousel indefinitely — it loops back to ' +
      'slide 1 instead of ever launching the actual game. Same family of bug as Play\'n GO\'s stuck intro, ' +
      'but here it actively loops rather than simply freezing, suggesting the carousel\'s ' +
      '"last slide → launch game" transition has a logic bug (e.g. an off-by-one in the slide-count ' +
      'check).',
  },
  {
    name: 'ZILLION',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €2.00, balance €20.60 → €18.60.',
  },
  {
    name: 'Bullshark Games',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €2.00, balance €18.60 → €16.60.',
  },
  {
    name: 'Iconic21',
    status: 'broken',
    tags: ['@unresponsive-ui'],
    description:
      'Two games tried. The provider\'s roulette game presents a betting window with a countdown that ' +
      'closes before a bet can reliably be placed within the available interaction time — this may ' +
      'simply reflect real-money live/fast-round mechanics rather than a bug. The second game tried, ' +
      '"Buffalo Wild Collection", got stuck on an unresponsive "TAP TO CONTINUE" screen (same category as ' +
      'other stuck-intro bugs in this report).',
    reviewNote:
      'Manually verify: (1) the roulette round timing gives real players a fair window to bet, and (2) the ' +
      '"Buffalo Wild Collection" intro-screen unresponsiveness.',
  },
  {
    name: 'ElaGames',
    status: 'broken',
    tags: ['@unresponsive-ui'],
    description:
      'The "PLAY" button on the game\'s landing screen did not respond after several click attempts — ' +
      'the game never launches into a playable state at all.',
  },
  {
    name: 'InOut',
    status: 'working',
    tags: ['@working'],
    description:
      'Real spin/round confirmed on a Crash-style game. Bet €2.50 placed and cashed out; balance moved ' +
      'from €16.60 to €16.48. Note the balance delta is smaller than the bet — Crash games ' +
      'resolve with a live multiplier rather than a fixed win/loss like a slot spin, so a variable delta is ' +
      'expected and itself confirms the round was genuinely live (not fixed).',
  },
  {
    name: 'Mascot',
    status: 'broken',
    tags: ['@stuck-loading'],
    description:
      'Loading bar fills to 100% but the screen never transitions to the actual game afterward — the ' +
      'same "loader completes but never hands off" pattern seen with Novomatic and several other providers ' +
      'in this report.',
  },
  {
    name: 'ShadyLady',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €1.00, balance €14.10 → €13.10.',
  },
  {
    name: 'BETSOFT',
    status: 'broken',
    tags: ['@stuck-loading'],
    description: 'Loading spinner never completes.',
  },
  {
    name: 'GameBeat',
    status: 'broken',
    tags: ['@unresponsive-ui'],
    description:
      'Game UI loads and displays a "PRESS SPIN TO START" prompt, but pressing/clicking spin never changes ' +
      'this prompt or advances the game state — the spin control appears entirely inert.',
  },
  {
    name: 'KA GAMING',
    status: 'working',
    tags: ['@working'],
    description: 'Real spin confirmed. Bet €0.30, balance €13.10 → €12.80.',
  },
];

const NOT_YET_CHECKED = [
  'Backseat Gaming (incomplete — was mid-way through the intro banners when the check was stopped)',
  'Phantom',
  'HABANERO',
  'Aviator',
  'Endorphina',
  'Thunderkick',
  'Red Tiger',
  'SPINOMENAL',
  'Rubyplay',
  'Ezugi',
  'Evoplay',
  'Yggdrasil',
  'VoltEnt',
  'REDRAKE',
];

test.describe('FerraPlay — game provider connectivity (36 of 51 providers checked, 2026-08-25)', () => {
  test.beforeEach(async () => {
    allure.epic('Game Catalogue');
    allure.feature('Provider Connectivity');
    allure.owner('QA Automation');
  });

  for (const r of RESULTS) {
    test(`${r.name} — ${r.status.toUpperCase()}`, { tag: r.tags }, async () => {
      allure.severity(r.status === 'broken' ? 'critical' : 'normal');
      allure.description(r.description + (r.reviewNote ? `\n\nSuggested manual review: ${r.reviewNote}` : ''));

      await test.step(r.description, async () => {
        if (r.status === 'broken') {
          throw new Error(
            `${r.name} is not working: ${r.description}` +
              (r.reviewNote ? ` | Review: ${r.reviewNote}` : '')
          );
        }
      });
    });
  }

  test('Providers not yet checked (14 of 51)', { tag: ['@not-checked'] }, async () => {
    allure.severity('minor');
    allure.description(
      'These providers were not reached before the checking session was stopped. Status unknown — ' +
        'neither confirmed working nor confirmed broken:\n\n' +
        NOT_YET_CHECKED.map((p) => `- ${p}`).join('\n')
    );
    test.skip(true, 'Not checked yet — see description for the full list.');
  });
});
