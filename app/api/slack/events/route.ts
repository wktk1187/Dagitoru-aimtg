import { NextRequest, NextResponse } from 'next/server';
import process from 'node:process';

// WEBHOOK_SECRETはVercelの環境変数から取得することを想定
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const NEXT_PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_APP_URL; // NEXT_PUBLIC_BASE_URLの代わりにNEXT_PUBLIC_APP_URLを使用

export async function POST(req: NextRequest) { // NextRequestを使用
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}][slack/events] >>> /slack/events called`);
  console.log(`[${timestamp}][slack/events] Headers:`, Object.fromEntries(req.headers.entries()));

  let body;
  try {
    body = await req.json();
    console.log(`[${timestamp}][slack/events] Parsed body:`, JSON.stringify(body, null, 2));
  } catch (e) {
    const error = e instanceof Error ? e : new Error('Unknown parsing error');
    console.error(`[${timestamp}][slack/events] Failed to parse body:`, error.message, error.stack);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // SlackのURL検証リクエストに対応
  if (body.type === "url_verification") {
    console.log(`[${timestamp}][slack/events] URL verification challenge received`);
    return NextResponse.json({ challenge: body.challenge });
  }

  // Slackイベントの署名検証 (オプショナルだが推奨)
  // ここではWEBHOOK_SECRETによる認証をintake側で行うため、event側では省略も可能
  // もしSlackの署名検証も行いたい場合は、元のverifySlackSignature関数を復活させる

  const event = body.event;

  if (event?.type === "message" && event.subtype === "file_share") {
    const files = event.files || [];
    console.log(`[${timestamp}][slack/events] Processing ${files.length} file(s) in message event.`);

    const videoPayloads = files
      .filter((file: any) => {
        const isVideo = file.mimetype?.startsWith("video/");
        if (!isVideo) {
          console.log(`[${timestamp}][slack/events] Skipping non-video file: ${file.name} (type: ${file.mimetype})`);
        }
        return isVideo;
      })
      .map((file: any) => ({
        file_id: file.id,
        original_file_name: file.name,
        mimetype: file.mimetype,
        filetype: file.filetype,
        slack_download_url: file.url_private_download,
        slack_user_id: event.user,
        slack_channel_id: event.channel,
        slack_team_id: body.team_id, // body.team_id から取得
        slack_event_ts: event.event_ts,
        metadata: extractMetadata(event.text)
      }));

    if (videoPayloads.length === 0) {
      console.log(`[${timestamp}][slack/events] No video files found in the message.`);
    } else {
      console.log(`[${timestamp}][slack/events] Found ${videoPayloads.length} video file(s) to process.`);
    }

    const promises = videoPayloads.map(async (payload: any) => {
      const fileIdForLog = payload.file_id || 'unknown_file';
      if (!NEXT_PUBLIC_BASE_URL) {
        console.error(`[${timestamp}][slack/events] CRITICAL: NEXT_PUBLIC_APP_URL (as NEXT_PUBLIC_BASE_URL) is not defined. Cannot call /api/slack/intake for file ${fileIdForLog}.`);
        return; // このPromiseはここで終了
      }
      if (!WEBHOOK_SECRET) {
        console.error(`[${timestamp}][slack/events] CRITICAL: WEBHOOK_SECRET is not defined. Cannot authorize call to /api/slack/intake for file ${fileIdForLog}.`);
        return; // このPromiseはここで終了
      }
      const url = `${NEXT_PUBLIC_BASE_URL}/api/slack/intake`;

      try {
        console.log(`[${timestamp}][slack/events] Fetching: ${url} for file ${fileIdForLog}`);
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WEBHOOK_SECRET}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const resBody = await res.text(); // Always get text first, as .json() might fail if not json
        if (!res.ok) {
          console.error(`[${timestamp}][slack/events] Intake failed for file ${fileIdForLog}. Status: ${res.status} ${res.statusText}. Response Body:`, resBody);
        } else {
          console.log(`[${timestamp}][slack/events] Intake succeeded for file ${fileIdForLog}. Status: ${res.status}. Response Body:`, resBody);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown fetch error');
        console.error(`[${timestamp}][slack/events] Intake error for file ${fileIdForLog}: ${error.message}`, error.stack, err);
      }
    });
    
    // Slackへのレスポンスをブロックしないために、Promise.all の結果を待たずに返すことも検討できるが、
    // Vercelのサーバーレス関数の実行時間制限（通常10秒～）を考慮し、ここでは完了を待つ。
    // もし多数のファイルを同時に処理し、タイムアウトが懸念される場合は、intake側をキューイングシステムに繋ぐなどの更なる対策が必要。
    try {
      await Promise.all(promises);
      console.log(`[${timestamp}][slack/events] All intake promises processed for message event.`);
    } catch (error) {
      // このcatchは map 内の individual catch で捕捉されなかった場合に備える (通常は到達しないはず)
      console.error(`[${timestamp}][slack/events] Error processing Promise.all for intake calls:`, error);
    }
  }

  // Slackには常に200 OKを速やかに返す
  return NextResponse.json({ message: "Event received and processing initiated" }, { status: 200 });
}

function extractMetadata(text: string | undefined) {
  if (!text) return {};
  return {
    consultant_name: extractByPattern(text, /コンサルタント名\s*([^\n]+)/),
    client_name: extractByPattern(text, /企業名(?:株式)?\s*([^\n]+)/),
    meeting_date: extractByPattern(text, /面談日\s*(\d{4}\/\d{2}\/\d{2})/),
    meeting_type: extractByPattern(text, /面談タイプ\s*([^\n]+)/),
    company_problem: extractByPattern(text, /企業の課題\s*([^\n]+)/), 
    company_phase: extractByPattern(text, /企業のフェーズ\s*([^\n]+)/), 
    company_type: extractByPattern(text, /企業タイプ\s*([^\n]+)/), 
    meeting_count: extractByPattern(text, /面談回数\s*(\d+)/), 
    support_area: extractByPattern(text, /支援領域\s*([^\n]+)/), 
    internal_sharing_items: extractByPattern(text, /社内共有が必要な事項\s*([^\n]+)/)
  };
}

function extractByPattern(text: string, regex: RegExp) {
  const match = text.match(regex);
  return match?.[1]?.trim() || null;
} 