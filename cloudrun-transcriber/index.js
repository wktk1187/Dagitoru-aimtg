require('dotenv').config({ path: '../.env.local' }); // .env.local はCloud Runでは使われません
const express = require('express');
const { Storage } = require('@google-cloud/storage');
const speech = require('@google-cloud/speech');
const fetch = require('node-fetch'); // package.json とバージョン一致
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // ← 存在します
const fs = require('fs');
const path = require('path');
const os = require('os');

// === 追加: 一時ファイル用ディレクトリを定義 ===
const AUDIO_DIR = path.join(os.tmpdir(), 'audio');
const VIDEO_DIR = path.join(os.tmpdir(), 'video');
const CREDS_PATH = path.join(os.tmpdir(), 'gcp-creds.json');

// ディレクトリ作成（なければ）
fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

if (process.env.GOOGLE_CREDENTIALS_BASE64) {
  try {
    const decodedCredentials = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
    fs.writeFileSync(CREDS_PATH, decodedCredentials);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = CREDS_PATH;
    console.log(`✅ Wrote Google credentials to ${CREDS_PATH}`);
    // 健全性チェック
    try {
      const raw = fs.readFileSync(CREDS_PATH, 'utf8');
      JSON.parse(raw);
      console.log('✅ GCP Credentials OK');
    } catch (err) {
      console.error('❌ GCP Credentials are BROKEN:', err.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('CRITICAL: Failed to process GOOGLE_CREDENTIALS_BASE64. Application may not authenticate with Google Cloud services.', error);
    process.exit(1);
  }
}

const app = express();
app.use(express.json());

const storage = new Storage();
const speechClient = new speech.SpeechClient();

ffmpeg.setFfmpegPath(ffmpegPath);

app.post('/transcribe', async (req, res) => {
  // 追加: 受信ヘッダーを全てログ出力
  console.log("Headers received:", req.headers);

  // 認証ヘッダーの防御的検証
  const authHeader = req.headers["x-vercel-secret"];
  if (!authHeader) {
    console.warn("/transcribe: Missing x-vercel-secret header", authHeader);
    return res.status(401).send("Missing x-vercel-secret header");
  }
  if (authHeader !== process.env.WEBHOOK_SECRET) {
    console.warn("/transcribe: Unauthorized - token mismatch");
    return res.status(401).send("Unauthorized");
  }

  console.log(`/transcribe: Received request. Body:`, JSON.stringify(req.body, null, 2));
  const { signedUrl, gcsBucket, gcsDestPath, taskId } = req.body;
  if (!signedUrl || !gcsBucket || !gcsDestPath || !taskId) {
    console.error('/transcribe: Missing required parameters', req.body);
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // ここで一時ファイル名をサブディレクトリ＋prefix付きで生成
  const tmpVideoPath = path.join(VIDEO_DIR, `video_${taskId}_${Date.now()}.mp4`);
  const tmpAudioPath = path.join(AUDIO_DIR, `audio_${taskId}_${Date.now()}.mp3`);

  try {
    // 1. Supabase署名付きURLから動画ダウンロード
    console.log(`/transcribe: Downloading video from signed URL for task ${taskId}`);
    const videoRes = await fetch(signedUrl);
    if (!videoRes.ok) throw new Error(`Failed to download video from Supabase: ${videoRes.status} ${videoRes.statusText}`);
    const fileStream = fs.createWriteStream(tmpVideoPath);
    await new Promise((resolve, reject) => {
      videoRes.body.pipe(fileStream);
      videoRes.body.on('error', reject);
      fileStream.on('finish', resolve);
    });
    console.log(`/transcribe: Video downloaded successfully to ${tmpVideoPath}`);

    // 2. FFmpegで音声抽出
    console.log(`/transcribe: Extracting audio from video for task ${taskId}`);
    await new Promise((resolve, reject) => {
      ffmpeg(tmpVideoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioFrequency(16000)
        .audioChannels(1)
        .audioBitrate('64k')
        .save(tmpAudioPath)
        .on('end', resolve)
        .on('error', reject);
    });
    console.log(`/transcribe: Audio extracted successfully to ${tmpAudioPath}`);

    // 3. GCSにアップロード
    console.log(`/transcribe: Uploading audio to GCS bucket ${gcsBucket}/${gcsDestPath}`);
    await storage.bucket(gcsBucket).upload(tmpAudioPath, {
      destination: gcsDestPath,
    });
    const gcsUri = `gs://${gcsBucket}/${gcsDestPath}`;
    console.log(`/transcribe: Audio uploaded successfully to ${gcsUri}`);

    // 4. Speech-to-Text
    console.log(`/transcribe: Starting speech recognition for task ${taskId}`);
    const request = {
      audio: { uri: gcsUri },
      config: {
        encoding: 'MP3',
        sampleRateHertz: 16000,
        languageCode: 'ja-JP',
      },
    };
    const [operation] = await speechClient.longRunningRecognize(request);
    console.log(`/transcribe: Waiting for speech recognition to complete for task ${taskId}`);
    const [response] = await operation.promise();
    const finalTranscript = response.results.map(r => r.alternatives[0].transcript).join('\n');
    console.log(`/transcribe: Speech recognition completed for task ${taskId}, transcript length: ${finalTranscript.length} chars`);

    // 5. /api/summarize-task へPOST
    if (finalTranscript && process.env.SUMMARIZE_TASK_ENDPOINT && process.env.WEBHOOK_SECRET) {
      console.log(`/transcribe: Posting transcript to summarize-task endpoint for task ${taskId}`);
      const summarizeRes = await fetch(process.env.SUMMARIZE_TASK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WEBHOOK_SECRET}`
        },
        body: JSON.stringify({
          taskId,
          transcript: finalTranscript
        })
      });
      if (!summarizeRes.ok) {
        const errText = await summarizeRes.text();
        console.error(`/transcribe: /api/summarize-task failed: ${summarizeRes.status} ${errText}`);
        throw new Error(`/api/summarize-task failed: ${summarizeRes.status} ${errText}`);
      }
      console.log(`/transcribe: Transcript successfully sent to summarize-task endpoint for task ${taskId}`);
    } else {
      console.warn(`/transcribe: Not sending to summarize-task - Missing endpoint URL or webhook secret, or empty transcript`);
    }

    // 6. クリーンアップ
    console.log(`/transcribe: Cleaning up temporary files for task ${taskId}`);
    fs.unlinkSync(tmpVideoPath);
    fs.unlinkSync(tmpAudioPath);
    // await storage.bucket(gcsBucket).file(gcsDestPath).delete(); // 必要なら

    console.log(`/transcribe: Process completed successfully for task ${taskId}`);
    res.status(200).json({ message: 'Transcription and summarize-task POST successful', taskId });

  } catch (err) {
    // クリーンアップ
    console.error(`/transcribe: Error processing task ${taskId}:`, err);
    if (fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);
    if (fs.existsSync(tmpAudioPath)) fs.unlinkSync(tmpAudioPath);
    res.status(500).json({ error: err.message });
  }
});

// ヘルスチェック用のエンドポイント
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Cloud Run transcriber service is running' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Cloud Run transcription service listening on port ${PORT}`);
});
