-- supabase/migrations/20231105_create_upload_logs.sql

-- アップロードの進捗と状態を追跡するテーブル
CREATE TABLE IF NOT EXISTS public.upload_logs (
  id TEXT PRIMARY KEY, -- 一意のアップロードID
  task_id UUID REFERENCES public.transcription_tasks(id), -- 関連するタスクID（後から設定される可能性あり）
  file_name TEXT NOT NULL, -- アップロードされたファイル名
  storage_path TEXT, -- Supabase Storage内のパス
  status TEXT NOT NULL, -- アップロードステータス (preparing/uploading/uploaded/processing/completed/failed)
  content_type TEXT NOT NULL, -- ファイルのContent-Type
  file_size BIGINT, -- ファイルサイズ（バイト）
  progress INTEGER, -- アップロード進捗（パーセント）
  error_message TEXT, -- エラー発生時のメッセージ
  metadata JSONB, -- 追加情報（任意）
  slack_file_id TEXT, -- Slack File ID
  slack_download_url TEXT, -- Slack ダウンロードURL
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- 作成日時
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() -- 更新日時
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_upload_logs_status ON public.upload_logs(status);
CREATE INDEX IF NOT EXISTS idx_upload_logs_created_at ON public.upload_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_upload_logs_task_id ON public.upload_logs(task_id);

-- Row Level Security
ALTER TABLE public.upload_logs ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーのみ読み取り可能
CREATE POLICY "Authenticated users can read upload logs" 
  ON public.upload_logs FOR SELECT 
  USING (auth.role() = 'authenticated');

-- 認証済みユーザーが挿入可能
CREATE POLICY "Authenticated users can insert upload logs" 
  ON public.upload_logs FOR INSERT 
  WITH CHECK (auth.role() = 'authenticated');

-- 認証済みユーザーが自分の作成したレコードを更新可能
CREATE POLICY "Authenticated users can update own upload logs" 
  ON public.upload_logs FOR UPDATE
  USING (auth.role() = 'authenticated');

-- 更新日時自動更新トリガー
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_upload_logs_updated_at
BEFORE UPDATE ON public.upload_logs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- サービスロールはすべての操作が可能
CREATE POLICY "Service role can perform all operations" 
  ON public.upload_logs FOR ALL 
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.upload_logs IS '動画ファイルのアップロード進捗と状態を追跡するテーブル'; 