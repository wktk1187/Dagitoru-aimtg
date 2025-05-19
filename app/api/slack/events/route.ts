import { NextRequest, NextResponse } from 'next/server';
import process from 'node:process';

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

interface SlackEventBody {
  type: string;
  challenge?: string;
  // 必要に応じて他のフィールドも追加
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: SlackEventBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // challenge 先に処理
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge });
  }

  // 署名検証
  const valid = await verifySlackSignature(req, rawBody);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // ここで即200返す（重い処理は非同期で）
  return NextResponse.json({ ok: true });
} 