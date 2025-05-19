import { NextRequest, NextResponse } from 'npm:next/server';
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js';
import { GoogleGenerativeAI } from 'npm:@google/generative-ai';

// --- 環境変数 -----------------------------------------------------------------
const NEXT_PUBLIC_SUPABASE_URL = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // DB更新用にService Role Keyを推奨
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const NEXT_PUBLIC_APP_URL = Deno.env.get("NEXT_PUBLIC_APP_URL");

// --- 定数 -------------------------------------------------------------------
const MAX_TRANSCRIPT_TOKENS = 15000; // 仮の値。実際のGeminiのモデルに合わせて調整。

// --- Supabase クライアント初期化 -----------------------------------------------
let supabase: SupabaseClient | null = null;
if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false, // サーバーサイドの処理なのでセッション永続化は不要
      autoRefreshToken: false, // 自動トークンリフレッシュも不要
    }
  });
} else {
  console.error('[summarize-task/route.ts] Missing Supabase URL or Service Role Key env vars.');
}

// --- Gemini クライアント初期化 -------------------------------------------------
let genAI: GoogleGenerativeAI | null = null;
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
} else {
  console.error('[summarize-task/route.ts] Missing GEMINI_API_KEY env var.');
}

// --- 型定義 -------------------------------------------------------------------
interface SummarizeTaskPayload {
  taskId: string;
  transcript: string;
  // metadataはSupabaseから取得するので、リクエストペイロードには含めない設計とします。
  // もし呼び出し元がmetadataを渡す場合は、ここの型定義と処理を変更する必要があります。
}

interface TaskMetadata {
  consultant_name?: string;
  company_name?: string;
  company_type?: string;
  company_problem?: string;
  meeting_date?: string;
  meeting_count?: string | number; // DBの型に合わせて調整
  meeting_type?: string;
  support_area?: string;
  // company_phase, internal_sharing_items も必要に応じて追加
}

