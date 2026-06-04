// Vercel Edge wrapper — reuses the Cloudflare Pages Function logic verbatim.
// Cloudflare passes context.{request,env}; Vercel Edge gives a Web Request and
// process.env, so we rebuild the same context shape and delegate. Single source
// of truth lives in ../functions/api/claude.js.
import { onRequest } from '../functions/api/claude.js';

export const config = { runtime: 'edge' };

export default function handler(request) {
  return onRequest({ request, env: process.env });
}
