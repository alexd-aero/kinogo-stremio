// Tiny TTL cache. On Vercel each warm instance keeps its own copy, which is
// exactly what we want: it collapses the burst of requests Stremio fires when
// a user opens a page.

const store = new Map();
const MAX_ENTRIES = 500;

const ttlMs = () => Number(process.env.CACHE_TTL || 900) * 1000;

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet(key, value, ms = ttlMs()) {
  if (store.size >= MAX_ENTRIES) {
    // Cheap eviction: drop the oldest insertion.
    store.delete(store.keys().next().value);
  }
  store.set(key, { value, expires: Date.now() + ms });
  return value;
}

export async function cached(key, fn, ms) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  if (value !== undefined && value !== null) cacheSet(key, value, ms);
  return value;
}
