// Embed resolvers. Kinogo never hosts video itself — each post embeds one or
// more third-party balancers, so "all streams" means: resolve every embed, and
// return every quality each one exposes.

import { siteFetch, isGeoBlocked } from './fetch.js';
import { cached } from './cache.js';
import { decodeEntities } from './html.js';

const QUALITY_RE = /\[(\d{3,4}p?(?:[^\]]*)?)\]/;

function qualityRank(label = '') {
  const n = Number((label.match(/(\d{3,4})/) || [])[1] || 0);
  return n;
}

// Playerjs encodes multi-quality sources as "[1080p]url,[720p]url" and
// sometimes uses " or " between mirrors of the same quality.
export function parseFileString(file) {
  const out = [];
  if (typeof file !== 'string' || !file) return out;
  for (const chunk of file.split(',')) {
    const part = chunk.trim();
    if (!part) continue;
    const q = part.match(QUALITY_RE);
    const label = q ? q[1] : '';
    const urls = part
      .replace(QUALITY_RE, '')
      .split(/\s+or\s+/i)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u) || u.startsWith('//'));
    for (const u of urls) out.push({ url: u.startsWith('//') ? `https:${u}` : u, quality: label });
  }
  return out;
}

// Some balancers ship the file value base64'd behind a marker prefix.
function maybeDecode(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^https?:\/\/|^\[|^\/\//i.test(trimmed)) return trimmed;
  const cleaned = trimmed.replace(/^#\d+#?/, '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (cleaned.length < 24 || cleaned.length % 4 !== 0) return trimmed;
  try {
    const decoded = Buffer.from(cleaned, 'base64').toString('utf8');
    return /https?:\/\//i.test(decoded) ? decoded : trimmed;
  } catch {
    return trimmed;
  }
}

// Walks a Playerjs season/episode playlist. Shape in the wild:
// [{ title:"1 сезон", folder:[{ title:"1 серия", file:"[720p]..." }] }]
export function pickFromPlaylist(playlist, season, episode) {
  const found = [];
  const wantSeason = season != null ? Number(season) : null;
  const wantEpisode = episode != null ? Number(episode) : null;

  const numOf = (s = '') => Number((String(s).match(/(\d+)/) || [])[1]);

  const walk = (nodes, ctxSeason) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const title = node.title || node.name || '';
      const isSeasonNode = /сезон|season/i.test(title);
      const seasonNo = isSeasonNode ? numOf(title) : ctxSeason;

      if (Array.isArray(node.folder)) {
        walk(node.folder, seasonNo);
        continue;
      }
      const episodeNo = numOf(title);
      const seasonOk = wantSeason == null || seasonNo == null || seasonNo === wantSeason;
      const episodeOk = wantEpisode == null || episodeNo === wantEpisode;
      if (seasonOk && episodeOk && node.file) {
        found.push(...parseFileString(maybeDecode(node.file)).map((s) => ({ ...s, label: title })));
      }
    }
  };
  walk(playlist, wantSeason);
  return found;
}

