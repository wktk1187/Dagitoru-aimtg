import { NextRequest, NextResponse } from 'next/server';
import process from 'node:process';

// WEBHOOK_SECRETはVercelの環境変数から取得することを想定
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const NEXT_PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_APP_URL; // NEXT_PUBLIC_BASE_URLの代わりにNEXT_PUBLIC_APP_URLを使用

export async function POST(req: NextRequest) { // NextRequestを使用
  console.log(`[${new Date().toISOString()}] >>> /slack/events called`);
  console.log(`[${new Date().toISOString()}] Headers:`, Object.fromEntries(req.headers.entries()));

  let body;
  try {
    body = await req.json();
    console.log(`[${new Date().toISOString()}] Parsed body:`, JSON.stringify(body, null, 2));
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Failed to parse body:`, e);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // SlackのURL検証リクエストに対応
  if (body.type === "url_verification") {
    console.log(`[${new Date().toISOString()}] URL verification challenge received`);
    return NextResponse.json({ challenge: body.challenge });
  }

  // Slackイベントの署名検証 (オプショナルだが推奨)
  // ここではWEBHOOK_SECRETによる認証をintake側で行うため、event側では省略も可能
  // もしSlackの署名検証も行いたい場合は、元のverifySlackSignature関数を復活させる

  const event = body.event;

  if (event?.type === "message" && event.subtype === "file_share") {
    const files = event.files || [];

    for (const file of files) {
      if (!file.mimetype?.startsWith("video/")) {
        console.log(`[${new Date().toISOString()}] Skipping non-video file: ${file.name} (type: ${file.mimetype})`);
        continue;
      }

      const metadata = extractMetadata(event.text); 

      const payload = {
        file_id: file.id,
        original_file_name: file.name,
        mimetype: file.mimetype,
        filetype: file.filetype,
        slack_download_url: file.url_private_download,
        slack_user_id: event.user,
        slack_channel_id: event.channel,
        slack_team_id: body.team_id,
        slack_event_ts: event.event_ts,
        metadata,
      };

      console.log(`[${new Date().toISOString()}] Forwarding video file to intake:`, JSON.stringify(payload, null, 2));

      // NEXT_PUBLIC_BASE_URL が未定義の場合のエラーハンドリング
      if (!NEXT_PUBLIC_BASE_URL) {
        console.error(`[${new Date().toISOString()}] ERROR: NEXT_PUBLIC_APP_URL (as NEXT_PUBLIC_BASE_URL) is not defined. Cannot call /api/slack/intake.`);
        // 通常、イベントソースにはエラーを返さず、ログで問題を記録する
        continue; // 次のファイルの処理へ
      }
      if (!WEBHOOK_SECRET) {
        console.error(`[${new Date().toISOString()}] ERROR: WEBHOOK_SECRET is not defined. Cannot authorize call to /api/slack/intake.`);
        continue; 
      }
      
      // 非同期でintakeに送信するため、awaitしない (Slackへのレスポンスを速やかに返すため)
      fetch(`${NEXT_PUBLIC_BASE_URL}/api/slack/intake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WEBHOOK_SECRET}`,
        },
        body: JSON.stringify(payload),
      }).then(async response => {
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[${new Date().toISOString()}] Error forwarding to /api/slack/intake for file ${file.id}: ${response.status} ${response.statusText}`, errorText);
        } else {
          console.log(`[${new Date().toISOString()}] Successfully forwarded file ${file.id} to /api/slack/intake. Status: ${response.status}`);
        }
      }).catch(error => {
        console.error(`[${new Date().toISOString()}] Network error forwarding to /api/slack/intake for file ${file.id}:`, error);
      });
    }
  }
  // Slackには常に200 OKを返す
  return NextResponse.json({ message: "Event received" }, { status: 200 });
}

function extractMetadata(text: string | undefined) {
  if (!text) return {};
  return {
    consultant_name: extractByPattern(text, /コンサルタント名\s*([^\n]+)/),
    client_name: extractByPattern(text, /企業名(?:株式)?\s*([^\n]+)/),
    meeting_date: extractByPattern(text, /面談日\s*(\d{4}\/\d{2}\/\d{2})/),
    meeting_type: extractByPattern(text, /面談タイプ\s*([^\n]+)/),
    company_problem: extractByPattern(text, /企業の課題\s*([^\n]+)/), // キーをcompany_problemに変更
    company_phase: extractByPattern(text, /企業のフェーズ\s*([^\n]+)/), // キーをcompany_phaseに変更
    company_type: extractByPattern(text, /企業タイプ\s*([^\n]+)/), // 追加
    meeting_count: extractByPattern(text, /面談回数\s*(\d+)/), // 追加
    support_area: extractByPattern(text, /支援領域\s*([^\n]+)/), // 追加
    internal_sharing_items: extractByPattern(text, /社内共有が必要な事項\s*([^\n]+)/) // 追加
  };
}

function extractByPattern(text: string, regex: RegExp) {
  const match = text.match(regex);
  return match?.[1]?.trim() || null;
} 