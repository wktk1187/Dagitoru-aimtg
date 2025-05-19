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
  // ここでsupabaseがnullの場合、後続の処理でエラーになるため、早期リターンやデフォルトの動作を検討する必要があるかもしれません。
  // ただし、現状のコードではDB操作前にnullチェックがあるので、致命的ではないかもしれません。
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
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] >>> /api/slack/intake called`);
  
  // 1. Authorizationヘッダー検証
  const authHeader = request.headers.get('Authorization');
  if (!WEBHOOK_SECRET) {
    console.error(`[${timestamp}] /api/slack/intake: WEBHOOK_SECRET is not configured on the server.`);
    // WEBHOOK_SECRET が設定されていないのは致命的なサーバー設定エラー
    return NextResponse.json({ error: 'Internal Server Configuration Error: Webhook secret not set.' }, { status: 500 });
  }
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== WEBHOOK_SECRET) {
    console.warn(`[${timestamp}] /api/slack/intake: Unauthorized access attempt. Auth Header: '${authHeader}'`);
    return NextResponse.json({ error: 'Unauthorized: Invalid or missing token.' }, { status: 401 });
  }
  console.log(`[${timestamp}] /api/slack/intake: Authorization successful.`);

  // 2. リクエストボディのパース
  let payload: IntakePayload;
  try {
    payload = await request.json();
    console.log(`[${timestamp}] /api/slack/intake: Received payload:`, JSON.stringify(payload, null, 2));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown parsing error';
    console.error(`[${timestamp}] /api/slack/intake: JSON parse failed:`, errorMessage, err);
    return NextResponse.json({ error: 'Invalid JSON body', details: errorMessage }, { status: 400 });
  }

  // 3. 必須フィールドの検証 (ペイロードパース後)
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
    console.error(`[${timestamp}] /api/slack/intake: Missing required fields in parsed payload. Payload:`, payload);
    return NextResponse.json({ error: 'Missing required fields in payload' }, { status: 400 });
  }
  
  // 4. ファイルタイプチェック (ビデオファイルのみ処理)
  if (!mimetype.startsWith('video/')) {
      console.warn(`[${timestamp}] /api/slack/intake: Received non-video file type: ${mimetype} for file ${original_file_name}. Skipping.`);
      return NextResponse.json({ message: 'Non-video file type, processing skipped.' }, { status: 200 }); 
  }

  // --- ここからメイン処理 (try-catchで全体を囲むことも検討) ---
  try {
    // 5. Supabase Storageへのアップロード用署名付きURLの取得
    if (!NEXT_PUBLIC_APP_URL) {
      console.error(`[${timestamp}] /api/slack/intake: Missing NEXT_PUBLIC_APP_URL for internal API call to /api/upload-url.`);
      // これはサーバー設定エラーなので500を返す
      return NextResponse.json({ error: 'Server configuration error: App URL not set.' }, { status: 500 });
    }
    console.log(`[${timestamp}] /api/slack/intake: Requesting upload URL from ${NEXT_PUBLIC_APP_URL}/api/upload-url.`);
    const uploadUrlResponse = await fetch(`${NEXT_PUBLIC_APP_URL}/api/upload-url`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WEBHOOK_SECRET}`, // /api/upload-url も同じシークレットで保護
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileName: original_file_name, contentType: mimetype }),
    });

    if (!uploadUrlResponse.ok) {
      const errorBody = await uploadUrlResponse.text();
      console.error(`[${timestamp}] /api/slack/intake: Failed to get upload URL from /api/upload-url. Status: ${uploadUrlResponse.status}, Body: ${errorBody}`);
      return NextResponse.json({ error: 'Failed to get upload URL', details: errorBody }, { status: uploadUrlResponse.status });
    }

    const { uploadUrl, storagePath } = await uploadUrlResponse.json();
    if (!uploadUrl || !storagePath) {
        console.error(`[${timestamp}] /api/slack/intake: Invalid response from /api/upload-url. Missing uploadUrl or storagePath. Response:`, {uploadUrl, storagePath});
        return NextResponse.json({ error: 'Invalid response from upload URL service' }, { status: 500 });
    }
    console.log(`[${timestamp}] /api/slack/intake: Received uploadUrl: ${uploadUrl}, storagePath: ${storagePath}`);

    // 6. Slackからのファイルダウンロード
    console.log(`[${timestamp}] /api/slack/intake: Fetching file from Slack: ${slack_download_url}`);
    if (!SLACK_BOT_TOKEN) {
      console.error(`[${timestamp}] /api/slack/intake: SLACK_BOT_TOKEN is not set. Cannot download from Slack.`);
      return NextResponse.json({ error: 'Server configuration error: SLACK_BOT_TOKEN missing' }, { status: 500 });
    }
    const slackRes = await fetch(slack_download_url, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });

    if (!slackRes.ok || !slackRes.body) {
      const errorBody = await slackRes.text();
      console.error(`[${timestamp}] /api/slack/intake: Failed to download Slack file. Status: ${slackRes.status}, Body: ${errorBody}`);
      // TODO: この時点で transcription_tasks にエラーを記録することも検討 (status: 'download_failed')
      return NextResponse.json({ error: 'Failed to download Slack file', details: errorBody }, { status: slackRes.status });
    }
    console.log(`[${timestamp}] /api/slack/intake: Successfully fetched file stream from Slack.`);

    // 7. Supabase Storageへのアップロード
    console.log(`[${timestamp}] /api/slack/intake: Streaming upload to Supabase: ${uploadUrl}`);
    const supabaseUploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimetype,
      },
      body: slackRes.body,
      duplex: 'half',
    } as any);

    if (!supabaseUploadRes.ok) {
      const errorBody = await supabaseUploadRes.text();
      console.error(`[${timestamp}] /api/slack/intake: Failed to upload to Supabase. Status: ${supabaseUploadRes.status}, Body: ${errorBody}`);
      // TODO: この時点で transcription_tasks にエラーを記録することも検討 (status: 'upload_failed')
      return NextResponse.json({ error: 'Failed to upload to Supabase', details: errorBody }, { status: supabaseUploadRes.status });
    }
    console.log(`[${timestamp}] /api/slack/intake: Successfully uploaded to Supabase. Path: ${storagePath}`);

    // 8. Supabaseデータベースへのタスク記録
    if (!supabase) {
      console.error(`[${timestamp}] /api/slack/intake: Supabase client not initialized. Cannot insert task to DB.`);
      return NextResponse.json({ error: 'Server configuration error: Supabase client not available.' }, { status: 500 });
    }
    
    const taskData = {
      original_file_name: original_file_name,
      mimetype: mimetype,
      filetype: filetype,
      slack_file_id: slackFileId,
      slack_download_url: slack_download_url,
      slack_user_id: slack_user_id,
      slack_channel_id: slack_channel_id, // 追加
      slack_team_id: slack_team_id, // 追加
      slack_event_ts: slack_event_ts, // 追加
      storage_path: storagePath,
      status: 'uploaded', // トリガーが期待するステータス
      consultant_name: metadata.consultant_name ?? null,
      client_name: metadata.client_name ?? null, 
      company_type: metadata.company_type ?? null,
      company_problem: metadata.company_problem ?? null, 
      meeting_date: metadata.meeting_date ? new Date(metadata.meeting_date).toISOString().split('T')[0] : null, // YYYY-MM-DD形式
      meeting_count: metadata.meeting_count ? parseInt(metadata.meeting_count, 10) : null,
      meeting_type: metadata.meeting_type ?? null,
      support_area: metadata.support_area ?? null,
      company_phase: metadata.company_phase ?? null,
      internal_sharing_items: metadata.internal_sharing_items ?? null,
    };
    console.log(`[${timestamp}] /api/slack/intake: Inserting task into DB 'transcription_tasks':`, JSON.stringify(taskData, null, 2));
    const { data: insertedTask, error: dbInsertError } = await supabase
      .from('transcription_tasks')
      .insert(taskData)
      .select()
      .single();

    if (dbInsertError) {
      console.error(`[${timestamp}] /api/slack/intake: Failed to insert task to DB 'transcription_tasks':`, dbInsertError);
      return NextResponse.json({ error: 'DB insert failed for transcription_tasks', details: dbInsertError.message }, { status: 500 });
    }
    console.log(`[${timestamp}] /api/slack/intake: Task inserted to DB 'transcription_tasks' successfully. Task ID: ${insertedTask?.id}`);

    // 9. `upload_logs` テーブルへの記録 (オプション)
    if (insertedTask?.id) {
        const uploadLogData = {
            task_id: insertedTask.id,
            slack_file_id: slackFileId,
            status: 'success', // intake処理全体の成功を示す
            original_file_name: original_file_name,
            storage_path: storagePath,
            details: 'Successfully processed by /api/slack/intake'
        };
        console.log(`[${timestamp}] /api/slack/intake: Inserting into 'upload_logs':`, JSON.stringify(uploadLogData, null, 2));
        const { error: uploadLogError } = await supabase.from('upload_logs').insert(uploadLogData);
        if (uploadLogError) {
            console.error(`[${timestamp}] /api/slack/intake: Failed to insert into 'upload_logs':`, uploadLogError);
            // upload_logsへの書き込み失敗は intake の主処理の成否に影響しないため、エラーレスポンスは返さない
        }
    }

    return NextResponse.json({ message: 'Upload successful and task created', taskId: insertedTask?.id, storagePath });

  } catch (error) {
    // このcatchは主に予期せぬ内部エラー (上記で個別に処理されなかったもの) を捕捉
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown internal server error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`[${timestamp}] /api/slack/intake: Unhandled internal error:`, errorMessage, errorStack, error);
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 