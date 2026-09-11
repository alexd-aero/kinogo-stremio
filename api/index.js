// Vercel serverless entry. vercel.json rewrites every path here.
import { handleRequest, CORS } from '../src/handler.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    return res.status(204).end();
  }

  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);

  // vercel.json rewrites every request to this function, which replaces the
  // URL the function sees — req.url would be "/api/index". The rewrite carries
  // the original path in __path so the router still gets the real route.
  // A rewrite placeholder that never got interpolated (":path*", "$1") means
  // the vercel.json syntax is wrong — treat it as absent rather than routing
  // to a literal "/$1" and returning a confusing 404.
  const raw = url.searchParams.get('__path');
  const forwarded = raw !== null && /^[$:]/.test(raw) ? null : raw;
  const pathname = forwarded === null ? url.pathname : `/${forwarded}`;

  const query = Object.fromEntries(url.searchParams);
  delete query.__path;
  const { status, headers, body } = await handleRequest(pathname, query, {
    host: req.headers.host,
    proto: (req.headers['x-forwarded-proto'] || 'https').split(',')[0],
  });

  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);

  // Vercel's rewrite layer is opaque from the outside; these make the routing
  // inputs visible on every response without needing a working route.
  res.setHeader('X-Debug-Raw-Url', String(req.url).slice(0, 200));
  res.setHeader('X-Debug-Pathname', pathname.slice(0, 200));
  res.setHeader('X-Debug-Forwarded', forwarded === null ? 'null' : forwarded.slice(0, 120));

  res.status(status).send(body);
}
