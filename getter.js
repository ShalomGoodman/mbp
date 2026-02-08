/**
 * TVmaze season-episode-count dataset builder
 *
 * Usage:
 *   node tvmaze_seasons.js
 *
 * Output:
 * [
 *   { "Name": "Show Name", "Seasons": [episodeCountSeason1, episodeCountSeason2, ...] },
 *   ...
 * ]
 *
 * Notes:
 * - Uses /search/shows?q=... then picks the best match (handles ambiguous names like "The Office").
 * - Uses /shows/:id/seasons for episodeOrder per season.
 * - If episodeOrder is null, falls back to /seasons/:id/episodes and counts.
 */

const BASE = "https://api.tvmaze.com";

const SHOWS = [
  { query: "Its Always Sunny in Philadelphia", canonicalName: "It's Always Sunny in Philadelphia" },
  { query: "Curb Your Enthusiasm", canonicalName: "Curb Your Enthusiasm" },
  { query: "Arrested Development", canonicalName: "Arrested Development" },
  { query: "Parks and Recreation", canonicalName: "Parks and Recreation" },
  // Ambiguous: UK vs US. We want US (premiered 2005-03-24).
  { query: "The Office", canonicalName: "The Office", preferPremieredYear: 2005, preferNetworkName: "NBC" },
  { query: "Family Guy", canonicalName: "Family Guy" },
  
];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 500)}`);
  }
  return res.json();
}

function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

function pickBestShow(results, spec) {
  // results: [{ score, show }, ...]
  if (!Array.isArray(results) || results.length === 0) return null;

  const wantName = normalize(spec.canonicalName);

  // 1) exact name match preferred
  let candidates = results
    .map((r) => r.show)
    .filter(Boolean);

  const exactName = candidates.filter((s) => normalize(s.name) === wantName);
  if (exactName.length > 0) candidates = exactName;

  // 2) preferred premiered year (if provided)
  if (spec.preferPremieredYear) {
    const yearMatches = candidates.filter((s) => {
      const premiered = s.premiered || "";
      return premiered.startsWith(String(spec.preferPremieredYear));
    });
    if (yearMatches.length > 0) candidates = yearMatches;
  }

  // 3) preferred network name (if provided)
  if (spec.preferNetworkName) {
    const netMatches = candidates.filter((s) => normalize(s.network?.name) === normalize(spec.preferNetworkName));
    if (netMatches.length > 0) candidates = netMatches;
  }

  // 4) Otherwise pick highest score from original list among remaining candidates
  const remainingIds = new Set(candidates.map((s) => s.id));
  const bestByScore = results
    .filter((r) => remainingIds.has(r.show?.id))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  return bestByScore?.show ?? candidates[0];
}

async function getShowId(spec) {
  const url = `${BASE}/search/shows?q=${encodeURIComponent(spec.query)}`;
  const results = await fetchJson(url);
  const show = pickBestShow(results, spec);
  if (!show) throw new Error(`No show match for query: ${spec.query}`);
  return { id: show.id, name: show.name };
}

async function getSeasonEpisodeCounts(showId) {
  const seasonsUrl = `${BASE}/shows/${showId}/seasons`;
  const seasons = await fetchJson(seasonsUrl);

  // Keep only real seasons (season.number >= 1), sort ascending
  const realSeasons = (seasons || [])
    .filter((s) => typeof s.number === "number" && s.number >= 1)
    .sort((a, b) => a.number - b.number);

  const counts = [];
  for (const s of realSeasons) {
    if (typeof s.episodeOrder === "number" && Number.isFinite(s.episodeOrder)) {
      counts.push(s.episodeOrder);
    } else {
      // Fallback if episodeOrder is missing
      const epsUrl = `${BASE}/seasons/${s.id}/episodes`;
      const eps = await fetchJson(epsUrl);
      counts.push(Array.isArray(eps) ? eps.length : 0);

      // Small delay to be polite
      await sleep(150);
    }
  }

  return counts;
}

async function main() {
  const dataset = [];

  for (const spec of SHOWS) {
    // small delay between shows (polite)
    await sleep(150);

    const { id, name } = await getShowId(spec);
    const seasonCounts = await getSeasonEpisodeCounts(id);

    dataset.push({
      Name: name,
      Seasons: seasonCounts,
    });
  }

  console.log(JSON.stringify(dataset, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});