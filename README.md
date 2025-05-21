# Slack 動画要約プロジェクト

このプロジェクトは、Slackに投稿された動画を自動で文字起こしし、要約を作成して通知するシステムです。

## 構成

- `apps/webhook-vercel`: Slackイベントを受信し、Supabaseに処理要求を登録するNext.jsアプリケーション (Vercelデプロイ想定)
- `services/transcriber`: 動画の文字起こしと要約を行うPythonバッチ処理
- `scripts`: 補助スクリプト (例: 特定動画の再処理)
- `docs`: 仕様書など
ああああああ
## セットアップと実行

(各サービスごとの詳細を記述)

### `webhook-vercel`

...

### `transcriber`

... 
(Ensuring commit for package-lock.json move.) 

# Edge / Node アーキテクチャについて

このプロジェクトでは、Edge（Deno）環境とNode.js環境を適切に使い分けています。

## 環境分離と責務

| 処理内容 | 環境 | 実装パス | 理由 |
|--------|------|---------|------|
| Slack → Supabase アップロード | **Node.js** | `app/utils/slack-to-supabase-uploader.ts` | ストリーム処理や大容量ファイル転送はNodeが適している |
| 文字起こし処理 | **Edge (Deno)** | `supabase/functions/transcribe_with_whisper/index.ts` | 軽量なAPIリクエスト処理に最適化 |
| 要約処理 | **Edge (Node API)** | `app/api/summarize-task/route.ts` | 複雑なAI処理と複数の非同期処理 |
| Notion連携 | **Edge (Node API)** | `app/api/notion-sync/route.ts` | 外部APIとのインテグレーション |

## 開発環境設定

### Deno (Edge Functions)

```bash
# Supabase Edge Functions の依存関係チェック
cd supabase
deno cache --reload functions/**/*.ts

# Edge Functions をローカルで実行
supabase functions serve --env-file ../.env.local
```

### Node.js (API Routes)

```bash
# 開発サーバー起動
npm run dev:webhook

# Slack ファイルアップロード
npm run upload-slack -- <slack-file-url>
``` 