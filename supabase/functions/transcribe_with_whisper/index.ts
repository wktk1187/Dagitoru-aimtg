import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// 環境変数からSupabaseの情報を取得
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
// const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const openaiApiKey = Deno.env.get("OPENAI_API_KEY")!;

interface TaskPayloadRecord {
  id: string;
  storage_path: string;
  status?: string; // old_record には status がある想定
  // 他のtaskのプロパティも必要に応じて追加
}
interface TaskPayload {
  type: "UPDATE";
  table: string;
  schema: string;
  record: TaskPayloadRecord;
  old_record: TaskPayloadRecord;
}

async function updateTaskStatus(supabase: SupabaseClient, taskId: string, status: string, transcription_result?: string) {
  const updateData: { status: string; transcription_result?: string; updated_at: string } = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (transcription_result) {
    updateData.transcription_result = transcription_result;
  }

  const { error: updateError } = await supabase
    .from("transcription_tasks")
    .update(updateData)
    .eq("id", taskId);

  if (updateError) {
    console.error(`Error updating task ${taskId} to status ${status}:`, updateError);
  } else {
    console.log(`Task ${taskId} status successfully updated to ${status}.`);
  }
}

serve(async (req: Request) => {
  console.log("Function transcribe_with_whisper called");

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let taskIdForErrorHandling: string | undefined;

  try {
    const payload: TaskPayload = await req.json();
    console.log("Received payload:", JSON.stringify(payload, null, 2));

    const { id: taskId, storage_path: storagePath } = payload.record;
    taskIdForErrorHandling = taskId; // エラーハンドリング用に保持

    if (!taskId || !storagePath) {
      console.error("Missing taskId or storage_path in payload");
      return new Response("Missing taskId or storage_path", { status: 400 });
    }

    console.log(`Processing task ID: ${taskId}, Storage Path: ${storagePath}`);

    // const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: {
        // headers: { Authorization: `Bearer ${supabaseAnonKey}` }, 
        headers: { Authorization: `Bearer ${supabaseServiceRoleKey}` },
      },
    });

    // 1. Supabase Storageからファイルを取得 (ArrayBuffer)
    console.log(`Fetching file from Supabase Storage: ${storagePath}`);
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("videos") // tasksテーブルのstorage_pathに合わせてバケット名を指定
      .download(storagePath);

    if (downloadError || !fileData) {
      console.error("Error downloading file:", downloadError);
      await updateTaskStatus(supabase, taskId, "transcribe_failed", `Error downloading file: ${downloadError?.message}`);
      return new Response(`Failed to download file: ${downloadError?.message}`, { status: 500 });
    }
    console.log("File downloaded successfully.");
    const fileArrayBuffer = await fileData.arrayBuffer();

    // 2. FormDataの構築 (Denoでの対応)
    const { File } = await import("https://deno.land/x/formdata_polyfill@v4.0.12/mod.ts");

    // 1. ファイル名とMIMEタイプ推定
    const fileName = storagePath.split("/").pop() || "audio.unknown"; // デフォルトファイル名を設定
    const getMimeType = (name: string): string => {
      if (name.endsWith(".mp3")) return "audio/mpeg";
      if (name.endsWith(".mp4")) return "video/mp4"; // Whisperはmp4も可
      if (name.endsWith(".mpeg")) return "video/mpeg";
      if (name.endsWith(".mpga")) return "audio/mpeg";
      if (name.endsWith(".m4a")) return "audio/mp4";
      if (name.endsWith(".wav")) return "audio/wav";
      if (name.endsWith(".webm")) return "video/webm";
      // 必要に応じて他のMIMEタイプを追加
      console.warn(`Unknown file type for ${name}, defaulting to application/octet-stream`);
      return "application/octet-stream"; // 不明な場合は汎用的なMIMEタイプ
    };
    const mimeType = getMimeType(fileName);
    console.log(`Determined fileName: ${fileName}, mimeType: ${mimeType}`);

    // 2. Fileオブジェクトの作成
    const file = new File([fileArrayBuffer], fileName, { type: mimeType });

    // 3. FormDataの構築
    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", "whisper-1");
    // formData.append("language", "ja"); // 必要に応じて言語指定
    // formData.append("prompt", "こんにちは。"); // 必要に応じてプロンプト追加
    // formData.append("response_format", "json"); // verbose_jsonやsrtなども指定可能
    // formData.append("temperature", "0"); // 0-1で指定、高いほどランダム

    console.log("FormData constructed successfully.");


    // 3. OpenAI Whisper APIに送信
    console.log(`Sending data to OpenAI Whisper API for task: ${taskId}`);
    const whisperApiUrl = "https://api.openai.com/v1/audio/transcriptions";
    
    let whisperResponse;
    try {
      whisperResponse = await fetch(whisperApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          // 'Content-Type': 'multipart/form-data' はfetchが自動で設定する (boundary含む)
        },
        body: formData,
      });
    } catch (e) {
      const fetchError = e as Error; // 型アサーション
      console.error(`[${taskId}] Fetch error calling Whisper API:`, fetchError);
      await updateTaskStatus(supabase, taskId, "transcribe_failed", `Fetch error: ${fetchError.message ? fetchError.message.slice(0,300) : 'Unknown fetch error'}`);
      return new Response(`Whisper API fetch error: ${fetchError.message || 'Unknown fetch error'}`, { status: 500 });
    }
    

    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error(`[${taskId}] Whisper API Error: ${whisperResponse.status}`, errorText);
      // エラーメッセージが長すぎる場合があるので、DBには一部を保存
      const dbErrorMessage = `Whisper API Error ${whisperResponse.status}: ${errorText.slice(0, 250)}`;
      await updateTaskStatus(supabase, taskId, "transcribe_failed", dbErrorMessage);
      return new Response(`Whisper API failed: ${errorText}`, { status: whisperResponse.status });
    }

    const result = await whisperResponse.json();
    const transcribedText = result.text || ""; // APIレスポンスにtextフィールドが存在しない場合も考慮
    
    if (typeof transcribedText !== 'string' || transcribedText.trim() === "") {
        console.warn(`[${taskId}] Whisper API returned empty or invalid text. Result:`, JSON.stringify(result));
        await updateTaskStatus(supabase, taskId, "transcribe_failed", "Whisper API returned empty or invalid text.");
        return new Response("Whisper API returned empty or invalid text.", { status: 500 });
    }

    console.log(`[${taskId}] Transcription success (first 100 chars):`, transcribedText.slice(0, 100));

    // 4. タスクを更新 (transcription_result と status)
    await updateTaskStatus(supabase, taskId, "transcribed", transcribedText);
    console.log(`Task ${taskId} status updated to transcribed.`);

    return new Response(JSON.stringify({ message: "Transcription successful", taskId, transcribedText: transcribedText.slice(0,100) + "..." }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (e) {
    const error = e as Error;
    console.error("Error in function:", error);
    if (taskIdForErrorHandling) {
      // const supabase = createClient(supabaseUrl, supabaseAnonKey); // 再初期化
      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey); // 再初期化時もservice_role_keyを使用
      await updateTaskStatus(supabase, taskIdForErrorHandling, "transcribe_failed", `Function error: ${error.message}`);
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}); 