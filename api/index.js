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
  const forwarded = url.searchParams.get('__path');
  const pathname = forwarded === null ? url.pathname : `/${forwarded}`;

  const query = Object.fromEntries(url.searchParams);
  delete query.__path;
  const { status, headers, body } = await handleRequest(pathname, query, {
    host: req.headers.host,
    proto: (req.headers['x-forwarded-proto'] || 'https').split(',')[0],
  });

  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.status(status).send(body);
}
