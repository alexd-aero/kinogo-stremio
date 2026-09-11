# Kinogo — Stremio addon

Russian movies & series from Kinogo, exposed over the Stremio addon protocol.
Search, genre catalogs, automatic movie/series detection, and every stream each
post's players expose.

## What it does

| Resource  | Behaviour |
|-----------|-----------|
| `catalog` | Two catalogs (`Kinogo Фильмы`, `Kinogo Сериалы`), each with search, genre filter and paging (12 per page, mapped onto DLE's own pagination). |
| `meta`    | Title, poster, description, year, genres, cast, director, country, runtime, rating. Series get a full `videos` list. |
| `stream`  | Resolves **all** embeds on a post and returns **every quality** each one exposes, sorted highest-first. |

Ids are `kinogo:<postId>` for titles and `kinogo:<postId>:<season>:<episode>`
for episodes. IMDb ids (`tt…`, `tt…:S:E`) also work — see *IMDb matching*.

### Series auto-detection

A post is treated as a series when any of these hold, checked in order of
reliability:

1. JSON-LD `@type` is `TVSeries` / `TVSeason`, or `numberOfEpisodes > 0`
2. the breadcrumb sits under `/serial/`, `/tv/`, `/multserialy/`, `/doramy/` or `/anime-serialy/`
3. the title carries a `(4 сезон)` / `(1-4 сезон)` suffix
4. the genre line mentions сериал / шоу / передач

Search results carry no category, so the top hits are confirmed against their
detail pages (cached, and needed by `meta` anyway) before being split between
the movie and series catalogs.

Episode lists come from the player's own playlist when it is reachable — that
is the only authoritative season→episode map. When it is not, the addon falls
back to the title's season range and the page's `numberOfEpisodes`.

## Requirements and constraints

**The players are geo-locked to RU/CIS.** From anywhere else both balancers
answer `видео недоступно для вашего региона`, and no amount of
Cloudflare-solving changes that. Metadata, search and catalogs work from any
region; *streams* need a Russian exit IP:

* set `PROXY_URL` so the addon resolves embeds through a RU proxy, **and**
* keep in mind that Stremio plays the returned URL from *your* machine, so the
  player CDN sees your own IP — you generally need the RU exit on the client
  side too (VPN), or a restreaming proxy.

When every embed is region-blocked the addon returns a single explanatory
stream entry instead of an empty list, so the failure is visible in the UI.

**FlareSolverr** is only needed for the Cloudflare-gated mirrors
(`kinogo.media`, `kinogo1.biz`). The default mirror `kinogo.la` is currently
served straight from nginx. Requests go out plain first and only escalate to
FlareSolverr when the response looks like a challenge; the resulting cookies
and UA are then reused for ~20 minutes.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `FLARESOLVERR_URL` | — | e.g. `http://localhost:8191/v1`. Omit to disable. |
| `PROXY_URL` | — | `http://user:pass@host:port`. Used for direct fetches (needs `undici`) and passed to FlareSolverr. |
| `KINOGO_MIRRORS` | `kinogo.la,kinogo.media,kinogo1.biz` | Tried in order; the first healthy one sticks for 30 min. |
| `CACHE_TTL` | `900` | Seconds for search/browse/detail caching. |
| `PORT` / `HOST` | `7000` / `0.0.0.0` | Standalone server only. |

## Running locally

```bash
npm install
FLARESOLVERR_URL=http://localhost:8191/v1 npm start
# http://localhost:7000/manifest.json
```

FlareSolverr, if you want it:

```bash
docker run -d --name flaresolverr -p 8191:8191 \
  --restart unless-stopped ghcr.io/flaresolverr/flaresolverr:latest
```

Add to Stremio: paste the `manifest.json` URL into Stremio's *Addons → Add
addon* box.

## Deploying to Vercel

`vercel.json` rewrites every path to `api/index.js`, so the whole addon is one
serverless function.

```bash
npx vercel            # preview
npx vercel --prod     # production
```

Then set the env vars (Project → Settings → Environment Variables):

```bash
npx vercel env add PROXY_URL production
npx vercel env add FLARESOLVERR_URL production
```

FlareSolverr **cannot run on Vercel** — it needs a long-lived headless Chrome.
Point `FLARESOLVERR_URL` at an instance you host (this Pi behind a tunnel, a
VPS, a Docker host) or leave it unset and rely on the non-Cloudflare mirror.

Manifest URL after deploy: `https://<your-project>.vercel.app/manifest.json`

## IMDb matching

Stremio's own movie pages are IMDb-based, so `tt…` ids are mapped onto Kinogo
posts by title + year. Cinemeta only exposes the English title, which never
matches a Russian catalogue, so the addon first resolves the native title from
Wikidata (`P345` → Russian `rdfs:label`, no API key) and falls back to the
English one. Matches are scored on exact/partial title, year distance and
season, and anything below the threshold is dropped rather than guessed at.

## Diagnostics

The player layer is the part most likely to drift when a balancer changes, so
two debug routes are included:

```bash
curl localhost:7000/debug/health | jq
curl localhost:7000/debug/streams/62113 | jq
curl 'localhost:7000/debug/embed?url=<embed-url>&referer=<page-url>' | jq
```

`/debug/streams/<postId>` reports each embed's host, HTTP status, whether it
was region-blocked, and how many sources were extracted. `/debug/embed` dumps
the raw embed body (first 20 KB) — that is what you need to finish or adjust
the extractor from a Russian IP.

## Layout

```
api/index.js    Vercel function entry
server.js       standalone Node server
src/addon.js    Stremio protocol: manifest, catalog, meta, stream
src/kinogo.js   site adapter: mirrors, search, browse, detail
src/players.js  embed resolution, quality parsing, season/episode trees
src/fetch.js    direct → FlareSolverr escalation, proxy, cookie reuse
src/handler.js  shared CORS/JSON wrapper
src/html.js     entity decoding, tag stripping, JSON-LD
src/cache.js    TTL cache
```
