import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';

// 環境変数
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN; 
const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL; 
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase: ReturnType<typeof createClient> | null = null;
if (NEXT_PUBLIC_SUPABASE_URL && NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);
} else {
  console.error('[intake/route.ts] Missing Supabase URL or anon key env vars.');
}

// Slackリクエスト署名検証関数 (既存のものを流用または配置)
async function verifySlackRequest(request: NextRequest, rawBody: string): Promise<boolean> {
  if (!SLACK_SIGNING_SECRET) {
    console.error('[verifySlackRequest] Slack Signing Secret is not defined.');
    return false;
  }
  const signature = request.headers.get('x-slack-signature');
  const timestamp = request.headers.get('x-slack-request-timestamp');
  if (!signature || !timestamp) {
    console.warn('[verifySlackRequest] Missing signature or timestamp headers.');
    return false;
  }
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    console.warn('[verifySlackRequest] Timestamp is too old.');
    return false;
  }
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature = `v0=${crypto
    .createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(sigBasestring, 'utf8')
    .digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(mySignature, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch (e) {
    console.error('[verifySlackRequest] Error during timingSafeEqual:', e);
    return false;
  }
}

interface SlackIntakePayload {
  consultantName?: string;
  companyName?: string;
  companyType?: string; // スタートアップ／中小企業／上場企業 など
  companyIssues?: string;
  meetingDate?: string; // YYYY-MM-DD 形式を期待
  meetingCount?: number;
  meetingType?: string;
  supportArea?: string; // 支援領域
  companyPhase?: string; // 企業のフェーズ
  internalSharingItems?: string; // 社内共有が必要な事項
  // Slackからのファイルイベント情報がここに含まれることを想定
  event?: {
    type?: string;
    files?: {
      id?: string; // file_id を期待
      // url_private_download はここからは直接取得しない
    }[];
    // 他のイベント関連プロパティ
  };
}

export async function POST(request: NextRequest) {
  console.log(`[${new Date().toISOString()}] >>> /slack/intake called`);
  
  try {
    const reqCloneForRawBody = request.clone();
    const reqCloneForFormData = request.clone();
    const rawBody = await reqCloneForRawBody.text();
    console.log(`[${new Date().toISOString()}] Raw body received:`, rawBody.substring(0, 200) + '...');

    const verificationRequest = new NextRequest(request.url, {
      headers: request.headers,
      body: Buffer.from(rawBody),
      method: request.method,
    });

    // Slack署名検証
    if (!await verifySlackRequest(verificationRequest, rawBody)) {
      console.error(`[${new Date().toISOString()}] Slack request verification failed. Headers:`, Object.fromEntries(request.headers.entries()));
      return NextResponse.json({ error: 'Request verification failed' }, { status: 403 });
    }
    console.log(`[${new Date().toISOString()}] Slack request verification successful`);

    const formData = await reqCloneForFormData.formData();
    console.log(`[${new Date().toISOString()}] Form data keys:`, Array.from(formData.keys()));
    
    const file = formData.get('file') as File | null;
    const payloadJson = formData.get('payload_json') as string | null;

    if (!file || !payloadJson) {
      console.error(`[${new Date().toISOString()}] Missing required fields. File: ${!!file}, PayloadJson: ${!!payloadJson}`);
      return NextResponse.json({ error: 'Missing file or payload_json' }, { status: 400 });
    }

    let slackPayload: any;
    try {
      slackPayload = JSON.parse(payloadJson);
      console.log(`[${new Date().toISOString()}] Parsed payload:`, JSON.stringify(slackPayload, null, 2));
      console.log(`[${new Date().toISOString()}] File details:`, {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: new Date(file.lastModified).toISOString()
      });
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Failed to parse payload_json:`, e);
      return NextResponse.json({ error: 'Invalid payload_json format' }, { status: 400 });
    }

    // B案: payload_jsonからfile_idを取得し、files.infoを叩く
    const fileId = slackPayload?.event?.files?.[0]?.id;
    if (!fileId) {
      console.warn(`[${new Date().toISOString()}] /api/slack/intake: File ID not found in payload_json (expected at event.files[0].id).`);
      return NextResponse.json({ error: 'File ID not found in payload_json' }, { status: 400 });
    }
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Extracted fileId: ${fileId}`);

    if (!SLACK_BOT_TOKEN) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Missing SLACK_BOT_TOKEN for files.info API call.`);
      return NextResponse.json({ error: 'Server configuration error for Slack API call' }, { status: 500 });
    }

    let slackFileUrl: string;
    try {
      console.log(`[${new Date().toISOString()}] /api/slack/intake: Calling Slack files.info for fileId: ${fileId}`);
      // Slack APIの files.info はGETメソッドでクエリパラメータで送信する方が一般的だが、POSTも受け付ける場合がある。
      // ここではPOSTで application/json を試す。Slackドキュメントで推奨される方法を確認するのが最善。
      // GET /api/files.info?file=<file_id> の方がより一般的かもしれない。
      const fileInfoResponse = await fetch(`https://slack.com/api/files.info?file=${fileId}`, { // GETリクエストに変更
        method: 'GET', // メソッドをGETに変更
        headers: {
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        },
        // body: JSON.stringify({ file: fileId }), // GETなのでボディは不要
      });

      if (!fileInfoResponse.ok) {
        const errorBody = await fileInfoResponse.text();
        console.error(`[${new Date().toISOString()}] /api/slack/intake: Slack files.info API call failed. Status: ${fileInfoResponse.status}, Body: ${errorBody}`);
        return NextResponse.json({ error: 'Failed to get file info from Slack', details: errorBody }, { status: fileInfoResponse.status });
      }
      const fileInfo = await fileInfoResponse.json();
      console.log(`[${new Date().toISOString()}] Slack files.info response:`, JSON.stringify(fileInfo, null, 2));
      slackFileUrl = fileInfo?.file?.url_private_download;
      if (!slackFileUrl) {
        console.warn(`[${new Date().toISOString()}] /api/slack/intake: url_private_download not found in files.info response. Response:`, JSON.stringify(fileInfo));
        return NextResponse.json({ error: 'url_private_download not found in Slack file info' }, { status: 400 });
      }
      console.log(`[${new Date().toISOString()}] /api/slack/intake: Successfully fetched url_private_download: ${slackFileUrl}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Error calling Slack files.info API: ${error instanceof Error ? error.message : String(error)}`);
      return NextResponse.json({ error: 'Error fetching file info from Slack' }, { status: 500 });
    }

    // 1. 署名付きURLを取得 (スニペットのロジック)
    if (!NEXT_PUBLIC_APP_URL || !WEBHOOK_SECRET) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Missing NEXT_PUBLIC_APP_URL or WEBHOOK_SECRET for internal API call.`);
      return NextResponse.json({ error: 'Server configuration error for internal API call' }, { status: 500 });
    }
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Requesting upload URL from /api/upload-url.`);
    const uploadUrlResponse = await fetch(`${NEXT_PUBLIC_APP_URL}/api/upload-url`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WEBHOOK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileName: file.name, contentType: file.type }),
    });

    if (!uploadUrlResponse.ok) {
      const errorBody = await uploadUrlResponse.text();
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Failed to get upload URL. Status: ${uploadUrlResponse.status}, Body: ${errorBody}`);
      return NextResponse.json({ error: 'Failed to get upload URL', details: errorBody }, { status: uploadUrlResponse.status });
    }

    const { uploadUrl, storagePath } = await uploadUrlResponse.json();
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Received uploadUrl: ${uploadUrl}, storagePath: ${storagePath}`);

    // 2. Slackからファイルをストリーム取得 (スニペットのロジック)
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Fetching file from Slack: ${slackFileUrl}`);
    const slackRes = await fetch(slackFileUrl, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });

    if (!slackRes.ok || !slackRes.body) {
      const errorBody = await slackRes.text();
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Failed to download Slack file. Status: ${slackRes.status}, Body: ${errorBody}`);
      return NextResponse.json({ error: 'Failed to download Slack file', details: errorBody }, { status: slackRes.status });
    }
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Successfully fetched file stream from Slack.`);

    // 3. Supabase署名付きURLにストリーミングアップロード (スニペットのロジック)
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Streaming upload to Supabase: ${uploadUrl}`);
    const supabaseUploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
      },
      body: slackRes.body, // ReadableStreamを直接渡す
    });

    if (!supabaseUploadRes.ok) {
      const errorBody = await supabaseUploadRes.text();
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Failed to upload to Supabase. Status: ${supabaseUploadRes.status}, Body: ${errorBody}`);
      return NextResponse.json({ error: 'Failed to upload to Supabase', details: errorBody }, { status: supabaseUploadRes.status });
    }
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Successfully uploaded to Supabase. Path: ${storagePath}`);

    // 4. Supabaseにタスク記録（スニペットのロジック、ただしクライアントは上部で初期化済みのものを使用）
    if (!supabase) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Supabase client not initialized for DB operation.`);
      return NextResponse.json({ error: 'Server configuration error: Supabase client not available for DB.' }, { status: 500 });
    }
    
    const taskData = {
      original_file_name: file.name,
      slack_file_url: slackFileUrl, 
      storage_path: storagePath,
      status: 'uploaded',
      consultant_name: slackPayload.consultantName ?? null,
      company_name: slackPayload.companyName ?? null,
      company_type: slackPayload.companyType ?? null,
      company_problem: slackPayload.companyIssues ?? null,
      meeting_date: slackPayload.meetingDate ?? null,
      meeting_count: slackPayload.meetingCount ?? null,
      meeting_type: slackPayload.meetingType ?? null,
      support_area: slackPayload.supportArea ?? null,
    };
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Inserting task into DB:`, taskData);
    const { error: dbError } = await supabase.from('transcription_tasks').insert(taskData);

    if (dbError) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Failed to insert task to DB:`, dbError);
      return NextResponse.json({ error: 'Failed to insert task', details: dbError.message }, { status: 500 });
    }
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Task inserted to DB successfully with data:`, JSON.stringify(taskData, null, 2));

    return NextResponse.json({ message: 'Upload successful and task created', storagePath });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] /api/slack/intake: Error processing request:`, error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 