# 文字起こしパイプライン検証手順書

この文書では、Slack→Vercel→Supabase→Cloud Run→Vercelの文字起こしパイプラインが正しく機能しているか確認するための手順を説明します。

## 前提条件

- 必要な環境変数がすべて設定されていること
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_ROLE_KEY
  - SLACK_BOT_TOKEN
  - WEBHOOK_SECRET
  - NEXT_PUBLIC_APP_URL
  - CLOUD_RUN_TRANSCRIBE_URL
  - GCS_BUCKET
  - SUMMARIZE_TASK_ENDPOINT
  - GEMINI_API_KEY (要約用)

## 検証手順

### 1. 全体フローの確認

#### フェーズ1: Slack → Vercel → Supabase

1. Slackで`/transcribe`コマンドまたは動画ファイルをアップロード
2. Vercelのログを確認:
   - `/api/slack/intake`のログで、リクエストが受信されていることを確認
   - Supabaseへのファイルアップロードが成功していることを確認
   - `transcription_tasks`テーブルへのタスク追加が成功していることを確認
   - `/api/start-task`の呼び出しが成功していることを確認

#### フェーズ2: Vercel → Cloud Run

3. `/api/start-task`のログを確認:
   - タスクの取得が成功していることを確認
   - 署名付きURL取得が成功していることを確認
   - Cloud Runへのリクエスト送信が成功していることを確認

4. Google Cloud Consoleで Cloud Run のログを確認:
   - Cloud Runサービスへのリクエストが到達していることを確認
   - ログに`req.body:`として、送信したペイロードが表示されていることを確認
   - 文字起こしプロセスが開始されていることを確認

#### フェーズ3: Cloud Run → Vercel (要約)

5. 文字起こし完了後、Cloud Runから`/api/summarize-task`へのPOSTリクエストが送信されていることを確認
6. `/api/summarize-task`のログを確認:
   - リクエストが受信されていることを確認
   - transcriptが正しく受け取られていることを確認
   - Geminiでの要約処理が開始されていることを確認

#### フェーズ4: 最終確認

7. Supabaseのデータベースを確認:
   - `transcription_tasks`テーブルで、タスクのステータスが`completed`になっていることを確認
   - `final_summary`フィールドに要約結果が格納されていることを確認

## エラーケースと調査方法

### Slack → Vercel (フェーズ1)でのエラー

- Slackコマンドが応答しない:
  - Slackアプリの設定を確認
  - Vercelのデプロイ状態を確認
  - `/api/slack/intake`のURLが正しく設定されているか確認

- ファイルアップロードに失敗:
  - Vercelのログを確認
  - Supabaseの接続設定を確認
  - Supabaseのストレージバケット設定を確認

### Vercel → Cloud Run (フェーズ2)でのエラー

- Cloud Runへのリクエストが失敗:
  - `CLOUD_RUN_TRANSCRIBE_URL`環境変数が正しく設定されているか確認
  - Cloud Runサービスが起動しているか確認
  - Cloud Runのログでエラーを確認
  - 権限設定に問題がないか確認

### Cloud Run → Vercel (フェーズ3)でのエラー

- 要約リクエストが失敗:
  - Cloud Runの`SUMMARIZE_TASK_ENDPOINT`環境変数が正しく設定されているか確認
  - Cloud Runのログでエラーを確認
  - `/api/summarize-task`エンドポイントが正しく機能しているか確認

## ログ調査のポイント

- Vercelのログ:
  - ダッシュボード > プロジェクト > Deployments > 最新のデプロイメント > Logs
  - タイムスタンプで時系列を確認
  - `/api/slack/intake`、`/api/start-task`、`/api/summarize-task`の各エンドポイントのログを確認

- Cloud Runのログ:
  - Google Cloud Console > Cloud Run > transcriber-service > ログ
  - リクエスト受信、ファイル処理、レスポンス送信の各ステップを確認

- Supabaseのデータ:
  - Supabaseダッシュボード > テーブルエディタ > transcription_tasks
  - タスクのステータス変化を確認
  - エラーメッセージが記録されている場合は確認

## テストコマンド

サンプルビデオを使ってテストする場合:

```bash
# 開発環境のテスト
npm run dev:webhook
npm run upload-slack -- <slack-file-url>
``` 