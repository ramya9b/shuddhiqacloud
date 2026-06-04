// Vercel Edge wrapper — delegates to the Cloudflare onRequest logic.
import { onRequest } from '../functions/api/billing.js';

export const config = { runtime: 'edge' };

export default function handler(request) {
  return onRequest({ request, env: process.env });
}
