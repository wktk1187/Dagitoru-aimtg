#!/usr/bin/env node
import { config } from 'dotenv';
import { uploadSlackFileToSupabase } from '../utils/slack-to-supabase-uploader.ts';

// .envから環境変数を読み込む
config();

async function main() {
  // コマンドライン引数からSlackファイルURLを取得
  const slackFileUrl = process.argv[2];
  
  if (!slackFileUrl) {
    console.error('エラー: Slackファイル URL が必要です');
    console.error('使用方法: npm run upload-slack <slack-file-url>');
    console.error('例: npm run upload-slack https://files.slack.com/files-pri/T12345-F67890/meeting.mp4');
    process.exit(1);
  }
  
  // 必要な環境変数のチェック
  const requiredEnvVars = [
    'SLACK_BOT_TOKEN',
    'UPLOAD_API_ENDPOINT',
    'WEBHOOK_SECRET',
  ];
  
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    console.error(`エラー: 必要な環境変数が見つかりません: ${missingVars.join(', ')}`);
    console.error('環境変数の設定または.envファイルを確認してください');
    process.exit(1);
  }
  
  try {
    console.log(`🚀 Slackファイルのアップロード開始: ${slackFileUrl}`);
    
    const result = await uploadSlackFileToSupabase({
      slackFileUrl,
      slackToken: process.env.SLACK_BOT_TOKEN!,
      uploadEndpoint: process.env.UPLOAD_API_ENDPOINT!,
      webhookSecret: process.env.WEBHOOK_SECRET!,
      logProgress: true,
      maxRetries: 3,
      metadata: {
        cli_executed_at: new Date().toISOString(),
        cli_version: '1.0.0'
      }
    });
    
    console.log('✅ アップロード正常終了!');
    console.log('📊 アップロード詳細:');
    console.log(`  - ID: ${result.id}`);
    console.log(`  - ステータス: ${result.status}`);
    console.log(`  - ストレージパス: ${result.storage_path}`);
    console.log(`  - ファイルサイズ: ${result.file_size} バイト`);
    
    if (result.status === 'processing') {
      console.log('\n🎬 次のステップ:');
      console.log('  ファイルは正常にアップロードされ、現在は文字起こし処理待ちです。');
      console.log('  処理状況は Supabase の upload_logs テーブルで確認できます。');
    }
    
    // 処理が完了した場合のみ終了コード0
    process.exit(0);
  } catch (error) {
    console.error('❌ アップロード失敗:', error instanceof Error ? error.message : error);
    // エラーの場合は終了コード1
    process.exit(1);
  }
}

// スクリプト実行
main(); 