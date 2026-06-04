// Vercel Edge wrapper — delegates to the Cloudflare onRequestPost logic.
import { onRequestPost } from '../functions/api/detect.js';

export const config = { runtime: 'edge' };

export default function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  return onRequestPost({ request, env: process.env });
}
