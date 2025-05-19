import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 環境変数
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

let supabase: ReturnType<typeof createClient> | null = null;
if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.error('[intake/route.ts] Missing Supabase URL or Service Role Key env vars.');
}

interface IntakePayload {
  file_id: string;
  original_file_name: string;
  mimetype: string;
  filetype: string;
  slack_download_url: string;
  slack_user_id: string;
  slack_channel_id?: string;
  slack_team_id?: string;
  slack_event_ts?: string;
  metadata: {
    consultant_name?: string;
    client_name?: string;
    meeting_date?: string;
    meeting_type?: string;
    company_problem?: string;
    company_phase?: string;
    company_type?: string;
    meeting_count?: string; 
    support_area?: string;
    internal_sharing_items?: string;
  };
}

export async function POST(request: NextRequest) {
  console.log(`[${new Date().toISOString()}] >>> /api/slack/intake called`);
  
  // 1. Authorizationヘッダー検証
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn(`[${new Date().toISOString()}] /api/slack/intake: Missing or invalid Authorization header.`);
    return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
  }
  const token = authHeader.split(' ')[1];
  if (token !== WEBHOOK_SECRET) {
    console.warn(`[${new Date().toISOString()}] /api/slack/intake: Invalid WEBHOOK_SECRET.`);
    return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
  }
  console.log(`[${new Date().toISOString()}] /api/slack/intake: Authorization successful.`);

  try {
    const payload: IntakePayload = await request.json();
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Received payload:`, JSON.stringify(payload, null, 2));

    const {
      file_id: slackFileId,
      original_file_name,
      mimetype,
      filetype,
      slack_download_url,
      slack_user_id,
      slack_channel_id,
      slack_team_id,
      slack_event_ts,
      metadata,
    } = payload;

    if (!slackFileId || !original_file_name || !mimetype || !filetype || !slack_download_url || !slack_user_id) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Missing required fields in payload.`, payload);
      return NextResponse.json({ error: 'Missing required fields in payload' }, { status: 400 });
    }
    
    // ファイルタイプチェック (もし再度行う場合)
    if (!mimetype.startsWith('video/')) {
        console.warn(`[${new Date().toISOString()}] /api/slack/intake: Received non-video file type: ${mimetype} for file ${original_file_name}. Skipping.`);
        // イベント側でフィルタリング済みだが、念のためintake側でも確認・ログ出力するのも良い
        return NextResponse.json({ message: 'Non-video file type, processing skipped.' }, { status: 200 }); 
    }

    // 1. 署名付きURLを取得 (この部分は既存のままでも良いが、ファイル名とタイプはpayloadから取得)
    if (!NEXT_PUBLIC_APP_URL) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Missing NEXT_PUBLIC_APP_URL for internal API call.`);
      return NextResponse.json({ error: 'Server configuration error for internal API call' }, { status: 500 });
    }
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Requesting upload URL from /api/upload-url.`);
    const uploadUrlResponse = await fetch(`${NEXT_PUBLIC_APP_URL}/api/upload-url`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WEBHOOK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileName: original_file_name, contentType: mimetype }),
    });

    if (!uploadUrlResponse.ok) {
      const errorBody = await uploadUrlResponse.text();
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Failed to get upload URL. Status: ${uploadUrlResponse.status}, Body: ${errorBody}`);
      return NextResponse.json({ error: 'Failed to get upload URL', details: errorBody }, { status: uploadUrlResponse.status });
    }

    const { uploadUrl, storagePath } = await uploadUrlResponse.json();
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Received uploadUrl: ${uploadUrl}, storagePath: ${storagePath}`);

    // 2. Slackからファイルをストリーム取得
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Fetching file from Slack: ${slack_download_url}`);
    if (!SLACK_BOT_TOKEN) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: SLACK_BOT_TOKEN is not set. Cannot download from Slack.`);
      return NextResponse.json({ error: 'Server configuration error: SLACK_BOT_TOKEN missing' }, { status: 500 });
    }
    const slackRes = await fetch(slack_download_url, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });

    if (!slackRes.ok || !slackRes.body) {
      const errorBody = await slackRes.text();
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Failed to download Slack file. Status: ${slackRes.status}, Body: ${errorBody}`);
      // ここでDBにエラーを記録することも検討
      return NextResponse.json({ error: 'Failed to download Slack file', details: errorBody }, { status: slackRes.status });
    }
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Successfully fetched file stream from Slack.`);

    // 3. Supabase署名付きURLにストリーミングアップロード
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Streaming upload to Supabase: ${uploadUrl}`);
    const supabaseUploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimetype,
      },
      body: slackRes.body,
    });

    if (!supabaseUploadRes.ok) {
      const errorBody = await supabaseUploadRes.text();
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Failed to upload to Supabase. Status: ${supabaseUploadRes.status}, Body: ${errorBody}`);
      // ここでDBにエラーを記録することも検討
      return NextResponse.json({ error: 'Failed to upload to Supabase', details: errorBody }, { status: supabaseUploadRes.status });
    }
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Successfully uploaded to Supabase. Path: ${storagePath}`);

    // 4. Supabaseにタスク記録
    if (!supabase) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Supabase client not initialized for DB operation.`);
      return NextResponse.json({ error: 'Server configuration error: Supabase client not available for DB.' }, { status: 500 });
    }
    
    const taskData = {
      original_file_name: original_file_name,
      mimetype: mimetype,
      filetype: filetype,
      slack_file_id: slackFileId,
      slack_download_url: slack_download_url,
      slack_user_id: slack_user_id,
      slack_channel_id: slack_channel_id,
      slack_team_id: slack_team_id,
      slack_event_ts: slack_event_ts,
      storage_path: storagePath,
      status: 'uploaded',
      consultant_name: metadata.consultant_name ?? null,
      client_name: metadata.client_name ?? null,
      company_type: metadata.company_type ?? null,
      company_problem: metadata.company_problem ?? null,
      meeting_date: metadata.meeting_date ? new Date(metadata.meeting_date).toISOString() : null,
      meeting_count: metadata.meeting_count ? parseInt(metadata.meeting_count, 10) : null,
      meeting_type: metadata.meeting_type ?? null,
      support_area: metadata.support_area ?? null,
      company_phase: metadata.company_phase ?? null,
      internal_sharing_items: metadata.internal_sharing_items ?? null,
    };
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Inserting task into DB:`, JSON.stringify(taskData, null, 2));
    const { data: insertedTask, error: dbError } = await supabase.from('transcription_tasks').insert(taskData).select().single();

    if (dbError) {
      console.error(`[${new Date().toISOString()}] /api/slack/intake: Failed to insert task to DB:`, dbError);
      return NextResponse.json({ error: 'Failed to insert task', details: dbError.message }, { status: 500 });
    }
    console.log(`[${new Date().toISOString()}] /api/slack/intake: Task inserted to DB successfully. Task ID: ${insertedTask?.id}`);

    // upload_logs にも記録 (オプション)
    if (insertedTask?.id) {
        const uploadLogData = {
            task_id: insertedTask.id,
            slack_file_id: slackFileId,
            status: 'success',
            original_file_name: original_file_name,
            storage_path: storagePath,
        };
        console.log(`[${new Date().toISOString()}] /api/slack/intake: Inserting into upload_logs:`, JSON.stringify(uploadLogData, null, 2));
        const { error: uploadLogError } = await supabase.from('upload_logs').insert(uploadLogData);
        if (uploadLogError) {
            console.error(`[${new Date().toISOString()}] /api/slack/intake: Failed to insert into upload_logs:`, uploadLogError);
            // intake処理自体は成功しているので、ここではエラーレスポンスを返さない
        }
    }

    return NextResponse.json({ message: 'Upload successful and task created', taskId: insertedTask?.id, storagePath });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] /api/slack/intake: Error processing request:`, error instanceof Error ? error.message : String(error), error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 