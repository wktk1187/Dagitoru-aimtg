"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.uploadSlackFileToSupabase = uploadSlackFileToSupabase;
var node_fetch_1 = require("node-fetch");
var stream_1 = require("stream");
var supabase_client_1 = require("../lib/supabase-client");
/**
 * 進捗モニタリング用のTransformストリーム
 */
var ProgressTransform = /** @class */ (function (_super) {
    __extends(ProgressTransform, _super);
    function ProgressTransform(total, onProgress, logInterval // 256KBごとにログ
    ) {
        if (logInterval === void 0) { logInterval = 262144; }
        var _this = _super.call(this) || this;
        _this.total = total;
        _this.onProgress = onProgress;
        _this.logInterval = logInterval;
        _this.transferred = 0;
        _this.lastProgressPercent = 0;
        _this.lastLogged = 0;
        return _this;
    }
    ProgressTransform.prototype._transform = function (chunk, encoding, callback) {
        this.transferred += chunk.length;
        var percent = Math.floor((this.transferred / this.total) * 100);
        // ログ間隔またはプログレス変化で通知
        if (this.transferred - this.lastLogged >= this.logInterval || percent > this.lastProgressPercent) {
            this.onProgress(this.transferred, this.total, percent);
            this.lastLogged = this.transferred;
            this.lastProgressPercent = percent;
        }
        callback(null, chunk);
    };
    return ProgressTransform;
}(stream_1.Transform));
/**
 * 指数バックオフによる自動リトライ関数
 */
function retryWithBackoff(fn_1) {
    return __awaiter(this, arguments, void 0, function (fn, maxRetries, initialDelay, onRetry) {
        var lastError, _loop_1, attempt, state_1;
        if (maxRetries === void 0) { maxRetries = 3; }
        if (initialDelay === void 0) { initialDelay = 1000; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    lastError = null;
                    _loop_1 = function (attempt) {
                        var _b, error_1, delay_1;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    _c.trys.push([0, 2, , 4]);
                                    _b = {};
                                    return [4 /*yield*/, fn()];
                                case 1: return [2 /*return*/, (_b.value = _c.sent(), _b)];
                                case 2:
                                    error_1 = _c.sent();
                                    lastError = error_1 instanceof Error ? error_1 : new Error(String(error_1));
                                    // 最後の試行ならエラーをスロー
                                    if (attempt === maxRetries - 1) {
                                        throw lastError;
                                    }
                                    delay_1 = initialDelay * Math.pow(2, attempt);
                                    if (onRetry) {
                                        onRetry(attempt + 1, delay_1, lastError);
                                    }
                                    // 待機
                                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, delay_1); })];
                                case 3:
                                    // 待機
                                    _c.sent();
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    };
                    attempt = 0;
                    _a.label = 1;
                case 1:
                    if (!(attempt < maxRetries)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1(attempt)];
                case 2:
                    state_1 = _a.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    _a.label = 3;
                case 3:
                    attempt++;
                    return [3 /*break*/, 1];
                case 4: 
                // ここに到達することはないはずだが、TypeScriptの型安全性のため
                throw lastError || new Error('Unknown error during retry');
            }
        });
    });
}
/**
 * Slackファイルを取得してSupabaseにアップロードするユーティリティ
 * プロダクションレベル実装 - 進捗監視、自動リトライ、ログ記録機能付き
 */
