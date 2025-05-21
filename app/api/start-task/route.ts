import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 環境変数
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const CLOUD_RUN_TRANSCRIBE_URL = process.env.CLOUD_RUN_TRANSCRIBE_URL;
const GCS_BUCKET = process.env.GCS_BUCKET || 'transcription-audio';

// Supabaseクライアント初期化
let supabase: ReturnType<typeof createClient> | null = null;
if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.error('[start-task/route.ts] Missing Supabase URL or Service Role Key env vars.');
}

interface StartTaskPayload {
  taskId: string;
  slackFileUrl?: string;
}

export async function POST(request: NextRequest) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] >>> /api/start-task called`);
  
  // 1. Authorizationヘッダー検証
  const authHeader = request.headers.get('Authorization');
  if (!WEBHOOK_SECRET) {
    console.error(`[${timestamp}] /api/start-task: WEBHOOK_SECRET is not configured on the server.`);
    return NextResponse.json({ error: 'Internal Server Configuration Error: Webhook secret not set.' }, { status: 500 });
  }
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== WEBHOOK_SECRET) {
    console.warn(`[${timestamp}] /api/start-task: Unauthorized access attempt. Auth Header: '${authHeader}'`);
    return NextResponse.json({ error: 'Unauthorized: Invalid or missing token.' }, { status: 401 });
  }
  console.log(`[${timestamp}] /api/start-task: Authorization successful.`);

  // 2. Cloud Run URLの確認
  if (!CLOUD_RUN_TRANSCRIBE_URL) {
    console.error(`[${timestamp}] /api/start-task: CLOUD_RUN_TRANSCRIBE_URL is not configured.`);
    return NextResponse.json({ error: 'Server Configuration Error: Cloud Run URL not set.' }, { status: 500 });
  }

  // 3. リクエストボディのパース
  let payload: StartTaskPayload;
  try {
    payload = await request.json();
    console.log(`[${timestamp}] /api/start-task: Received payload:`, JSON.stringify(payload, null, 2));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown parsing error';
    console.error(`[${timestamp}] /api/start-task: JSON parse failed:`, errorMessage, err);
    return NextResponse.json({ error: 'Invalid JSON body', details: errorMessage }, { status: 400 });
  }

  // 4. 必須フィールドの検証
  const { taskId } = payload;
  if (!taskId) {
    console.error(`[${timestamp}] /api/start-task: Missing required fields in parsed payload.`);
    return NextResponse.json({ error: 'Missing required fields in payload' }, { status: 400 });
  }

  try {
    // 5. Supabaseからタスク情報の取得
    if (!supabase) {
      console.error(`[${timestamp}] /api/start-task: Supabase client not initialized.`);
      return NextResponse.json({ error: 'Server configuration error: Supabase client not available.' }, { status: 500 });
    }

    console.log(`[${timestamp}] /api/start-task: Fetching task info for taskId: ${taskId}`);
    const { data: taskData, error: taskError } = await supabase
      .from('transcription_tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (taskError) {
      console.error(`[${timestamp}] /api/start-task: Failed to fetch task data:`, taskError);
      return NextResponse.json({ error: 'Failed to fetch task data', details: taskError.message }, { status: 404 });
    }

    if (!taskData || !taskData.storage_path) {
      console.error(`[${timestamp}] /api/start-task: Task data missing or storage_path not found.`);
      return NextResponse.json({ error: 'Task data missing or invalid' }, { status: 400 });
    }

    // 6. ステータスを 'processing' に更新
    const { error: updateError } = await supabase
      .from('transcription_tasks')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', taskId);

    if (updateError) {
      console.error(`[${timestamp}] /api/start-task: Failed to update task status:`, updateError);
      return NextResponse.json({ error: 'Failed to update task status', details: updateError.message }, { status: 500 });
    }

    // 7. 動画ファイルへの署名付きURLを取得
    console.log(`[${timestamp}] /api/start-task: Getting signed URL for ${taskData.storage_path}`);
    const { data: signedUrlData, error: signedUrlError } = await supabase
      .storage
      .from('videos')
      .createSignedUrl(taskData.storage_path as string, { expiresIn: 60 * 30 }); // 30分有効

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error(`[${timestamp}] /api/start-task: Failed to get signed URL:`, signedUrlError);
      return NextResponse.json({ error: 'Failed to get signed URL', details: signedUrlError?.message || 'No signed URL returned' }, { status: 500 });
    }

    // 8. Cloud Runへの転送先パスを生成
    const gcsDestPath = `audio/${taskId}/${Date.now()}.mp3`;
    
    // 9. Cloud Runへ文字起こしリクエストを送信
    console.log(`[${timestamp}] /api/start-task: Sending transcription request to Cloud Run`);
    const cloudRunPayload = {
      signedUrl: signedUrlData.signedUrl,
      gcsBucket: GCS_BUCKET,
      gcsDestPath,
      taskId
    };
    
    const cloudRunResponse = await fetch(CLOUD_RUN_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cloudRunPayload)
    });

    if (!cloudRunResponse.ok) {
      const errorText = await cloudRunResponse.text();
      console.error(`[${timestamp}] /api/start-task: Cloud Run request failed:`, cloudRunResponse.status, errorText);
      
      // ステータスを 'error' に更新
      await supabase
        .from('transcription_tasks')
        .update({ 
          status: 'failed', 
          error_message: `Cloud Run request failed: ${cloudRunResponse.status} - ${errorText}`,
          updated_at: new Date().toISOString() 
        })
        .eq('id', taskId);
        
      return NextResponse.json({ 
        error: 'Cloud Run request failed', 
        details: errorText,
        status: cloudRunResponse.status 
      }, { status: 502 });
    }

    const cloudRunResult = await cloudRunResponse.json();
    console.log(`[${timestamp}] /api/start-task: Cloud Run request successful:`, JSON.stringify(cloudRunResult, null, 2));

    return NextResponse.json({
      message: 'Transcription task started successfully',
      taskId,
      status: 'processing'
    });

  } catch (error) {
    // 予期せぬエラーの処理
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown internal server error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`[${timestamp}] /api/start-task: Unhandled internal error:`, errorMessage, errorStack, error);
    
    // エラー発生時はタスクステータスを更新
    if (supabase && taskId) {
      await supabase
        .from('transcription_tasks')
        .update({ 
          status: 'failed', 
          error_message: errorMessage,
          updated_at: new Date().toISOString() 
        })
        .eq('id', taskId);
    }
    
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 