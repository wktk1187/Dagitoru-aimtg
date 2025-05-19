import { NextRequest, NextResponse } from 'npm:next/server';
import { Client as NotionClient } from 'npm:@notionhq/client';
import type { CreatePageParameters, BlockObjectRequest } from 'npm:@notionhq/client/build/src/api-endpoints';
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js';

// 環境変数
const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');
const NEXT_PUBLIC_SUPABASE_URL = Deno.env.get('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');

// 初期化
const notion = NOTION_API_KEY ? new NotionClient({ auth: NOTION_API_KEY }) : null;
const supabase: SupabaseClient | null = (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

interface NotionSyncPayload { taskId: string; }

interface TranscriptionTask {
  id: string;
  consultant_name?: string;
  company_name?: string;
  company_type?: string;
  company_problem?: string;
  meeting_date?: string;
  meeting_count?: number;
  meeting_type?: string; // lintで未使用指摘があったが、もし使うならこの型定義は残す
  support_area?: string;
  company_phase?: string;
  internal_sharing_items?: string;
  final_summary: string;
  status: string;
  error_message?: string;
  notion_page_id?: string;
  created_at?: string;
  updated_at?: string;
}

interface NotionDbMap {
  id: string;
  kind: 'all' | 'consultant' | 'company';
  name: string;
  page_id: string;
  db_id: string;
  updated_at: string;
}

export async function POST(req: NextRequest) {
  // 認可
  if (!WEBHOOK_SECRET) return NextResponse.json({ error: 'Server misconfig' }, { status: 500 });
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ') || auth.substring(7) !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!supabase || !notion) {
    return NextResponse.json({ error: 'Server not configured (supabase or notion)' }, { status: 500 });
  }

  let payload: NotionSyncPayload;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { taskId } = payload;
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 });

  // 1. transcription_tasks 取得
  const { data: taskData, error: tErr } = await supabase
    .from('transcription_tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  const task = taskData as TranscriptionTask | null;

  if (tErr || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const {
    consultant_name = 'なし',
    company_name = 'なし',
    company_type = 'エラー',
    company_problem = 'なし',
    meeting_date = 'なし',
    meeting_count,
    meeting_type: _meeting_type = 'エラー',
    support_area = 'エラー',
    company_phase = 'なし',
    internal_sharing_items = 'なし',
    final_summary,
  } = task;

  if (!final_summary) {
    return NextResponse.json({ error: 'final_summary missing' }, { status: 400 });
  }

  // 2. map 取得
  const { data: mapsRaw, error: mErr } = await supabase
    .from('notion_db_map')
    .select('*')
    .in('kind', ['all', 'consultant', 'company'])
    .in('name', [consultant_name, company_name, 'all']);

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const maps = (mapsRaw ?? []) as NotionDbMap[];

  const getDb = (
    mapsArr: NotionDbMap[],
    kind: 'all' | 'consultant' | 'company',
    nameVal: string,
  ): NotionDbMap | undefined => mapsArr.find((m) => m.kind === kind && m.name === nameVal);

  const allMap = getDb(maps, 'all', 'all');
  const consMap = getDb(maps, 'consultant', consultant_name);
  const compMap = getDb(maps, 'company', company_name);

  if (!allMap || !consMap || !compMap) {
    await supabase.from('transcription_tasks').update({ status: 'notion_failed', error_message: 'Mapping not found' }).eq('id', taskId);
    return NextResponse.json({ error: 'Mapping not found for some target DB' }, { status: 400 });
  }

  // この時点で allMap, consMap, compMap は NotionDbMap 型であることが保証される
  const targets: NotionDbMap[] = [allMap, consMap, compMap];

  const buildProperties = () => ({
    '面談日': { title: [{ text: { content: `${meeting_date}` } }] },
    '企業名': { rich_text: [{ text: { content: company_name || 'なし' } }] },
    'コンサルタント名': { rich_text: [{ text: { content: consultant_name || 'なし' } }] },
    '企業タイプ': { status: { name: company_type || 'エラー' } },
    '企業の課題': { rich_text: [{ text: { content: company_problem || 'なし' } }] },
    '面談回数': { number: meeting_count ?? null },
    '支援領域': { status: { name: support_area || 'エラー' } },
    '企業のフェーズ': { rich_text: [{ text: { content: company_phase || 'なし' } }] },
    '社内共有が必要な事項': { rich_text: [{ text: { content: internal_sharing_items || 'なし' } }] },
  });

  const children: BlockObjectRequest[] = [
    {
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: final_summary } }],
      },
    },
  ];

  const createPage = async (dbId: string) => {
    const properties = buildProperties() as CreatePageParameters['properties'];
    return await notion.pages.create({ parent: { database_id: dbId }, properties, children });
  };

  try {
    const results = await Promise.all(targets.map(t => createPage(t.db_id)));
    await supabase.from('transcription_tasks').update({ notion_page_id: JSON.stringify({ all: results[0].id, consultant: results[1].id, company: results[2].id }) }).eq('id', taskId);
    return NextResponse.json({ message: 'Notion pages created', ids: results.map(r => r.id) });
  } catch (e) {
    await supabase.from('transcription_tasks').update({ status: 'notion_failed', error_message: (e as Error).message }).eq('id', taskId);
    return NextResponse.json({ error: 'Failed to create notion pages', details: (e as Error).message }, { status: 500 });
  }
} 