// --- メイン処理 -----------------------------------------------------------------
export async function POST(request: NextRequest) {
  console.log(`[${new Date().toISOString()}] /api/summarize-task: POST request received.`);

  // 1. 認可チェック (WEBHOOK_SECRET)
  const authHeader = request.headers.get('Authorization');
  if (!WEBHOOK_SECRET || !authHeader || !authHeader.startsWith('Bearer ') || authHeader.substring(7) !== WEBHOOK_SECRET) {
    console.warn(`[${new Date().toISOString()}] /api/summarize-task: Unauthorized access attempt.`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  console.log(`[${new Date().toISOString()}] /api/summarize-task: Authorization successful.`);

  // 2. SupabaseクライアントとGeminiクライアントの利用可能性チェック
  if (!supabase) {
    console.error(`[${new Date().toISOString()}] /api/summarize-task: Supabase client is not initialized.`);
    return NextResponse.json({ error: 'Server configuration error: Supabase client not available.' }, { status: 500 });
  }
  // Geminiクライアントは後続のフェーズでチェックするが、ここでも存在確認は可能
  if (!genAI) {
    console.error(`[${new Date().toISOString()}] /api/summarize-task: Gemini AI client is not initialized.`);
    return NextResponse.json({ error: 'Server configuration error: Gemini AI client not available.' }, { status: 500 });
  }

  // 3. リクエストボディのパース
  let payload: SummarizeTaskPayload;
  try {
    payload = await request.json();
    if (!payload.taskId || typeof payload.taskId !== 'string' || !payload.transcript || typeof payload.transcript !== 'string') {
      throw new Error('Invalid request body: taskId and transcript are required and must be strings.');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error parsing request body.';
    console.error(`[${new Date().toISOString()}] /api/summarize-task: Error parsing request body: ${errorMessage}`);
    return NextResponse.json({ error: 'Invalid request body', details: errorMessage }, { status: 400 });
  }
  const { taskId, transcript } = payload;
  console.log(`[${new Date().toISOString()}] /api/summarize-task: Parsed request for taskId: ${taskId}`);

  // 4. Supabaseからタスクのメタ情報を取得
  let taskMeta: TaskMetadata | null = null;
  try {
    const { data: metaData, error: metaError } = await supabase
      .from('transcription_tasks')
      .select('consultant_name, company_name, company_type, company_problem, meeting_date, meeting_count, meeting_type, support_area')
      .eq('id', taskId)
      .single();

    if (metaError) {
      if (metaError.code === 'PGRST116') { // PostgREST error code for "Not found"
        console.warn(`[${new Date().toISOString()}] /api/summarize-task: Task not found in DB for taskId: ${taskId}`);
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }
      throw metaError; // その他のDBエラー
    }
    taskMeta = metaData;
    console.log(`[${new Date().toISOString()}] /api/summarize-task: Successfully fetched metadata for taskId ${taskId}:`, taskMeta);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown DB error.';
    console.error(`[${new Date().toISOString()}] /api/summarize-task: Error fetching metadata from DB for taskId ${taskId}: ${errorMessage}`);
    return NextResponse.json({ error: 'Failed to fetch task metadata', details: errorMessage }, { status: 500 });
  }

  // 5. タスクステータスを 'summarizing' に更新
  try {
    const { error: updateError } = await supabase
      .from('transcription_tasks')
      .update({ status: 'summarizing', updated_at: new Date().toISOString() })
      .eq('id', taskId);

    if (updateError) {
      throw updateError;
    }
    console.log(`[${new Date().toISOString()}] /api/summarize-task: Successfully updated status to 'summarizing' for taskId: ${taskId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown DB error during status update.';
    console.error(`[${new Date().toISOString()}] /api/summarize-task: Error updating status to summarizing for taskId ${taskId}: ${errorMessage}`);
    // ここでリターンしても良いが、後続の処理でエラーが発生した場合の最終的なステータス更新もあるため、一旦処理を続けることも考えられる。
    // ただし、致命的な場合はリターンすべき。
    return NextResponse.json({ error: 'Failed to update task status', details: errorMessage }, { status: 500 });
  }

  // --- ここまでが初弾 --- 
  // この後、トランスクリプトの前処理、Gemini Phase 1-4の実行、結果保存、最終ステータス更新が続く

  console.log(`[${new Date().toISOString()}] /api/summarize-task: Initial processing complete for taskId: ${taskId}. Transcript length: ${transcript.length}`);
  console.log("Task Metadata:", taskMeta);

  // -------- トランスクリプトのトリミング -----------------------------
  // Geminiのトークン上限に合わせて部分文字列を取得（おおよそ1トークン=4文字と仮定）
  const approxCharLimit = MAX_TRANSCRIPT_TOKENS * 4;
  const trimmedTranscript = transcript.length > approxCharLimit
    ? transcript.slice(-approxCharLimit)
    : transcript;

  // -------- Gemini による各フェーズの処理 ----------------------------
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  const metaPrompt = (meta: TaskMetadata | null) => {
    if (!meta) return "";
    const entries = Object.entries(meta)
      .filter(([_, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n");
    return entries ? `以下はミーティングのメタ情報です:\n${entries}\n` : "";
  };

  type PhaseResult = {
    json: any;
    rawText: string;
  };

  const runPhase = async (phase: "phase1" | "phase2" | "phase3", meta: TaskMetadata | null, transcriptChunk: string): Promise<PhaseResult> => {
    let instruction = "";
    switch (phase) {
      case "phase1":
        instruction = `あなたは優秀な議事録作成アシスタントです。${metaPrompt(meta)}\n「議事の要点」を日本語で箇条書き（最大10項目）にまとめ、以下のJSON形式で返してください。\n{\n  \"key_points\": string[]\n}`;
        break;
      case "phase2":
        instruction = `あなたは優秀な議事録作成アシスタントです。${metaPrompt(meta)}\n以下の文字起こしを論理的な章立て（アジェンダ）に分割し、各章タイトルを生成してください。JSON形式:\n{\n  \"sections\": { \"title\": string, \"summary\": string }[]\n}`;
        break;
      case "phase3":
        instruction = `あなたは優秀な議事録作成アシスタントです。${metaPrompt(meta)}\n以下の文字起こしを話者ごとにまとめ、各話者ごとに発言要約を作成し、重要ポイントを抽出してください。JSON形式:\n{\n  \"speakers\": { \"name\": string, \"summary\": string }[]\n}`;
        break;
    }

    const prompt = `${instruction}\n--- 文字起こしここから ---\n${transcriptChunk}\n--- 文字起こしここまで ---`;

    try {
      const result = await model.generateContent(prompt);
      const raw = result.response.text();
      const firstJsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!firstJsonMatch) throw new Error("JSON not found in model output");
      const parsed = JSON.parse(firstJsonMatch[0]);
      return { json: parsed, rawText: raw };
    } catch (err) {
      console.error(`[summarize-task] ${phase} failed:`, err);
      throw new Error(`${phase}_failed`);
    }
  };

  let phase1: PhaseResult | null = null;
  let phase2: PhaseResult | null = null;
  let phase3: PhaseResult | null = null;

  try {
    [phase1, phase2, phase3] = await Promise.all([
      runPhase("phase1", taskMeta, trimmedTranscript),
      runPhase("phase2", taskMeta, trimmedTranscript),
      runPhase("phase3", taskMeta, trimmedTranscript),
    ]);
    console.log(`[summarize-task] Phase1-3 completed for taskId ${taskId}`);
  } catch (e) {
    // いずれかのフェーズで失敗
    const errMsg = e instanceof Error ? e.message : String(e);
    await supabase.from('transcription_tasks').update({ status: 'summarize_failed', updated_at: new Date().toISOString() }).eq('id', taskId);
    return NextResponse.json({ error: 'Summarization failed', details: errMsg }, { status: 500 });
  }

  // -------- Phase4: 統合 -----------------------------------------------
  let finalSummary = "";
  try {
    const consolidationPrompt = `あなたはプロのコンサルタントです。与えられたフェーズ1-3の結果をもとに、ミーティング議事録を日本語で1000字以内のMarkdownにまとめてください。\n\n## メタ情報\n${metaPrompt(taskMeta)}\n\n## フェーズ1 要点\n${JSON.stringify(phase1.json)}\n\n## フェーズ2 章立て\n${JSON.stringify(phase2.json)}\n\n## フェーズ3 話者別まとめ\n${JSON.stringify(phase3.json)}\n\n## 出力フォーマット\n- タイトル行として \"# 議事メモ\" を含める\n- 適切なMarkdown見出しを用いる\n- 1000字以内に収める`;

    const phase4Res = await model.generateContent(consolidationPrompt);
    finalSummary = phase4Res.response.text();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[summarize-task] Phase4 failed:`, errMsg);
    await supabase.from('transcription_tasks').update({ status: 'summarize_failed', updated_at: new Date().toISOString() }).eq('id', taskId);
    return NextResponse.json({ error: 'Final summary generation failed', details: errMsg }, { status: 500 });
  }

  // -------- Supabase への保存 ---------------------------------------------
  try {
    const { error: saveError } = await supabase.from('transcription_tasks').update({
      phase1_output: phase1.json,
      phase2_output: phase2.json,
      phase3_output: phase3.json,
      final_summary: finalSummary,
      status: 'completed',
      updated_at: new Date().toISOString(),
    }).eq('id', taskId);

    if (saveError) throw saveError;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown DB error';
    console.error(`[summarize-task] DB save failed for taskId ${taskId}:`, errMsg);
    await supabase.from('transcription_tasks').update({ status: 'summarize_failed', updated_at: new Date().toISOString() }).eq('id', taskId);
    return NextResponse.json({ error: 'Failed to save summary', details: errMsg }, { status: 500 });
  }

  // -------- 完了 -----------------------------------------------------------
  console.log(`[summarize-task] All phases completed for taskId ${taskId}`);
  return NextResponse.json({
    message: 'Summarization completed',
    taskId,
    phase1: phase1.json,
    phase2: phase2.json,
    phase3: phase3.json,
    finalSummary,
  });

  // -------- Notion 連携を非同期で呼び出し -------------------------------
  try {
    if (NEXT_PUBLIC_APP_URL && WEBHOOK_SECRET) {
      fetch(`${NEXT_PUBLIC_APP_URL}/api/notion-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WEBHOOK_SECRET}`,
        },
        body: JSON.stringify({ taskId }),
      }).then(res => res.text()).then(txt => console.log(`[summarize-task] notion-sync response:`, txt)).catch(err => console.error(`[summarize-task] notion-sync fetch error:`, err));
    } else {
      console.warn('[summarize-task] NEXT_PUBLIC_APP_URL or WEBHOOK_SECRET not set; skipping notion-sync call.');
    }
  } catch (err) {
    console.error('[summarize-task] Error triggering notion-sync:', err);
  }
} 