function uploadSlackFileToSupabase(_a) {
    return __awaiter(this, arguments, void 0, function (_b) {
        // 内部関数: ステータス更新
        function updateStatus(status, message) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            uploadStatus.status = status;
                            uploadStatus.updated_at = new Date();
                            if (message) {
                                uploadStatus.metadata = __assign(__assign({}, uploadStatus.metadata), { lastMessage: message, lastUpdated: new Date().toISOString() });
                            }
                            return [4 /*yield*/, logToDatabase(uploadStatus)];
                        case 1:
                            _a.sent();
                            console.log("[".concat(new Date().toISOString(), "] Status updated to '").concat(status, "'").concat(message ? ": ".concat(message) : ''));
                            return [2 /*return*/];
                    }
                });
            });
        }
        // 内部関数: データベースにログ記録
        function logToDatabase(status) {
            return __awaiter(this, void 0, void 0, function () {
                var error, e_1;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 2, , 3]);
                            if (!supabase_client_1.supabaseAdmin) {
                                console.warn('[Upload Logger] Supabase client not available, skipping log.');
                                return [2 /*return*/];
                            }
                            return [4 /*yield*/, supabase_client_1.supabaseAdmin
                                    .from('upload_logs')
                                    .upsert({
                                    id: status.id,
                                    task_id: status.task_id,
                                    file_name: status.file_name,
                                    storage_path: status.storage_path,
                                    status: status.status,
                                    content_type: status.content_type,
                                    file_size: status.file_size,
                                    progress: status.progress,
                                    error_message: status.error_message,
                                    metadata: status.metadata,
                                    slack_file_id: status.slack_file_id,
                                    slack_download_url: status.slack_download_url,
                                    // created_at と updated_at はDBのデフォルト値と更新トリガーに任せる
                                }, { onConflict: 'id' })];
                        case 1:
                            error = (_a.sent()).error;
                            if (error) {
                                console.warn("[".concat(new Date().toISOString(), "] Failed to log upload status:"), error);
                            }
                            return [3 /*break*/, 3];
                        case 2:
                            e_1 = _a.sent();
                            console.warn("[".concat(new Date().toISOString(), "] Error logging to database:"), e_1);
                            return [3 /*break*/, 3];
                        case 3: return [2 /*return*/];
                    }
                });
            });
        }
        var slackFileName, uploadId, fileName, uploadStatus, fileInfo, _c, uploadUrl_1, storagePath, err_1, errorMessage;
        var _this = this;
        var slackFileUrl = _b.slackFileUrl, slackToken = _b.slackToken, uploadEndpoint = _b.uploadEndpoint, webhookSecret = _b.webhookSecret, _d = _b.maxRetries, maxRetries = _d === void 0 ? 3 : _d, _e = _b.logProgress, logProgress = _e === void 0 ? true : _e, _f = _b.metadata, metadata = _f === void 0 ? {} : _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    // 拡張子チェック - mp4のみ許可
                    if (!slackFileUrl.endsWith('.mp4')) {
                        throw new Error('Only .mp4 files are supported at this time');
                    }
                    slackFileName = slackFileUrl.split('/').pop() || "slack_file_".concat(Date.now(), ".mp4");
                    uploadId = "upload_".concat(Date.now(), "_").concat(Math.random().toString(36).substring(2, 10));
                    fileName = "slack_".concat(uploadId, ".mp4");
                    uploadStatus = {
                        id: uploadId,
                        file_name: fileName,
                        storage_path: '',
                        status: 'preparing',
                        content_type: 'video/mp4',
                        slack_file_id: slackFileUrl.includes('/') ? slackFileUrl.split('/').slice(-2)[0] : undefined,
                        slack_download_url: slackFileUrl,
                        metadata: __assign({ original_file_name: slackFileName, source: 'slack' }, metadata),
                        created_at: new Date(),
                        updated_at: new Date(),
                    };
                    // Supabaseテーブルに初期状態を記録
                    return [4 /*yield*/, logToDatabase(uploadStatus)];
                case 1:
                    // Supabaseテーブルに初期状態を記録
                    _g.sent();
                    _g.label = 2;
                case 2:
                    _g.trys.push([2, 8, , 10]);
                    return [4 /*yield*/, retryWithBackoff(function () { return __awaiter(_this, void 0, void 0, function () {
                            var slackRes, contentType;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        updateStatus('preparing', 'Checking file headers from Slack');
                                        return [4 /*yield*/, (0, node_fetch_1.default)(slackFileUrl, {
                                                method: 'HEAD',
                                                headers: {
                                                    Authorization: "Bearer ".concat(slackToken),
                                                    'Accept': 'video/mp4',
                                                },
                                            })];
                                    case 1:
                                        slackRes = _a.sent();
                                        if (!slackRes.ok) {
                                            throw new Error("Slack HEAD request failed (".concat(slackRes.status, "): ").concat(slackRes.statusText));
                                        }
                                        contentType = slackRes.headers.get('content-type');
                                        if (contentType && !contentType.includes('video/mp4')) {
                                            throw new Error("Unsupported content type: ".concat(contentType, ". Only video/mp4 is supported."));
                                        }
                                        return [2 /*return*/, {
                                                contentType: contentType || 'video/mp4',
                                                contentLength: parseInt(slackRes.headers.get('content-length') || '0', 10)
                                            }];
                                }
                            });
                        }); }, maxRetries, 1000, function (attempt, delay, error) {
                            console.warn("[".concat(new Date().toISOString(), "] Retry ").concat(attempt, "/").concat(maxRetries, " after ").concat(delay, "ms for file header check: ").concat(error.message));
                        })];
                case 3:
                    fileInfo = _g.sent();
                    // ファイルサイズを記録
                    uploadStatus.file_size = fileInfo.contentLength;
                    uploadStatus.content_type = fileInfo.contentType;
                    return [4 /*yield*/, logToDatabase(uploadStatus)];
                case 4:
                    _g.sent();
                    return [4 /*yield*/, retryWithBackoff(function () { return __awaiter(_this, void 0, void 0, function () {
                            var uploadRes, errorData, data;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        updateStatus('preparing', 'Requesting upload URL');
                                        return [4 /*yield*/, (0, node_fetch_1.default)(uploadEndpoint, {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                    'Authorization': "Bearer ".concat(webhookSecret)
                                                },
                                                body: JSON.stringify({
                                                    fileName: fileName,
                                                    contentType: 'video/mp4',
                                                    metadata: {
                                                        uploadId: uploadId,
                                                        source: 'slack',
                                                        originalFileName: slackFileName
                                                    }
                                                }),
                                            })];
                                    case 1:
                                        uploadRes = _a.sent();
                                        if (!!uploadRes.ok) return [3 /*break*/, 3];
                                        return [4 /*yield*/, uploadRes.json().catch(function () { return ({ error: uploadRes.statusText }); })];
                                    case 2:
                                        errorData = _a.sent();
                                        throw new Error("Upload URL error: ".concat(errorData.error || 'Unknown error'));
                                    case 3: return [4 /*yield*/, uploadRes.json()];
                                    case 4:
                                        data = _a.sent();
                                        if (!data.uploadUrl) {
                                            throw new Error('No upload URL returned from server');
                                        }
                                        return [2 /*return*/, {
                                                uploadUrl: data.uploadUrl,
                                                storagePath: data.storagePath
                                            }];
                                }
                            });
                        }); }, maxRetries, 1000, function (attempt, delay, error) {
                            console.warn("[".concat(new Date().toISOString(), "] Retry ").concat(attempt, "/").concat(maxRetries, " after ").concat(delay, "ms for upload URL: ").concat(error.message));
                        })];
                case 5:
                    _c = _g.sent(), uploadUrl_1 = _c.uploadUrl, storagePath = _c.storagePath;
                    uploadStatus.storage_path = storagePath;
                    return [4 /*yield*/, logToDatabase(uploadStatus)];
                case 6:
                    _g.sent();
                    // 3. Slackからファイルをストリームダウンロードし、直接Supabaseへアップロード
                    return [4 /*yield*/, retryWithBackoff(function () { return __awaiter(_this, void 0, void 0, function () {
                            var slackRes, fileBuffer, updateProgressCallback, transferred, total, putRes, errorText;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        updateStatus('uploading', 'Downloading from Slack and uploading to storage');
                                        return [4 /*yield*/, (0, node_fetch_1.default)(slackFileUrl, {
                                                headers: {
                                                    Authorization: "Bearer ".concat(slackToken),
                                                    'Accept': 'video/mp4',
                                                },
                                            })];
                                    case 1:
                                        slackRes = _a.sent();
                                        if (!slackRes.ok) {
                                            throw new Error("Slack fetch failed (".concat(slackRes.status, "): ").concat(slackRes.statusText));
                                        }
                                        return [4 /*yield*/, slackRes.buffer()];
                                    case 2:
                                        fileBuffer = _a.sent();
                                        updateProgressCallback = function (transferred, total, percent) {
                                            if (logProgress) {
                                                console.log("[".concat(new Date().toISOString(), "] Progress: ").concat(percent, "% (").concat(transferred, "/").concat(total, " bytes)"));
                                            }
                                            // 10%ごとにDBアップデート
                                            if (percent % 10 === 0 || percent === 100) {
                                                uploadStatus.progress = percent;
                                                logToDatabase(uploadStatus).catch(console.error);
                                            }
                                        };
                                        transferred = 0;
                                        total = uploadStatus.file_size || fileBuffer.length;
                                        return [4 /*yield*/, (0, node_fetch_1.default)(uploadUrl_1, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'video/mp4' },
                                                body: fileBuffer,
                                            })];
                                    case 3:
                                        putRes = _a.sent();
                                        // 進捗を100%として更新
                                        updateProgressCallback(total, total, 100);
                                        if (!!putRes.ok) return [3 /*break*/, 5];
                                        return [4 /*yield*/, putRes.text().catch(function () { return putRes.statusText; })];
                                    case 4:
                                        errorText = _a.sent();
                                        throw new Error("Upload failed (".concat(putRes.status, "): ").concat(errorText));
                                    case 5:
                                        updateStatus('uploaded', 'File successfully uploaded');
                                        return [2 /*return*/, true];
                                }
                            });
                        }); }, maxRetries, 1000, function (attempt, delay, error) {
                            updateStatus('uploading', "Retry ".concat(attempt, "/").concat(maxRetries, " after ").concat(delay, "ms: ").concat(error.message));
                            console.warn("[".concat(new Date().toISOString(), "] Retry ").concat(attempt, "/").concat(maxRetries, " after ").concat(delay, "ms for upload: ").concat(error.message));
                        })];
                case 7:
                    // 3. Slackからファイルをストリームダウンロードし、直接Supabaseへアップロード
                    _g.sent();
                    // 最終ステータス更新 - 処理待ち状態に
                    updateStatus('processing', 'Awaiting transcription processing');
                    return [2 /*return*/, uploadStatus];
                case 8:
                    err_1 = _g.sent();
                    errorMessage = err_1 instanceof Error ? err_1.message : String(err_1);
                    console.error("[".concat(new Date().toISOString(), "] \u274C Upload failed:"), errorMessage);
                    uploadStatus.status = 'failed';
                    uploadStatus.error_message = errorMessage;
                    uploadStatus.updated_at = new Date();
                    return [4 /*yield*/, logToDatabase(uploadStatus)];
                case 9:
                    _g.sent();
                    throw err_1;
                case 10: return [2 /*return*/];
            }
        });
    });
}
