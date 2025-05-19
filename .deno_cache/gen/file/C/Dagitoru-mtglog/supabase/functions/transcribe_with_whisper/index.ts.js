import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// 環境変数からSupabaseの情報を取得
const supabaseUrl = Deno.env.get("SUPABASE_URL");
// const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
async function updateTaskStatus(supabase, taskId, status, transcription_result) {
  const updateData = {
    status,
    updated_at: new Date().toISOString()
  };
  if (transcription_result) {
    updateData.transcription_result = transcription_result;
  }
  const { error: updateError } = await supabase.from("transcription_tasks").update(updateData).eq("id", taskId);
  if (updateError) {
    console.error(`Error updating task ${taskId} to status ${status}:`, updateError);
  } else {
    console.log(`Task ${taskId} status successfully updated to ${status}.`);
  }
}
serve(async (req)=>{
  console.log("Function transcribe_with_whisper called");
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405
    });
  }
  let taskIdForErrorHandling;
  try {
    const payload = await req.json();
    console.log("Received payload:", JSON.stringify(payload, null, 2));
    const { id: taskId, storage_path: storagePath } = payload.record;
    taskIdForErrorHandling = taskId; // エラーハンドリング用に保持
    if (!taskId || !storagePath) {
      console.error("Missing taskId or storage_path in payload");
      return new Response("Missing taskId or storage_path", {
        status: 400
      });
    }
    console.log(`Processing task ID: ${taskId}, Storage Path: ${storagePath}`);
    // const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: {
        // headers: { Authorization: `Bearer ${supabaseAnonKey}` }, 
        headers: {
          Authorization: `Bearer ${supabaseServiceRoleKey}`
        }
      }
    });
    // 1. Supabase Storageからファイルを取得 (ArrayBuffer)
    console.log(`Fetching file from Supabase Storage: ${storagePath}`);
    const { data: fileData, error: downloadError } = await supabase.storage.from("videos") // tasksテーブルのstorage_pathに合わせてバケット名を指定
    .download(storagePath);
    if (downloadError || !fileData) {
      console.error("Error downloading file:", downloadError);
      await updateTaskStatus(supabase, taskId, "transcribe_failed", `Error downloading file: ${downloadError?.message}`);
      return new Response(`Failed to download file: ${downloadError?.message}`, {
        status: 500
      });
    }
    console.log("File downloaded successfully.");
    const fileArrayBuffer = await fileData.arrayBuffer();
    // 2. FormDataの構築 (Denoでの対応)
    const { File } = await import("https://deno.land/x/formdata_polyfill@v4.0.12/mod.ts");
    // 1. ファイル名とMIMEタイプ推定
    const fileName = storagePath.split("/").pop() || "audio.unknown"; // デフォルトファイル名を設定
    const getMimeType = (name)=>{
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
    const file = new File([
      fileArrayBuffer
    ], fileName, {
      type: mimeType
    });
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
          Authorization: `Bearer ${openaiApiKey}`
        },
        body: formData
      });
    } catch (e) {
      const fetchError = e; // 型アサーション
      console.error(`[${taskId}] Fetch error calling Whisper API:`, fetchError);
      await updateTaskStatus(supabase, taskId, "transcribe_failed", `Fetch error: ${fetchError.message ? fetchError.message.slice(0, 300) : 'Unknown fetch error'}`);
      return new Response(`Whisper API fetch error: ${fetchError.message || 'Unknown fetch error'}`, {
        status: 500
      });
    }
    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error(`[${taskId}] Whisper API Error: ${whisperResponse.status}`, errorText);
      // エラーメッセージが長すぎる場合があるので、DBには一部を保存
      const dbErrorMessage = `Whisper API Error ${whisperResponse.status}: ${errorText.slice(0, 250)}`;
      await updateTaskStatus(supabase, taskId, "transcribe_failed", dbErrorMessage);
      return new Response(`Whisper API failed: ${errorText}`, {
        status: whisperResponse.status
      });
    }
    const result = await whisperResponse.json();
    const transcribedText = result.text || ""; // APIレスポンスにtextフィールドが存在しない場合も考慮
    if (typeof transcribedText !== 'string' || transcribedText.trim() === "") {
      console.warn(`[${taskId}] Whisper API returned empty or invalid text. Result:`, JSON.stringify(result));
      await updateTaskStatus(supabase, taskId, "transcribe_failed", "Whisper API returned empty or invalid text.");
      return new Response("Whisper API returned empty or invalid text.", {
        status: 500
      });
    }
    console.log(`[${taskId}] Transcription success (first 100 chars):`, transcribedText.slice(0, 100));
    // 4. タスクを更新 (transcription_result と status)
    await updateTaskStatus(supabase, taskId, "transcribed", transcribedText);
    console.log(`Task ${taskId} status updated to transcribed.`);
    return new Response(JSON.stringify({
      message: "Transcription successful",
      taskId,
      transcribedText: transcribedText.slice(0, 100) + "..."
    }), {
      headers: {
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (e) {
    const error = e;
    console.error("Error in function:", error);
    if (taskIdForErrorHandling) {
      // const supabase = createClient(supabaseUrl, supabaseAnonKey); // 再初期化
      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey); // 再初期化時もservice_role_keyを使用
      await updateTaskStatus(supabase, taskIdForErrorHandling, "transcribe_failed", `Function error: ${error.message}`);
    }
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500
    });
  }
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImZpbGU6Ly8vQzovRGFnaXRvcnUtbXRnbG9nL3N1cGFiYXNlL2Z1bmN0aW9ucy90cmFuc2NyaWJlX3dpdGhfd2hpc3Blci9pbmRleC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBzZXJ2ZSB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAMC4xNzcuMC9odHRwL3NlcnZlci50c1wiO1xyXG5pbXBvcnQgeyBjcmVhdGVDbGllbnQsIFN1cGFiYXNlQ2xpZW50IH0gZnJvbSBcImh0dHBzOi8vZXNtLnNoL0BzdXBhYmFzZS9zdXBhYmFzZS1qc0AyXCI7XHJcblxyXG4vLyDnkrDlooPlpInmlbDjgYvjgolTdXBhYmFzZeOBruaDheWgseOCkuWPluW+l1xyXG5jb25zdCBzdXBhYmFzZVVybCA9IERlbm8uZW52LmdldChcIlNVUEFCQVNFX1VSTFwiKSE7XHJcbi8vIGNvbnN0IHN1cGFiYXNlQW5vbktleSA9IERlbm8uZW52LmdldChcIlNVUEFCQVNFX0FOT05fS0VZXCIpITtcclxuY29uc3Qgc3VwYWJhc2VTZXJ2aWNlUm9sZUtleSA9IERlbm8uZW52LmdldChcIlNVUEFCQVNFX1NFUlZJQ0VfUk9MRV9LRVlcIikhO1xyXG5jb25zdCBvcGVuYWlBcGlLZXkgPSBEZW5vLmVudi5nZXQoXCJPUEVOQUlfQVBJX0tFWVwiKSE7XHJcblxyXG5pbnRlcmZhY2UgVGFza1BheWxvYWRSZWNvcmQge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgc3RvcmFnZV9wYXRoOiBzdHJpbmc7XHJcbiAgc3RhdHVzPzogc3RyaW5nOyAvLyBvbGRfcmVjb3JkIOOBq+OBryBzdGF0dXMg44GM44GC44KL5oOz5a6aXHJcbiAgLy8g5LuW44GudGFza+OBruODl+ODreODkeODhuOCo+OCguW/heimgeOBq+W/nOOBmOOBpui/veWKoFxyXG59XHJcbmludGVyZmFjZSBUYXNrUGF5bG9hZCB7XHJcbiAgdHlwZTogXCJVUERBVEVcIjtcclxuICB0YWJsZTogc3RyaW5nO1xyXG4gIHNjaGVtYTogc3RyaW5nO1xyXG4gIHJlY29yZDogVGFza1BheWxvYWRSZWNvcmQ7XHJcbiAgb2xkX3JlY29yZDogVGFza1BheWxvYWRSZWNvcmQ7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZVRhc2tTdGF0dXMoc3VwYWJhc2U6IFN1cGFiYXNlQ2xpZW50LCB0YXNrSWQ6IHN0cmluZywgc3RhdHVzOiBzdHJpbmcsIHRyYW5zY3JpcHRpb25fcmVzdWx0Pzogc3RyaW5nKSB7XHJcbiAgY29uc3QgdXBkYXRlRGF0YTogeyBzdGF0dXM6IHN0cmluZzsgdHJhbnNjcmlwdGlvbl9yZXN1bHQ/OiBzdHJpbmc7IHVwZGF0ZWRfYXQ6IHN0cmluZyB9ID0ge1xyXG4gICAgc3RhdHVzLFxyXG4gICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gIH07XHJcbiAgaWYgKHRyYW5zY3JpcHRpb25fcmVzdWx0KSB7XHJcbiAgICB1cGRhdGVEYXRhLnRyYW5zY3JpcHRpb25fcmVzdWx0ID0gdHJhbnNjcmlwdGlvbl9yZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBjb25zdCB7IGVycm9yOiB1cGRhdGVFcnJvciB9ID0gYXdhaXQgc3VwYWJhc2VcclxuICAgIC5mcm9tKFwidHJhbnNjcmlwdGlvbl90YXNrc1wiKVxyXG4gICAgLnVwZGF0ZSh1cGRhdGVEYXRhKVxyXG4gICAgLmVxKFwiaWRcIiwgdGFza0lkKTtcclxuXHJcbiAgaWYgKHVwZGF0ZUVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKGBFcnJvciB1cGRhdGluZyB0YXNrICR7dGFza0lkfSB0byBzdGF0dXMgJHtzdGF0dXN9OmAsIHVwZGF0ZUVycm9yKTtcclxuICB9IGVsc2Uge1xyXG4gICAgY29uc29sZS5sb2coYFRhc2sgJHt0YXNrSWR9IHN0YXR1cyBzdWNjZXNzZnVsbHkgdXBkYXRlZCB0byAke3N0YXR1c30uYCk7XHJcbiAgfVxyXG59XHJcblxyXG5zZXJ2ZShhc3luYyAocmVxOiBSZXF1ZXN0KSA9PiB7XHJcbiAgY29uc29sZS5sb2coXCJGdW5jdGlvbiB0cmFuc2NyaWJlX3dpdGhfd2hpc3BlciBjYWxsZWRcIik7XHJcblxyXG4gIGlmIChyZXEubWV0aG9kICE9PSBcIlBPU1RcIikge1xyXG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShcIk1ldGhvZCBOb3QgQWxsb3dlZFwiLCB7IHN0YXR1czogNDA1IH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IHRhc2tJZEZvckVycm9ySGFuZGxpbmc6IHN0cmluZyB8IHVuZGVmaW5lZDtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHBheWxvYWQ6IFRhc2tQYXlsb2FkID0gYXdhaXQgcmVxLmpzb24oKTtcclxuICAgIGNvbnNvbGUubG9nKFwiUmVjZWl2ZWQgcGF5bG9hZDpcIiwgSlNPTi5zdHJpbmdpZnkocGF5bG9hZCwgbnVsbCwgMikpO1xyXG5cclxuICAgIGNvbnN0IHsgaWQ6IHRhc2tJZCwgc3RvcmFnZV9wYXRoOiBzdG9yYWdlUGF0aCB9ID0gcGF5bG9hZC5yZWNvcmQ7XHJcbiAgICB0YXNrSWRGb3JFcnJvckhhbmRsaW5nID0gdGFza0lkOyAvLyDjgqjjg6njg7zjg4/jg7Pjg4njg6rjg7PjgrDnlKjjgavkv53mjIFcclxuXHJcbiAgICBpZiAoIXRhc2tJZCB8fCAhc3RvcmFnZVBhdGgpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihcIk1pc3NpbmcgdGFza0lkIG9yIHN0b3JhZ2VfcGF0aCBpbiBwYXlsb2FkXCIpO1xyXG4gICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKFwiTWlzc2luZyB0YXNrSWQgb3Igc3RvcmFnZV9wYXRoXCIsIHsgc3RhdHVzOiA0MDAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5sb2coYFByb2Nlc3NpbmcgdGFzayBJRDogJHt0YXNrSWR9LCBTdG9yYWdlIFBhdGg6ICR7c3RvcmFnZVBhdGh9YCk7XHJcblxyXG4gICAgLy8gY29uc3Qgc3VwYWJhc2UgPSBjcmVhdGVDbGllbnQoc3VwYWJhc2VVcmwsIHN1cGFiYXNlQW5vbktleSwge1xyXG4gICAgY29uc3Qgc3VwYWJhc2UgPSBjcmVhdGVDbGllbnQoc3VwYWJhc2VVcmwsIHN1cGFiYXNlU2VydmljZVJvbGVLZXksIHtcclxuICAgICAgZ2xvYmFsOiB7XHJcbiAgICAgICAgLy8gaGVhZGVyczogeyBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7c3VwYWJhc2VBbm9uS2V5fWAgfSwgXHJcbiAgICAgICAgaGVhZGVyczogeyBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7c3VwYWJhc2VTZXJ2aWNlUm9sZUtleX1gIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAxLiBTdXBhYmFzZSBTdG9yYWdl44GL44KJ44OV44Kh44Kk44Or44KS5Y+W5b6XIChBcnJheUJ1ZmZlcilcclxuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyBmaWxlIGZyb20gU3VwYWJhc2UgU3RvcmFnZTogJHtzdG9yYWdlUGF0aH1gKTtcclxuICAgIGNvbnN0IHsgZGF0YTogZmlsZURhdGEsIGVycm9yOiBkb3dubG9hZEVycm9yIH0gPSBhd2FpdCBzdXBhYmFzZS5zdG9yYWdlXHJcbiAgICAgIC5mcm9tKFwidmlkZW9zXCIpIC8vIHRhc2tz44OG44O844OW44Or44Guc3RvcmFnZV9wYXRo44Gr5ZCI44KP44Gb44Gm44OQ44Kx44OD44OI5ZCN44KS5oyH5a6aXHJcbiAgICAgIC5kb3dubG9hZChzdG9yYWdlUGF0aCk7XHJcblxyXG4gICAgaWYgKGRvd25sb2FkRXJyb3IgfHwgIWZpbGVEYXRhKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBkb3dubG9hZGluZyBmaWxlOlwiLCBkb3dubG9hZEVycm9yKTtcclxuICAgICAgYXdhaXQgdXBkYXRlVGFza1N0YXR1cyhzdXBhYmFzZSwgdGFza0lkLCBcInRyYW5zY3JpYmVfZmFpbGVkXCIsIGBFcnJvciBkb3dubG9hZGluZyBmaWxlOiAke2Rvd25sb2FkRXJyb3I/Lm1lc3NhZ2V9YCk7XHJcbiAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoYEZhaWxlZCB0byBkb3dubG9hZCBmaWxlOiAke2Rvd25sb2FkRXJyb3I/Lm1lc3NhZ2V9YCwgeyBzdGF0dXM6IDUwMCB9KTtcclxuICAgIH1cclxuICAgIGNvbnNvbGUubG9nKFwiRmlsZSBkb3dubG9hZGVkIHN1Y2Nlc3NmdWxseS5cIik7XHJcbiAgICBjb25zdCBmaWxlQXJyYXlCdWZmZXIgPSBhd2FpdCBmaWxlRGF0YS5hcnJheUJ1ZmZlcigpO1xyXG5cclxuICAgIC8vIDIuIEZvcm1EYXRh44Gu5qeL56+JIChEZW5v44Gn44Gu5a++5b+cKVxyXG4gICAgY29uc3QgeyBGaWxlIH0gPSBhd2FpdCBpbXBvcnQoXCJodHRwczovL2Rlbm8ubGFuZC94L2Zvcm1kYXRhX3BvbHlmaWxsQHY0LjAuMTIvbW9kLnRzXCIpO1xyXG5cclxuICAgIC8vIDEuIOODleOCoeOCpOODq+WQjeOBqE1JTUXjgr/jgqTjg5fmjqjlrppcclxuICAgIGNvbnN0IGZpbGVOYW1lID0gc3RvcmFnZVBhdGguc3BsaXQoXCIvXCIpLnBvcCgpIHx8IFwiYXVkaW8udW5rbm93blwiOyAvLyDjg4fjg5Xjgqnjg6vjg4jjg5XjgqHjgqTjg6vlkI3jgpLoqK3lrppcclxuICAgIGNvbnN0IGdldE1pbWVUeXBlID0gKG5hbWU6IHN0cmluZyk6IHN0cmluZyA9PiB7XHJcbiAgICAgIGlmIChuYW1lLmVuZHNXaXRoKFwiLm1wM1wiKSkgcmV0dXJuIFwiYXVkaW8vbXBlZ1wiO1xyXG4gICAgICBpZiAobmFtZS5lbmRzV2l0aChcIi5tcDRcIikpIHJldHVybiBcInZpZGVvL21wNFwiOyAvLyBXaGlzcGVy44GvbXA044KC5Y+vXHJcbiAgICAgIGlmIChuYW1lLmVuZHNXaXRoKFwiLm1wZWdcIikpIHJldHVybiBcInZpZGVvL21wZWdcIjtcclxuICAgICAgaWYgKG5hbWUuZW5kc1dpdGgoXCIubXBnYVwiKSkgcmV0dXJuIFwiYXVkaW8vbXBlZ1wiO1xyXG4gICAgICBpZiAobmFtZS5lbmRzV2l0aChcIi5tNGFcIikpIHJldHVybiBcImF1ZGlvL21wNFwiO1xyXG4gICAgICBpZiAobmFtZS5lbmRzV2l0aChcIi53YXZcIikpIHJldHVybiBcImF1ZGlvL3dhdlwiO1xyXG4gICAgICBpZiAobmFtZS5lbmRzV2l0aChcIi53ZWJtXCIpKSByZXR1cm4gXCJ2aWRlby93ZWJtXCI7XHJcbiAgICAgIC8vIOW/heimgeOBq+W/nOOBmOOBpuS7luOBrk1JTUXjgr/jgqTjg5fjgpLov73liqBcclxuICAgICAgY29uc29sZS53YXJuKGBVbmtub3duIGZpbGUgdHlwZSBmb3IgJHtuYW1lfSwgZGVmYXVsdGluZyB0byBhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW1gKTtcclxuICAgICAgcmV0dXJuIFwiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtXCI7IC8vIOS4jeaYjuOBquWgtOWQiOOBr+axjueUqOeahOOBqk1JTUXjgr/jgqTjg5dcclxuICAgIH07XHJcbiAgICBjb25zdCBtaW1lVHlwZSA9IGdldE1pbWVUeXBlKGZpbGVOYW1lKTtcclxuICAgIGNvbnNvbGUubG9nKGBEZXRlcm1pbmVkIGZpbGVOYW1lOiAke2ZpbGVOYW1lfSwgbWltZVR5cGU6ICR7bWltZVR5cGV9YCk7XHJcblxyXG4gICAgLy8gMi4gRmlsZeOCquODluOCuOOCp+OCr+ODiOOBruS9nOaIkFxyXG4gICAgY29uc3QgZmlsZSA9IG5ldyBGaWxlKFtmaWxlQXJyYXlCdWZmZXJdLCBmaWxlTmFtZSwgeyB0eXBlOiBtaW1lVHlwZSB9KTtcclxuXHJcbiAgICAvLyAzLiBGb3JtRGF0YeOBruani+eviVxyXG4gICAgY29uc3QgZm9ybURhdGEgPSBuZXcgRm9ybURhdGEoKTtcclxuICAgIGZvcm1EYXRhLmFwcGVuZChcImZpbGVcIiwgZmlsZSk7XHJcbiAgICBmb3JtRGF0YS5hcHBlbmQoXCJtb2RlbFwiLCBcIndoaXNwZXItMVwiKTtcclxuICAgIC8vIGZvcm1EYXRhLmFwcGVuZChcImxhbmd1YWdlXCIsIFwiamFcIik7IC8vIOW/heimgeOBq+W/nOOBmOOBpuiogOiqnuaMh+WumlxyXG4gICAgLy8gZm9ybURhdGEuYXBwZW5kKFwicHJvbXB0XCIsIFwi44GT44KT44Gr44Gh44Gv44CCXCIpOyAvLyDlv4XopoHjgavlv5zjgZjjgabjg5fjg63jg7Pjg5fjg4jov73liqBcclxuICAgIC8vIGZvcm1EYXRhLmFwcGVuZChcInJlc3BvbnNlX2Zvcm1hdFwiLCBcImpzb25cIik7IC8vIHZlcmJvc2VfanNvbuOChHNydOOBquOBqeOCguaMh+WumuWPr+iDvVxyXG4gICAgLy8gZm9ybURhdGEuYXBwZW5kKFwidGVtcGVyYXR1cmVcIiwgXCIwXCIpOyAvLyAwLTHjgafmjIflrprjgIHpq5jjgYTjgbvjganjg6njg7Pjg4Djg6BcclxuXHJcbiAgICBjb25zb2xlLmxvZyhcIkZvcm1EYXRhIGNvbnN0cnVjdGVkIHN1Y2Nlc3NmdWxseS5cIik7XHJcblxyXG5cclxuICAgIC8vIDMuIE9wZW5BSSBXaGlzcGVyIEFQSeOBq+mAgeS/oVxyXG4gICAgY29uc29sZS5sb2coYFNlbmRpbmcgZGF0YSB0byBPcGVuQUkgV2hpc3BlciBBUEkgZm9yIHRhc2s6ICR7dGFza0lkfWApO1xyXG4gICAgY29uc3Qgd2hpc3BlckFwaVVybCA9IFwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MS9hdWRpby90cmFuc2NyaXB0aW9uc1wiO1xyXG4gICAgXHJcbiAgICBsZXQgd2hpc3BlclJlc3BvbnNlO1xyXG4gICAgdHJ5IHtcclxuICAgICAgd2hpc3BlclJlc3BvbnNlID0gYXdhaXQgZmV0Y2god2hpc3BlckFwaVVybCwge1xyXG4gICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke29wZW5haUFwaUtleX1gLFxyXG4gICAgICAgICAgLy8gJ0NvbnRlbnQtVHlwZSc6ICdtdWx0aXBhcnQvZm9ybS1kYXRhJyDjga9mZXRjaOOBjOiHquWLleOBp+ioreWumuOBmeOCiyAoYm91bmRhcnnlkKvjgoApXHJcbiAgICAgICAgfSxcclxuICAgICAgICBib2R5OiBmb3JtRGF0YSxcclxuICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGNvbnN0IGZldGNoRXJyb3IgPSBlIGFzIEVycm9yOyAvLyDlnovjgqLjgrXjg7zjgrfjg6fjg7NcclxuICAgICAgY29uc29sZS5lcnJvcihgWyR7dGFza0lkfV0gRmV0Y2ggZXJyb3IgY2FsbGluZyBXaGlzcGVyIEFQSTpgLCBmZXRjaEVycm9yKTtcclxuICAgICAgYXdhaXQgdXBkYXRlVGFza1N0YXR1cyhzdXBhYmFzZSwgdGFza0lkLCBcInRyYW5zY3JpYmVfZmFpbGVkXCIsIGBGZXRjaCBlcnJvcjogJHtmZXRjaEVycm9yLm1lc3NhZ2UgPyBmZXRjaEVycm9yLm1lc3NhZ2Uuc2xpY2UoMCwzMDApIDogJ1Vua25vd24gZmV0Y2ggZXJyb3InfWApO1xyXG4gICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKGBXaGlzcGVyIEFQSSBmZXRjaCBlcnJvcjogJHtmZXRjaEVycm9yLm1lc3NhZ2UgfHwgJ1Vua25vd24gZmV0Y2ggZXJyb3InfWAsIHsgc3RhdHVzOiA1MDAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuXHJcbiAgICBpZiAoIXdoaXNwZXJSZXNwb25zZS5vaykge1xyXG4gICAgICBjb25zdCBlcnJvclRleHQgPSBhd2FpdCB3aGlzcGVyUmVzcG9uc2UudGV4dCgpO1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBbJHt0YXNrSWR9XSBXaGlzcGVyIEFQSSBFcnJvcjogJHt3aGlzcGVyUmVzcG9uc2Uuc3RhdHVzfWAsIGVycm9yVGV4dCk7XHJcbiAgICAgIC8vIOOCqOODqeODvOODoeODg+OCu+ODvOOCuOOBjOmVt+OBmeOBjuOCi+WgtOWQiOOBjOOBguOCi+OBruOBp+OAgURC44Gr44Gv5LiA6YOo44KS5L+d5a2YXHJcbiAgICAgIGNvbnN0IGRiRXJyb3JNZXNzYWdlID0gYFdoaXNwZXIgQVBJIEVycm9yICR7d2hpc3BlclJlc3BvbnNlLnN0YXR1c306ICR7ZXJyb3JUZXh0LnNsaWNlKDAsIDI1MCl9YDtcclxuICAgICAgYXdhaXQgdXBkYXRlVGFza1N0YXR1cyhzdXBhYmFzZSwgdGFza0lkLCBcInRyYW5zY3JpYmVfZmFpbGVkXCIsIGRiRXJyb3JNZXNzYWdlKTtcclxuICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShgV2hpc3BlciBBUEkgZmFpbGVkOiAke2Vycm9yVGV4dH1gLCB7IHN0YXR1czogd2hpc3BlclJlc3BvbnNlLnN0YXR1cyB9KTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB3aGlzcGVyUmVzcG9uc2UuanNvbigpO1xyXG4gICAgY29uc3QgdHJhbnNjcmliZWRUZXh0ID0gcmVzdWx0LnRleHQgfHwgXCJcIjsgLy8gQVBJ44Os44K544Od44Oz44K544GrdGV4dOODleOCo+ODvOODq+ODieOBjOWtmOWcqOOBl+OBquOBhOWgtOWQiOOCguiAg+aFrlxyXG4gICAgXHJcbiAgICBpZiAodHlwZW9mIHRyYW5zY3JpYmVkVGV4dCAhPT0gJ3N0cmluZycgfHwgdHJhbnNjcmliZWRUZXh0LnRyaW0oKSA9PT0gXCJcIikge1xyXG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7dGFza0lkfV0gV2hpc3BlciBBUEkgcmV0dXJuZWQgZW1wdHkgb3IgaW52YWxpZCB0ZXh0LiBSZXN1bHQ6YCwgSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XHJcbiAgICAgICAgYXdhaXQgdXBkYXRlVGFza1N0YXR1cyhzdXBhYmFzZSwgdGFza0lkLCBcInRyYW5zY3JpYmVfZmFpbGVkXCIsIFwiV2hpc3BlciBBUEkgcmV0dXJuZWQgZW1wdHkgb3IgaW52YWxpZCB0ZXh0LlwiKTtcclxuICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKFwiV2hpc3BlciBBUEkgcmV0dXJuZWQgZW1wdHkgb3IgaW52YWxpZCB0ZXh0LlwiLCB7IHN0YXR1czogNTAwIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUubG9nKGBbJHt0YXNrSWR9XSBUcmFuc2NyaXB0aW9uIHN1Y2Nlc3MgKGZpcnN0IDEwMCBjaGFycyk6YCwgdHJhbnNjcmliZWRUZXh0LnNsaWNlKDAsIDEwMCkpO1xyXG5cclxuICAgIC8vIDQuIOOCv+OCueOCr+OCkuabtOaWsCAodHJhbnNjcmlwdGlvbl9yZXN1bHQg44GoIHN0YXR1cylcclxuICAgIGF3YWl0IHVwZGF0ZVRhc2tTdGF0dXMoc3VwYWJhc2UsIHRhc2tJZCwgXCJ0cmFuc2NyaWJlZFwiLCB0cmFuc2NyaWJlZFRleHQpO1xyXG4gICAgY29uc29sZS5sb2coYFRhc2sgJHt0YXNrSWR9IHN0YXR1cyB1cGRhdGVkIHRvIHRyYW5zY3JpYmVkLmApO1xyXG5cclxuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIlRyYW5zY3JpcHRpb24gc3VjY2Vzc2Z1bFwiLCB0YXNrSWQsIHRyYW5zY3JpYmVkVGV4dDogdHJhbnNjcmliZWRUZXh0LnNsaWNlKDAsMTAwKSArIFwiLi4uXCIgfSksIHtcclxuICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxyXG4gICAgICBzdGF0dXM6IDIwMCxcclxuICAgIH0pO1xyXG5cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zdCBlcnJvciA9IGUgYXMgRXJyb3I7XHJcbiAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgaW4gZnVuY3Rpb246XCIsIGVycm9yKTtcclxuICAgIGlmICh0YXNrSWRGb3JFcnJvckhhbmRsaW5nKSB7XHJcbiAgICAgIC8vIGNvbnN0IHN1cGFiYXNlID0gY3JlYXRlQ2xpZW50KHN1cGFiYXNlVXJsLCBzdXBhYmFzZUFub25LZXkpOyAvLyDlho3liJ3mnJ/ljJZcclxuICAgICAgY29uc3Qgc3VwYWJhc2UgPSBjcmVhdGVDbGllbnQoc3VwYWJhc2VVcmwsIHN1cGFiYXNlU2VydmljZVJvbGVLZXkpOyAvLyDlho3liJ3mnJ/ljJbmmYLjgoJzZXJ2aWNlX3JvbGVfa2V544KS5L2/55SoXHJcbiAgICAgIGF3YWl0IHVwZGF0ZVRhc2tTdGF0dXMoc3VwYWJhc2UsIHRhc2tJZEZvckVycm9ySGFuZGxpbmcsIFwidHJhbnNjcmliZV9mYWlsZWRcIiwgYEZ1bmN0aW9uIGVycm9yOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSksIHsgc3RhdHVzOiA1MDAgfSk7XHJcbiAgfVxyXG59KTsgIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFNBQVMsS0FBSyxRQUFRLCtDQUErQztBQUNyRSxTQUFTLFlBQVksUUFBd0IseUNBQXlDO0FBRXRGLHVCQUF1QjtBQUN2QixNQUFNLGNBQWMsS0FBSyxHQUFHLENBQUMsR0FBRyxDQUFDO0FBQ2pDLDhEQUE4RDtBQUM5RCxNQUFNLHlCQUF5QixLQUFLLEdBQUcsQ0FBQyxHQUFHLENBQUM7QUFDNUMsTUFBTSxlQUFlLEtBQUssR0FBRyxDQUFDLEdBQUcsQ0FBQztBQWdCbEMsZUFBZSxpQkFBaUIsUUFBd0IsRUFBRSxNQUFjLEVBQUUsTUFBYyxFQUFFLG9CQUE2QjtFQUNySCxNQUFNLGFBQW9GO0lBQ3hGO0lBQ0EsWUFBWSxJQUFJLE9BQU8sV0FBVztFQUNwQztFQUNBLElBQUksc0JBQXNCO0lBQ3hCLFdBQVcsb0JBQW9CLEdBQUc7RUFDcEM7RUFFQSxNQUFNLEVBQUUsT0FBTyxXQUFXLEVBQUUsR0FBRyxNQUFNLFNBQ2xDLElBQUksQ0FBQyx1QkFDTCxNQUFNLENBQUMsWUFDUCxFQUFFLENBQUMsTUFBTTtFQUVaLElBQUksYUFBYTtJQUNmLFFBQVEsS0FBSyxDQUFDLENBQUMsb0JBQW9CLEVBQUUsT0FBTyxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQUMsRUFBRTtFQUN0RSxPQUFPO0lBQ0wsUUFBUSxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsT0FBTyxnQ0FBZ0MsRUFBRSxPQUFPLENBQUMsQ0FBQztFQUN4RTtBQUNGO0FBRUEsTUFBTSxPQUFPO0VBQ1gsUUFBUSxHQUFHLENBQUM7RUFFWixJQUFJLElBQUksTUFBTSxLQUFLLFFBQVE7SUFDekIsT0FBTyxJQUFJLFNBQVMsc0JBQXNCO01BQUUsUUFBUTtJQUFJO0VBQzFEO0VBRUEsSUFBSTtFQUVKLElBQUk7SUFDRixNQUFNLFVBQXVCLE1BQU0sSUFBSSxJQUFJO0lBQzNDLFFBQVEsR0FBRyxDQUFDLHFCQUFxQixLQUFLLFNBQVMsQ0FBQyxTQUFTLE1BQU07SUFFL0QsTUFBTSxFQUFFLElBQUksTUFBTSxFQUFFLGNBQWMsV0FBVyxFQUFFLEdBQUcsUUFBUSxNQUFNO0lBQ2hFLHlCQUF5QixRQUFRLGdCQUFnQjtJQUVqRCxJQUFJLENBQUMsVUFBVSxDQUFDLGFBQWE7TUFDM0IsUUFBUSxLQUFLLENBQUM7TUFDZCxPQUFPLElBQUksU0FBUyxrQ0FBa0M7UUFBRSxRQUFRO01BQUk7SUFDdEU7SUFFQSxRQUFRLEdBQUcsQ0FBQyxDQUFDLG9CQUFvQixFQUFFLE9BQU8sZ0JBQWdCLEVBQUUsYUFBYTtJQUV6RSxnRUFBZ0U7SUFDaEUsTUFBTSxXQUFXLGFBQWEsYUFBYSx3QkFBd0I7TUFDakUsUUFBUTtRQUNOLDREQUE0RDtRQUM1RCxTQUFTO1VBQUUsZUFBZSxDQUFDLE9BQU8sRUFBRSx3QkFBd0I7UUFBQztNQUMvRDtJQUNGO0lBRUEsNkNBQTZDO0lBQzdDLFFBQVEsR0FBRyxDQUFDLENBQUMscUNBQXFDLEVBQUUsYUFBYTtJQUNqRSxNQUFNLEVBQUUsTUFBTSxRQUFRLEVBQUUsT0FBTyxhQUFhLEVBQUUsR0FBRyxNQUFNLFNBQVMsT0FBTyxDQUNwRSxJQUFJLENBQUMsVUFBVSxzQ0FBc0M7S0FDckQsUUFBUSxDQUFDO0lBRVosSUFBSSxpQkFBaUIsQ0FBQyxVQUFVO01BQzlCLFFBQVEsS0FBSyxDQUFDLDJCQUEyQjtNQUN6QyxNQUFNLGlCQUFpQixVQUFVLFFBQVEscUJBQXFCLENBQUMsd0JBQXdCLEVBQUUsZUFBZSxTQUFTO01BQ2pILE9BQU8sSUFBSSxTQUFTLENBQUMseUJBQXlCLEVBQUUsZUFBZSxTQUFTLEVBQUU7UUFBRSxRQUFRO01BQUk7SUFDMUY7SUFDQSxRQUFRLEdBQUcsQ0FBQztJQUNaLE1BQU0sa0JBQWtCLE1BQU0sU0FBUyxXQUFXO0lBRWxELDRCQUE0QjtJQUM1QixNQUFNLEVBQUUsSUFBSSxFQUFFLEdBQUcsTUFBTSxNQUFNLENBQUM7SUFFOUIscUJBQXFCO0lBQ3JCLE1BQU0sV0FBVyxZQUFZLEtBQUssQ0FBQyxLQUFLLEdBQUcsTUFBTSxpQkFBaUIsZ0JBQWdCO0lBQ2xGLE1BQU0sY0FBYyxDQUFDO01BQ25CLElBQUksS0FBSyxRQUFRLENBQUMsU0FBUyxPQUFPO01BQ2xDLElBQUksS0FBSyxRQUFRLENBQUMsU0FBUyxPQUFPLGFBQWEsZ0JBQWdCO01BQy9ELElBQUksS0FBSyxRQUFRLENBQUMsVUFBVSxPQUFPO01BQ25DLElBQUksS0FBSyxRQUFRLENBQUMsVUFBVSxPQUFPO01BQ25DLElBQUksS0FBSyxRQUFRLENBQUMsU0FBUyxPQUFPO01BQ2xDLElBQUksS0FBSyxRQUFRLENBQUMsU0FBUyxPQUFPO01BQ2xDLElBQUksS0FBSyxRQUFRLENBQUMsVUFBVSxPQUFPO01BQ25DLHFCQUFxQjtNQUNyQixRQUFRLElBQUksQ0FBQyxDQUFDLHNCQUFzQixFQUFFLEtBQUssd0NBQXdDLENBQUM7TUFDcEYsT0FBTyw0QkFBNEIsb0JBQW9CO0lBQ3pEO0lBQ0EsTUFBTSxXQUFXLFlBQVk7SUFDN0IsUUFBUSxHQUFHLENBQUMsQ0FBQyxxQkFBcUIsRUFBRSxTQUFTLFlBQVksRUFBRSxVQUFVO0lBRXJFLG1CQUFtQjtJQUNuQixNQUFNLE9BQU8sSUFBSSxLQUFLO01BQUM7S0FBZ0IsRUFBRSxVQUFVO01BQUUsTUFBTTtJQUFTO0lBRXBFLGlCQUFpQjtJQUNqQixNQUFNLFdBQVcsSUFBSTtJQUNyQixTQUFTLE1BQU0sQ0FBQyxRQUFRO0lBQ3hCLFNBQVMsTUFBTSxDQUFDLFNBQVM7SUFDekIsbURBQW1EO0lBQ25ELHdEQUF3RDtJQUN4RCx5RUFBeUU7SUFDekUsMERBQTBEO0lBRTFELFFBQVEsR0FBRyxDQUFDO0lBR1osMkJBQTJCO0lBQzNCLFFBQVEsR0FBRyxDQUFDLENBQUMsNkNBQTZDLEVBQUUsUUFBUTtJQUNwRSxNQUFNLGdCQUFnQjtJQUV0QixJQUFJO0lBQ0osSUFBSTtNQUNGLGtCQUFrQixNQUFNLE1BQU0sZUFBZTtRQUMzQyxRQUFRO1FBQ1IsU0FBUztVQUNQLGVBQWUsQ0FBQyxPQUFPLEVBQUUsY0FBYztRQUV6QztRQUNBLE1BQU07TUFDUjtJQUNGLEVBQUUsT0FBTyxHQUFHO01BQ1YsTUFBTSxhQUFhLEdBQVksVUFBVTtNQUN6QyxRQUFRLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxPQUFPLGtDQUFrQyxDQUFDLEVBQUU7TUFDOUQsTUFBTSxpQkFBaUIsVUFBVSxRQUFRLHFCQUFxQixDQUFDLGFBQWEsRUFBRSxXQUFXLE9BQU8sR0FBRyxXQUFXLE9BQU8sQ0FBQyxLQUFLLENBQUMsR0FBRSxPQUFPLHVCQUF1QjtNQUM1SixPQUFPLElBQUksU0FBUyxDQUFDLHlCQUF5QixFQUFFLFdBQVcsT0FBTyxJQUFJLHVCQUF1QixFQUFFO1FBQUUsUUFBUTtNQUFJO0lBQy9HO0lBR0EsSUFBSSxDQUFDLGdCQUFnQixFQUFFLEVBQUU7TUFDdkIsTUFBTSxZQUFZLE1BQU0sZ0JBQWdCLElBQUk7TUFDNUMsUUFBUSxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsT0FBTyxxQkFBcUIsRUFBRSxnQkFBZ0IsTUFBTSxFQUFFLEVBQUU7TUFDMUUsaUNBQWlDO01BQ2pDLE1BQU0saUJBQWlCLENBQUMsa0JBQWtCLEVBQUUsZ0JBQWdCLE1BQU0sQ0FBQyxFQUFFLEVBQUUsVUFBVSxLQUFLLENBQUMsR0FBRyxNQUFNO01BQ2hHLE1BQU0saUJBQWlCLFVBQVUsUUFBUSxxQkFBcUI7TUFDOUQsT0FBTyxJQUFJLFNBQVMsQ0FBQyxvQkFBb0IsRUFBRSxXQUFXLEVBQUU7UUFBRSxRQUFRLGdCQUFnQixNQUFNO01BQUM7SUFDM0Y7SUFFQSxNQUFNLFNBQVMsTUFBTSxnQkFBZ0IsSUFBSTtJQUN6QyxNQUFNLGtCQUFrQixPQUFPLElBQUksSUFBSSxJQUFJLGdDQUFnQztJQUUzRSxJQUFJLE9BQU8sb0JBQW9CLFlBQVksZ0JBQWdCLElBQUksT0FBTyxJQUFJO01BQ3RFLFFBQVEsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLE9BQU8scURBQXFELENBQUMsRUFBRSxLQUFLLFNBQVMsQ0FBQztNQUMvRixNQUFNLGlCQUFpQixVQUFVLFFBQVEscUJBQXFCO01BQzlELE9BQU8sSUFBSSxTQUFTLCtDQUErQztRQUFFLFFBQVE7TUFBSTtJQUNyRjtJQUVBLFFBQVEsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLE9BQU8sMENBQTBDLENBQUMsRUFBRSxnQkFBZ0IsS0FBSyxDQUFDLEdBQUc7SUFFN0YsNENBQTRDO0lBQzVDLE1BQU0saUJBQWlCLFVBQVUsUUFBUSxlQUFlO0lBQ3hELFFBQVEsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLE9BQU8sK0JBQStCLENBQUM7SUFFM0QsT0FBTyxJQUFJLFNBQVMsS0FBSyxTQUFTLENBQUM7TUFBRSxTQUFTO01BQTRCO01BQVEsaUJBQWlCLGdCQUFnQixLQUFLLENBQUMsR0FBRSxPQUFPO0lBQU0sSUFBSTtNQUMxSSxTQUFTO1FBQUUsZ0JBQWdCO01BQW1CO01BQzlDLFFBQVE7SUFDVjtFQUVGLEVBQUUsT0FBTyxHQUFHO0lBQ1YsTUFBTSxRQUFRO0lBQ2QsUUFBUSxLQUFLLENBQUMsc0JBQXNCO0lBQ3BDLElBQUksd0JBQXdCO01BQzFCLHVFQUF1RTtNQUN2RSxNQUFNLFdBQVcsYUFBYSxhQUFhLHlCQUF5Qiw0QkFBNEI7TUFDaEcsTUFBTSxpQkFBaUIsVUFBVSx3QkFBd0IscUJBQXFCLENBQUMsZ0JBQWdCLEVBQUUsTUFBTSxPQUFPLEVBQUU7SUFDbEg7SUFDQSxPQUFPLElBQUksU0FBUyxLQUFLLFNBQVMsQ0FBQztNQUFFLE9BQU8sTUFBTSxPQUFPO0lBQUMsSUFBSTtNQUFFLFFBQVE7SUFBSTtFQUM5RTtBQUNGIn0=
// denoCacheMetadata=6468595544046716882,4032007766555484341