// watcher.js — single-tab, debounced, cooldown, SAFE return (reload/history)
// Uses your real Chrome profile so auth persists.
const { chromium } = require('playwright');
require('dotenv').config();

// ===== CONFIG =====
const USER_DATA_DIR = `${process.env.HOME}/.playwatcher-profile`;
const FALLBACKS = [
    process.env.BASE_URL + '/tvshow/161?season=11&episode=2&play=1', // Its Always Sunny in Philadelphia
    process.env.BASE_URL + '/tvshow/10902?season=8&episode=2&play=1', // Curb Your Enthusiasm
    process.env.BASE_URL + '/tvshow/695?season=2&episode=1&play=1', // Arrested Development
    process.env.BASE_URL + '/tvshow/157?season=2&episode=2&play=1', // Parks and Rec
    process.env.BASE_URL + '/tvshow/10?season=3&episode=2&play=1', // The Office
    process.env.BASE_URL + '/tvshow/3?season=5&episode=2&play=1', // Family Guy
];
const START_URL = FALLBACKS[0]; // initial page to load
const GRACE_PERIOD = 60 * 60 * 1000; // 1 hour
const TICK_MS = 15 * 1000; // 15s

const setWindowFullscreen = async (page) => {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'fullscreen' },
    });
    console.log('[watcher] window fullscreen set');
  } catch (err) {
    console.warn('[watcher] fullscreen skipped:', err.message);
  }
};

const clickPlayButtonIfPresent = async (page) => {
  try {
    // Wait a moment for the player to initialize
    await page.waitForTimeout(2000);
    
    // Check if the button exists and is visible
    const button = await page.$('.vjs-big-play-button');
    if (button) {
      const isVisible = await button.isVisible();
      if (isVisible) {
        await button.click({ force: true });
        console.log('[watcher] clicked play button');
      }
    }
  } catch (err) {
    console.warn('[watcher] play button click skipped:', err.message);
  }
};

(async () => {
    const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
        channel: 'chrome', headless: false, viewport: null
    });
    const tab1 = await ctx.newPage();
    await tab1.goto(START_URL);
    await setWindowFullscreen(tab1);
    await clickPlayButtonIfPresent(tab1);
    let lastChangeAt = Date.now();
    let nextIdx = 0;
    let lastValue = START_URL;

    async function tick() {
        try {
            const now = Date.now();
            const current = await tab1.url();

            if (current !== lastValue) {
                lastValue = current;
                lastChangeAt = now;
                console.log('[watcher] changed as expected:', current);
            } else {
                if (now - lastChangeAt > GRACE_PERIOD) {
                    console.log(`[watcher] unchanged! (its stuck) ${Math.round((now - lastChangeAt) / 1000)}s → next fallback`);
                    lastChangeAt = now;
                    nextIdx++;
                    await tab1.goto(FALLBACKS[nextIdx % FALLBACKS.length]);
                    lastValue = await tab1.url();
                    await setWindowFullscreen(tab1);
                    await clickPlayButtonIfPresent(tab1);
                }
            }
        } catch (e) {
            console.error('[watcher] error:', e.message);
        } finally {
            setTimeout(tick, TICK_MS);
        }
    }

    setTimeout(tick, TICK_MS);
})();