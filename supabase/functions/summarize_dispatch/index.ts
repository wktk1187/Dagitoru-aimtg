import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// これらの環境変数はSupabaseプロジェクトのEdge Function設定で定義する必要があります
const VERCEL_SUMMARIZE_WEBHOOK_URL = Deno.env.get("VERCEL_SUMMARIZE_WEBHOOK_URL")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

console.log("Function summarize_dispatch initialized.");
console.log(`VERCEL_SUMMARIZE_WEBHOOK_URL: ${VERCEL_SUMMARIZE_WEBHOOK_URL ? 'Loaded' : 'NOT LOADED'}`);
console.log(`WEBHOOK_SECRET: ${WEBHOOK_SECRET ? 'Loaded' : 'NOT LOADED'}`);

serve(async (req: Request) => {
  console.log("[summarize_dispatch] Received request");

  if (req.method !== "POST") {
    console.log(`[summarize_dispatch] Method Not Allowed: ${req.method}`);
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const payload = await req.json();
    // DBトリガーからのペイロード構造を想定 (record, old_record, type, table, schema)
    // 特に、payload.recordに必要な情報が含まれているか確認
    const record = payload.record;
    console.log("[summarize_dispatch] Payload received:", JSON.stringify(record, null, 2));

    if (!record || !record.id || record.transcription_result === undefined || record.transcription_result === null) {
      console.error("[summarize_dispatch] Invalid payload: Missing id or transcription_result", record);
      return new Response("Invalid payload: Missing id or transcription_result", { status: 400 });
    }

    const taskId = record.id as string;
    const transcriptionText = record.transcription_result as string;

    console.log(`[summarize_dispatch] Processing task: ${taskId}`);

    if (!VERCEL_SUMMARIZE_WEBHOOK_URL || !WEBHOOK_SECRET) {
      console.error("[summarize_dispatch] Environment variables VERCEL_SUMMARIZE_WEBHOOK_URL or WEBHOOK_SECRET are not set.");
      return new Response("Internal Server Error: Webhook URL or Secret not configured", { status: 500 });
    }

    const response = await fetch(VERCEL_SUMMARIZE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WEBHOOK_SECRET}`, // Vercel側でこのSecretを検証
      },
      body: JSON.stringify({ taskId, transcriptionText }),
    });

    const responseText = await response.text(); // レスポンスボディを先に取得
    console.log(`[summarize_dispatch] Vercel webhook response for task ${taskId}: ${response.status} ${responseText}`);

    if (!response.ok) {
      // Vercelからのエラーレスポンスをそのまま返すか、あるいは特定の処理を行う
      return new Response(`Vercel API call failed: ${response.status} ${responseText}`, {
        status: response.status, // Vercelのステータスを中継
        headers: { 'Content-Type': 'application/json' } // 必要に応じて
      }); 
    }

    // Vercel APIが成功した場合 (2xxレスポンス)
    // 通常、このFunctionはVercelへのディスパッチが成功すれば200を返す
    return new Response(JSON.stringify({ message: "Successfully dispatched to Vercel for summarization", taskId, vercelResponse: responseText }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e) {
    const error = e as Error; // Type assertion
    console.error("[summarize_dispatch] Error processing request:", error);
    return new Response(JSON.stringify({ error: error.message || 'An unknown error occurred' }), { status: 500 });
  }
}); 