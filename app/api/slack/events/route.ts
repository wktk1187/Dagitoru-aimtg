import { NextRequest, NextResponse } from 'npm:next/server';

// Slack signing secret
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? '';

/**
 * Verify Slack request signature
 */
async function verifySlackSignature(req: NextRequest, rawBody: string): Promise<boolean> {
  if (!SLACK_SIGNING_SECRET) return false;
  const timestamp = req.headers.get('x-slack-request-timestamp');
  const signature = req.headers.get('x-slack-signature');
  if (!timestamp || !signature) return false;

  // Protect against replay attacks (5 minutes)
  const fiveMinutes = 60 * 5;
  const ts = Number(timestamp);
  if (Math.abs(Date.now() / 1000 - ts) > fiveMinutes) return false;

  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SLACK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const hashBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBaseString));
  const hashArray = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  const computed = `v0=${hashArray}`;

  const a = encoder.encode(computed);
  const b = encoder.encode(signature);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    // ignore parse error
  }

  // URL verification challenge
  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Verify signature for other requests
  const verified = await verifySlackSignature(req, rawBody);
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // For now, just acknowledge the event quickly.
  // TODO: Add event-specific handling if needed.
  return NextResponse.json({ ok: true });
} 