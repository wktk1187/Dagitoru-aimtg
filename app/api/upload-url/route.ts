import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabaseのクライアント初期化 (環境変数からURLとanonキーを取得)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase URL or anon key environment variables for upload-url endpoint.');
  // サーバー起動時のエラーとして記録。リクエスト処理時にはnullチェックで対応。
}
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

// 内部API呼び出し認証用のシークレットキー (環境変数から取得)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const STORAGE_BUCKET_NAME = 'videos'; // Supabase Storageのバケット名
const SIGNED_URL_TTL = 60 * 30; // 署名付きURLの有効期間（秒）：30分

export async function POST(request: NextRequest) {
  console.log(`[${new Date().toISOString()}] /api/upload-url: POST request received.`);

  if (!supabase) {
    console.error(`[${new Date().toISOString()}] /api/upload-url: Supabase client is not initialized due to missing env vars.`);
    return NextResponse.json({ error: 'Server configuration error: Supabase client not available.' }, { status: 500 });
  }

  // 1. 認可チェック
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.substring(7) !== WEBHOOK_SECRET) {
    console.warn(`[${new Date().toISOString()}] /api/upload-url: Unauthorized access attempt.`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  console.log(`[${new Date().toISOString()}] /api/upload-url: Authorization successful.`);

  // 2. リクエストボディのパース
  let fileName: string;
  let contentType: string;
  try {
    const body = await request.json();
    fileName = body.fileName;
    contentType = body.contentType;
    if (!fileName || typeof fileName !== 'string' || !contentType || typeof contentType !== 'string') {
      throw new Error('Invalid request body: fileName and contentType are required and must be strings.');
    }

    // 追加：fileNameが.mp4で終わるかチェック
    if (!fileName.endsWith('.mp4')) {
      console.warn(`[${new Date().toISOString()}] /api/upload-url: Invalid fileName: ${fileName}. Only .mp4 files are accepted.`);
      return NextResponse.json({ error: 'Only .mp4 files are accepted (filename must end with .mp4)' }, { status: 400 });
    }

    // 追加：contentTypeがvideo/mp4かチェック
    if (contentType !== 'video/mp4') {
      console.warn(`[${new Date().toISOString()}] /api/upload-url: Invalid contentType: ${contentType}. Only video/mp4 is accepted.`);
      return NextResponse.json({ error: 'Only video/mp4 content type is accepted' }, { status: 400 });
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error parsing request body.';
    console.error(`[${new Date().toISOString()}] /api/upload-url: Error parsing request body: ${errorMessage}`);
    return NextResponse.json({ error: 'Invalid request body', details: errorMessage }, { status: 400 });
  }
  console.log(`[${new Date().toISOString()}] /api/upload-url: Parsed request body:`, { fileName, contentType });

  // 3. 署名付きアップロードURLの生成
  // storagePathの例: public/mtg-assets/videos/{task_id}/{fileName}
  // ここでは {task_id} の部分はまだないので、一旦ランダムなプレフィックスまたはfileNameのみでパスを生成する。
  // task_idはintake側で生成されるため、upload-url側ではファイル名の一意性を保つパスを生成する。
  // 例: videos/YYYY/MM/DD/uuid_or_timestamp_fileName
  const timestamp = Date.now();
  const uniqueFileName = `${timestamp}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storagePath = `videos/${uniqueFileName}`; // バケット直下のvideosフォルダに保存する例
                                              // 設計書の storagePath: "public/mtg-assets/videos/{task_id}/{fileName}" とは異なるので注意
                                              // ここはintake側で最終的なパスを決定し、DBに保存する。
                                              // upload-urlはあくまでアップロード先を一時的に提供する。

  try {
    console.log(`[${new Date().toISOString()}] /api/upload-url: Attempting to create signed upload URL for: ${storagePath}`);
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET_NAME)
      .createSignedUploadUrl(storagePath);

    if (error) {
      console.error(`[${new Date().toISOString()}] /api/upload-url: Supabase storage error (createSignedUploadUrl):`, error);
      return NextResponse.json({ error: 'Failed to create upload URL', details: error.message }, { status: 500 });
    }

    if (!data || !data.signedUrl) {
        console.error(`[${new Date().toISOString()}] /api/upload-url: Supabase storage did not return a signedUrl.`);
        return NextResponse.json({ error: 'Failed to obtain upload URL from storage provider'}, { status: 500 });
    }

    console.log(`[${new Date().toISOString()}] /api/upload-url: Signed upload URL created successfully for path: ${storagePath}`);
    return NextResponse.json({
      uploadUrl: data.signedUrl,
      storagePath: data.path, // Supabaseが返した実際のパス (createSignedUploadUrlの第一引数と同じはず)
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error.';
    console.error(`[${new Date().toISOString()}] /api/upload-url: Unexpected server error: ${errorMessage}`);
    return NextResponse.json({ error: 'Unexpected server error', details: errorMessage }, { status: 500 });
  }
} 