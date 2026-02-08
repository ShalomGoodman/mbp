// watcher.js — single-tab, debounced, cooldown, SAFE return (reload/history)
// Uses your real Chrome profile so auth persists.
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
require('dotenv').config();
const shows = require('./shows.json');

// ===== CONFIG =====
const USER_DATA_DIR = `${process.env.HOME}/.playwatcher-profile`;

// Pixel tracker config (you can set these)
const PIXEL_X = 500; // TODO: set your x
const PIXEL_Y = 500; // TODO: set your y
const PIXEL_GRACE_MS = 1 * 60 * 1000; // 1m (if pixel doesn't change, we fallback)

const TICK_MS = 30 * 1000; // 30s

const buildUrl = (show_id, season, episode) => {
  return `https://www.movieboxpro.app/tvshow/${show_id}?season=${season}&episode=${episode}&play=1`;
};

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
    await page.waitForTimeout(5000);
    
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

const getPixelHex = async (page) => {
  // 1x1 screenshot clip, then decode PNG and return #RRGGBB
  const buf = await page.screenshot({
    type: 'png',
    clip: { x: PIXEL_X, y: PIXEL_Y, width: 1, height: 1 },
  });

  const png = PNG.sync.read(buf);
  const r = png.data[0];
  const g = png.data[1];
  const b = png.data[2];
  return (
    '#' +
    [r, g, b]
      .map(v => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
};

(async () => {
    let lastChangeAt = Date.now();
    let lastPixel = null;
    let currentShow = shows[0];
    let currentSeason = 1;
    let currentEpisode = 1;
    const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
        channel: 'chrome', headless: false, viewport: null
    });
    const tab1 = await ctx.newPage();
    await tab1.goto(buildUrl(currentShow.id, currentSeason, currentEpisode));
    await setWindowFullscreen(tab1);
    await clickPlayButtonIfPresent(tab1);


    try {
      lastPixel = await getPixelHex(tab1);
      console.log('[watcher] initial pixel baseline:', lastPixel);
    } catch (e) {
      console.warn('[watcher] initial pixel read skipped:', e.message);
      lastPixel = null;
    }

    async function tick() {
        try {
            const now = Date.now();

            const px = await getPixelHex(tab1);

            if (lastPixel === null) {
                lastPixel = px;
                lastChangeAt = now;
                console.log('[watcher] pixel baseline set:', px);
            } else if (px !== lastPixel) {
                console.log('[watcher] pixel changed from ' + lastPixel + ' → ' + px);
                lastPixel = px;
                lastChangeAt = now;
            } else {
                if (now - lastChangeAt > PIXEL_GRACE_MS) {
                    console.log(`[watcher] pixel unchanged (stuck) → next fallback`);
                    lastChangeAt = now;
                    // Extract current show/season/episode from URL, then find next episode or fallback show
                    const url = new URL(tab1.url());
                    const pathParts = url.pathname.split('/').filter(Boolean);
                    const showId = parseInt(pathParts[1]);
                    const season = parseInt(url.searchParams.get('season'));
                    const episode = parseInt(url.searchParams.get('episode'));

                    let nextShow, nextSeason, nextEpisode;
                    const currentShowIdx = shows.findIndex(s => s.id === showId);
                    if (currentShowIdx === -1) {
                        // not found, fallback to random show, season, and episode
                        const randomIdx = Math.floor(Math.random() * shows.length);
                        nextShow = shows[randomIdx];
                        nextSeason = Math.floor(Math.random() * shows[randomIdx].seasons.length) + 1;
                        nextEpisode = Math.floor(Math.random() * shows[randomIdx].seasons[nextSeason - 1]) + 1;
                    } else {
                        const showData = shows[currentShowIdx];
                        if (season <= showData.seasons.length && episode < showData.seasons[season - 1]) {
                            // next episode in same season
                            nextShow = showData;
                            nextSeason = season;
                            nextEpisode = episode + 1;
                        } else if (season < showData.seasons.length) {
                            // next season
                            nextShow = showData;
                            nextSeason = season + 1;
                            nextEpisode = 1;
                        } else {
                            // next show
                            const nextShowIdx = (currentShowIdx + 1) % shows.length;
                            nextShow = shows[nextShowIdx];
                            nextSeason = 1;
                            nextEpisode = 1;
                        }
                    }

                    const nextUrl = buildUrl(nextShow.id, nextSeason, nextEpisode);
                    console.log(`[watcher] navigating to: ${nextShow.name} S${nextSeason}E${nextEpisode}`);
                    await tab1.goto(nextUrl);
                    await setWindowFullscreen(tab1);
                    await clickPlayButtonIfPresent(tab1);
                    // reset baseline after navigation
                    try {
                        lastPixel = await getPixelHex(tab1, PIXEL_X, PIXEL_Y);
                        console.log('[watcher] pixel baseline reset:', lastPixel);
                    } catch (_) {
                        lastPixel = null;
                    }
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