function extractPlaylist(html) {
  // `file:` may hold a JSON array (series) or a quality string (movie).
  const candidates = [];
  const re = /["']?file["']?\s*:\s*(\[[\s\S]*?\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  let m;
  while ((m = re.exec(html))) candidates.push(m[1]);
  return candidates;
}

function collectDirect(html) {
  const out = [];
  const re = /https?:\\?\/\\?\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[0].replace(/\\\//g, '/');
    if (!out.some((s) => s.url === url)) out.push({ url, quality: '' });
  }
  return out;
}

function nestedIframe(html, baseUrl) {
  const m = html.match(/<iframe[^>]*?\ssrc=["']([^"']+)["']/i);
  if (!m) return null;
  try {
    return new URL(decodeEntities(m[1]), baseUrl).href;
  } catch {
    return null;
  }
}

// Resolve one embed into a flat list of playable sources.
async function resolveOne(embedUrl, { referer, season, episode, depth = 0 }) {
  let url = embedUrl;
  if (season != null && !/[?&]season=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + `season=${season}`;
  }
  if (episode != null && !/[?&]episode=/.test(url)) {
    url += `&episode=${episode}`;
  }

  const r = await siteFetch(url, { referer, timeout: 25000 });
  const body = r.body || '';

  if (isGeoBlocked(body)) {
    return { host: new URL(url).hostname, geoBlocked: true, sources: [], status: r.status };
  }

  const sources = [];
  for (const raw of extractPlaylist(body)) {
    let value = raw;
    if (/^["']/.test(raw)) {
      try {
        value = JSON.parse(raw.replace(/^'/, '"').replace(/'$/, '"'));
      } catch {
        value = raw.slice(1, -1);
      }
      sources.push(...parseFileString(maybeDecode(value)));
    } else {
      try {
        sources.push(...pickFromPlaylist(JSON.parse(raw), season, episode));
      } catch {
        /* not valid JSON — fall through to direct scraping */
      }
    }
  }

  if (!sources.length) sources.push(...collectDirect(body));

  // Balancers frequently bounce through one more iframe before the real player.
  if (!sources.length && depth < 2) {
    const next = nestedIframe(body, url);
    if (next && next !== url) {
      return resolveOne(next, { referer: url, season, episode, depth: depth + 1 });
    }
  }

  const host = new URL(url).hostname;
  const seen = new Set();
  const unique = sources.filter((s) => s.url && !seen.has(s.url) && seen.add(s.url));
  return { host, geoBlocked: false, sources: unique, status: r.status };
}

// Resolve every embed on a post, in parallel, into Stremio-ready stream objects.
export async function resolveStreams(item, { season = null, episode = null } = {}) {
  const key = `streams:${item.postId}:${season ?? 'x'}:${episode ?? 'x'}`;
  return cached(
    key,
    async () => {
      const results = await Promise.all(
        (item.embeds || []).map((e) =>
          resolveOne(e, { referer: item.url, season, episode }).catch((err) => ({
            host: (() => { try { return new URL(e).hostname; } catch { return e; } })(),
            error: err.message,
            sources: [],
          }))
        )
      );

      const streams = [];
      for (const res of results) {
        for (const src of res.sources) {
          streams.push({
            host: res.host,
            url: src.url,
            quality: src.quality || src.label || '',
            rank: qualityRank(src.quality || src.label || ''),
          });
        }
      }
      streams.sort((a, b) => b.rank - a.rank);
      return { streams, diagnostics: results.map((r) => ({ host: r.host, geoBlocked: !!r.geoBlocked, found: r.sources.length, status: r.status, error: r.error })) };
    },
    5 * 60 * 1000
  );
}

export { resolveOne, isGeoBlocked };

const numOf = (s = '') => Number((String(s).match(/(\d+)/) || [])[1]);

// Collapse a Playerjs playlist into [{ season, episodes: [{ episode, title }] }].
export function buildTree(playlist, fallbackSeason = 1) {
  const seasons = new Map();
  const add = (seasonNo, episodeNo, title) => {
    if (!episodeNo) return;
    const key = seasonNo || fallbackSeason;
    if (!seasons.has(key)) seasons.set(key, new Map());
    const eps = seasons.get(key);
    if (!eps.has(episodeNo)) eps.set(episodeNo, title);
  };

  const walk = (nodes, ctxSeason) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const title = node.title || node.name || '';
      const isSeasonNode = /сезон|season/i.test(title);
      const seasonNo = isSeasonNode ? numOf(title) : ctxSeason;
      if (Array.isArray(node.folder)) walk(node.folder, seasonNo);
      else add(seasonNo, numOf(title), title);
    }
  };
  walk(playlist, null);

  return [...seasons.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, eps]) => ({
      season,
      episodes: [...eps.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([episode, title]) => ({ episode, title })),
    }));
}

// The player's own playlist is the only authoritative season/episode map, so
// try it before falling back to the page's numberOfEpisodes.
export async function getPlaylistTree(item) {
  return cached(
    `tree:${item.postId}`,
    async () => {
      for (const embed of item.embeds || []) {
        try {
          const r = await siteFetch(embed, { referer: item.url, timeout: 25000 });
          if (!r.body || isGeoBlocked(r.body)) continue;
          for (const raw of extractPlaylist(r.body)) {
            if (!raw.trim().startsWith('[')) continue;
            try {
              const tree = buildTree(JSON.parse(raw), item.season || 1);
              if (tree.length && tree.some((s) => s.episodes.length)) return tree;
            } catch {
              /* not the playlist we're after */
            }
          }
        } catch {
          /* try the next embed */
        }
      }
      return null;
    },
    10 * 60 * 1000
  );
}
