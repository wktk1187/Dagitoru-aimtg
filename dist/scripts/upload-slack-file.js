#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var dotenv_1 = require("dotenv");
var slack_to_supabase_uploader_ts_1 = require("../utils/slack-to-supabase-uploader.ts");
// .envから環境変数を読み込む
(0, dotenv_1.config)();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var slackFileUrl, requiredEnvVars, missingVars, result, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    slackFileUrl = process.argv[2];
                    if (!slackFileUrl) {
                        console.error('エラー: Slackファイル URL が必要です');
                        console.error('使用方法: npm run upload-slack <slack-file-url>');
                        console.error('例: npm run upload-slack https://files.slack.com/files-pri/T12345-F67890/meeting.mp4');
                        process.exit(1);
                    }
                    requiredEnvVars = [
                        'SLACK_BOT_TOKEN',
                        'UPLOAD_API_ENDPOINT',
                        'WEBHOOK_SECRET',
                    ];
                    missingVars = requiredEnvVars.filter(function (varName) { return !process.env[varName]; });
                    if (missingVars.length > 0) {
                        console.error("\u30A8\u30E9\u30FC: \u5FC5\u8981\u306A\u74B0\u5883\u5909\u6570\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093: ".concat(missingVars.join(', ')));
                        console.error('環境変数の設定または.envファイルを確認してください');
                        process.exit(1);
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    console.log("\uD83D\uDE80 Slack\u30D5\u30A1\u30A4\u30EB\u306E\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u958B\u59CB: ".concat(slackFileUrl));
                    return [4 /*yield*/, (0, slack_to_supabase_uploader_ts_1.uploadSlackFileToSupabase)({
                            slackFileUrl: slackFileUrl,
                            slackToken: process.env.SLACK_BOT_TOKEN,
                            uploadEndpoint: process.env.UPLOAD_API_ENDPOINT,
                            webhookSecret: process.env.WEBHOOK_SECRET,
                            logProgress: true,
                            maxRetries: 3,
                            metadata: {
                                cli_executed_at: new Date().toISOString(),
                                cli_version: '1.0.0'
                            }
                        })];
                case 2:
                    result = _a.sent();
                    console.log('✅ アップロード正常終了!');
                    console.log('📊 アップロード詳細:');
                    console.log("  - ID: ".concat(result.id));
                    console.log("  - \u30B9\u30C6\u30FC\u30BF\u30B9: ".concat(result.status));
                    console.log("  - \u30B9\u30C8\u30EC\u30FC\u30B8\u30D1\u30B9: ".concat(result.storage_path));
                    console.log("  - \u30D5\u30A1\u30A4\u30EB\u30B5\u30A4\u30BA: ".concat(result.file_size, " \u30D0\u30A4\u30C8"));
                    if (result.status === 'processing') {
                        console.log('\n🎬 次のステップ:');
                        console.log('  ファイルは正常にアップロードされ、現在は文字起こし処理待ちです。');
                        console.log('  処理状況は Supabase の upload_logs テーブルで確認できます。');
                    }
                    // 処理が完了した場合のみ終了コード0
                    process.exit(0);
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    console.error('❌ アップロード失敗:', error_1 instanceof Error ? error_1.message : error_1);
                    // エラーの場合は終了コード1
                    process.exit(1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// スクリプト実行
main();
