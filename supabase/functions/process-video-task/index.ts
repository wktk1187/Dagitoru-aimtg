/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.43.4";
import "https://deno.land/std@0.224.0/dotenv/load.ts";

function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Environment variable ${key} not set`);
  return value;
}

async function _updateTaskStatus(
  supabase: SupabaseClient,
  taskId: string,
  status: string,
  errorMessage?: string | null
): Promise<void> {
  const updates: { status: string; error_message?: string; notified_at?: string } = {
    status,
    // notified_at: new Date().toISOString(), // カラムが存在し、更新したい場合のみ有効化
  };
  if (errorMessage) {
    updates.error_message = errorMessage;
  }
  const { error } = await supabase
    .from("transcription_tasks")
    .update(updates)
    .eq("id", taskId);
  if (error) console.error(`Error updating task to ${status}:`, error.message);
  else console.log(`Task ${taskId} status updated to ${status}.`);
}

serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let supabase: SupabaseClient | null = null;
  let taskId: string | null = null; 

  try {
    const { taskId: receivedTaskId, storagePath } = await req.json();
    
    if (!receivedTaskId || !storagePath) {
      console.error("taskId or storagePath missing in payload:", { receivedTaskId, storagePath });
      throw new Error("taskId or storagePath missing in payload");
    }
    taskId = receivedTaskId; 

    const supabaseUrl = getEnvVar("SUPABASE_URL");
    const serviceRoleKey = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, serviceRoleKey);

    // VERCEL_WEBHOOK_URL を使用した通知処理を削除
    console.log(`Task ${taskId} (storagePath: ${storagePath}) received by process-video-task. Vercel notification via VERCEL_WEBHOOK_URL is now disabled.`);

    // このFunctionが他に担っていた処理があればここに残ります。
    // 現状、Vercelへの通知が主目的だった場合、このFunctionはほとんど何もしないことになります。
    // 必要に応じて、完了を示すステータス更新などをここで行うことができます。
    // 例: await updateTaskStatus(supabase, taskId!, "processed_by_task_function_no_webhook");


    return new Response(JSON.stringify({ message: "process-video-task executed. Notification via VERCEL_WEBHOOK_URL has been removed." }), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Error in process-video-task (Vercel notification part removed):", msg);
    if (taskId && supabase) { 
      // 必要に応じてエラー時のステータス更新
      // await updateTaskStatus(supabase, taskId, "function_error_no_webhook", msg);
    }
    return new Response(JSON.stringify({ error: `Error in process-video-task: ${msg}` }), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
