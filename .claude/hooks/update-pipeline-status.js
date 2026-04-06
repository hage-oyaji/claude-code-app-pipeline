#!/usr/bin/env node
/**
 * Agent ツールの PreToolUse / PostToolUse フック（工程内並列対応版）。
 *
 * ■ 工程間: 逐次（前工程完了 → 次工程開始。異なる工程の同時実行はブロック）
 * ■ 工程内: 隊長がサブタスク分割 → 同一工程のn体エージェントを並列投入
 *
 * 並列制御:
 * - 命令書（prompt）内の【サブタスク: {id}】【担当範囲: {scope}】を解析
 * - 担当範囲の重複を検知してブロック（同じファイル/モジュールを複数エージェントが触らない）
 * - ファイルロックで pipeline-status.json への並列書き込み競合を防止
 * - 全サブタスク完了 → 工程完了
 */

const fs = require("fs");
const path = require("path");

// エージェント名 → 工程キーのマッピング
const AGENT_STAGE_MAP = {
  "要件定義エージェント": "requirements",
  "データモデリングエージェント": "data-modeling",
  "基本設計エージェント": "design",
  "コーディングエージェント": "coding",
  "単体テストエージェント": "unit-test",
  "強化テストエージェント": "enhanced-test",
  "完全テストエージェント": "complete-test",
  "結合テストエージェント": "integration-test",
  "スキル開発エージェント": "skill-dev",
  "プロジェクトルール解析エージェント": "project-rule",
  "requirements": "requirements",
  "data-modeling": "data-modeling",
  "design": "design",
  "coding": "coding",
  "unit-test": "unit-test",
  "enhanced-test": "enhanced-test",
  "complete-test": "complete-test",
  "integration-test": "integration-test",
  "skill-dev": "skill-dev",
  "project-rule": "project-rule",
};

const DEBUG_LOG = path.join(__dirname, "..", "..", "pipeline", "hook-debug.log");

const PIPELINE_ORDER = [
  "requirements", "data-modeling", "design",
  "project-rule", "coding", "unit-test", "integration-test",
  "skill-dev",
];

// 工程内並列（サブタスク分割）を許可する工程
const PARALLEL_ALLOWED_STAGES = ["coding", "unit-test", "enhanced-test", "complete-test"];

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
}

function getStatusFilePath() {
  return path.join(getProjectDir(), "pipeline", "pipeline-status.json");
}

function getLockFilePath() {
  return path.join(getProjectDir(), "pipeline", ".pipeline-status.lock");
}

// === ファイルロック ===

function acquireLock(lockPath, maxWaitMs = 5000) {
  const start = Date.now();
  const retryInterval = 50;
  while (true) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        const lockStat = fs.statSync(lockPath);
        const age = Date.now() - lockStat.mtimeMs;
        if (age > 10000) {
          fs.unlinkSync(lockPath);
          process.stderr.write(`[pipeline] 古いロック解除 (age=${Math.round(age / 1000)}s)\n`);
          continue;
        }
      } catch { /* ignore */ }

      if (Date.now() - start > maxWaitMs) {
        process.stderr.write(`[pipeline] ロック取得タイムアウト (${maxWaitMs}ms)\n`);
        return false;
      }
      const waitUntil = Date.now() + retryInterval;
      while (Date.now() < waitUntil) { /* spin */ }
    }
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
}

// === 命令書からサブタスク情報を解析 ===

function parseSubtaskInfo(prompt) {
  if (!prompt) return null;

  const idMatch = prompt.match(/【サブタスク[:：]\s*(.+?)】/);
  const scopeMatch = prompt.match(/【担当範囲[:：]\s*(.+?)】/);

  if (!idMatch) return null;

  const id = idMatch[1].trim();
  const scope = scopeMatch
    ? scopeMatch[1].split(/[,、]/).map(s => s.trim()).filter(Boolean)
    : [];

  return { id, scope };
}

/** 2つのスコープリストに重複があるか判定 */
function scopesOverlap(scopeA, scopeB) {
  if (!scopeA || !scopeB || scopeA.length === 0 || scopeB.length === 0) return false;
  for (const a of scopeA) {
    for (const b of scopeB) {
      // 完全一致 or 一方が他方のプレフィックス（ディレクトリ包含）
      if (a === b) return true;
      const aNorm = a.replace(/\\/g, "/").replace(/\/$/, "");
      const bNorm = b.replace(/\\/g, "/").replace(/\/$/, "");
      if (aNorm === bNorm) return true;
      if (aNorm.startsWith(bNorm + "/") || bNorm.startsWith(aNorm + "/")) return true;
    }
  }
  return false;
}

// === pipeline-status.json 管理 ===

function createInitialStatus() {
  const formatPath = path.join(getProjectDir(), "pipeline", "pipeline-status-format.json");
  try {
    const fmt = JSON.parse(fs.readFileSync(formatPath, "utf-8"));
    fmt.pipeline.updated_at = nowISO();
    return fmt;
  } catch {
    const now = nowISO();
    const stages = {};
    for (const key of PIPELINE_ORDER) {
      stages[key] = {
        status: "not_started", started_at: null, completed_at: null,
        duration_seconds: 0, run_count: 0, error_count: 0, rework_count: 0,
        last_error: null, quality_gate_passed: false,
        parallel: false, subtasks: [], runs: [],
      };
    }
    return {
      pipeline: {
        status: "not_started", current_stage: null, active_agents: [],
        started_at: null, updated_at: now, completed_at: null,
        total_input_tokens: 0, total_output_tokens: 0,
        total_duration_seconds: 0, total_rework_count: 0,
        token_limit: null, token_limit_reached: false,
        initial_command: null, last_completed_stage: null, max_parallel: 3,
        checkpoint: { last_successful_stage: null, last_successful_at: null },
      },
      retry_policy: { max_retries_per_stage: 2, retry_on: ["timeout", "context_overflow", "agent_error"] },
      quality_gates: {},
      observability: { stage_metrics: {}, rework_log: [] },
      stages,
    };
  }
}

function loadStatus(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return null; }
}

function ensureStatus(filePath) {
  let status = loadStatus(filePath);
  if (!status) {
    status = createInitialStatus();
    saveStatus(filePath, status);
    process.stderr.write(`[pipeline] pipeline-status.json を初期生成: ${filePath}\n`);
  }
  return migrateStatus(status);
}

function migrateStatus(status) {
  const p = status.pipeline;
  if (p.completed_at === undefined) p.completed_at = null;
  if (p.total_duration_seconds === undefined) p.total_duration_seconds = 0;
  if (p.total_rework_count === undefined) p.total_rework_count = 0;
  if (p.last_completed_stage === undefined) p.last_completed_stage = null;
  if (!p.checkpoint) p.checkpoint = { last_successful_stage: null, last_successful_at: null };
  if (p.current_stage === undefined) p.current_stage = null;
  if (!Array.isArray(p.active_agents)) p.active_agents = [];
  if (p.max_parallel === undefined) p.max_parallel = 3;

  // 旧 current_agent (単数文字列) → active_agents マイグレーション
  if (p.current_agent !== undefined) {
    if (p.current_agent && p.active_agents.length === 0) {
      p.active_agents = [{ agent: p.current_agent, stage: null, subtask_id: null, started_at: null }];
    }
    delete p.current_agent;
  }

  // 旧 checkpoint.last_successful_stages (配列) → 単数に戻す
  if (p.checkpoint.last_successful_stages !== undefined) {
    const arr = p.checkpoint.last_successful_stages;
    if (Array.isArray(arr) && arr.length > 0) {
      // PIPELINE_ORDER 上で最後のものを採用
      let last = null;
      for (const k of PIPELINE_ORDER) { if (arr.includes(k)) last = k; }
      p.checkpoint.last_successful_stage = last;
    }
    delete p.checkpoint.last_successful_stages;
  }

  if (!status.retry_policy) {
    status.retry_policy = { max_retries_per_stage: 2, retry_on: ["timeout", "context_overflow", "agent_error"] };
  }
  if (!status.quality_gates) status.quality_gates = {};
  if (!status.observability) status.observability = { stage_metrics: {}, rework_log: [] };

  for (const key of PIPELINE_ORDER) {
    const stage = status.stages[key];
    if (!stage) continue;
    if (stage.duration_seconds === undefined) stage.duration_seconds = 0;
    if (stage.error_count === undefined) stage.error_count = 0;
    if (stage.rework_count === undefined) stage.rework_count = 0;
    if (stage.last_error === undefined) stage.last_error = null;
    if (stage.quality_gate_passed === undefined) stage.quality_gate_passed = false;
    if (stage.parallel === undefined) stage.parallel = false;
    if (!Array.isArray(stage.subtasks)) stage.subtasks = [];
    // 旧 dependencies フィールドを削除
    if (stage.dependencies !== undefined) delete stage.dependencies;
  }

  return status;
}

function saveStatus(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function determinePipelineStatus(stages) {
  const statuses = PIPELINE_ORDER.map((k) => stages[k]?.status || "not_started");
  if (statuses.some((s) => s === "suspended")) return "suspended";
  if (statuses.some((s) => s === "error")) return "error";
  if (statuses.every((s) => s === "completed" || s === "skipped")) return "completed";
  if (statuses.some((s) => s === "in_progress" || s === "completed")) return "in_progress";
  return "not_started";
}

/** 前工程の品質ゲートを検証する（逐次パイプライン） */
function checkPreviousStageQualityGate(status, stageKey) {
  const stageIndex = PIPELINE_ORDER.indexOf(stageKey);
  if (stageIndex <= 0) return { passed: true, message: "" };

  const prevStageKey = PIPELINE_ORDER[stageIndex - 1];
  const prevStage = status.stages[prevStageKey];

  if (prevStage && prevStage.status !== "completed" && prevStage.status !== "skipped") {
    return {
      passed: false,
      message: `前工程「${prevStageKey}」が未完了（status: ${prevStage.status}）のため開始できません。`,
    };
  }

  const gates = status.quality_gates;
  if (!gates || !gates[prevStageKey]) return { passed: true, message: "" };

  const gate = gates[prevStageKey];
  const projectDir = getProjectDir();
  const missing = [];

  if (gate.required_artifacts && Array.isArray(gate.required_artifacts)) {
    for (const artifact of gate.required_artifacts) {
      const fullPath = path.join(projectDir, artifact);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && gate.min_file_size_bytes && stat.size < gate.min_file_size_bytes) {
          missing.push(`${artifact}（サイズ不足: ${stat.size}B < ${gate.min_file_size_bytes}B）`);
        }
      } catch {
        missing.push(`${artifact}（存在しない）`);
      }
    }
  }

  if (missing.length > 0) {
    return {
      passed: false,
      message: `前工程「${prevStageKey}」の品質ゲート未通過。不足:\n${missing.map(m => "  - " + m).join("\n")}`,
    };
  }

  if (prevStage) prevStage.quality_gate_passed = true;
  return { passed: true, message: "" };
}

function detectAgentError(toolResponse) {
  if (!toolResponse) return { hasError: false, errorType: null, errorMessage: null };
  const text = typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse);

  if (text.includes("context_length_exceeded") || text.includes("context window") || text.includes("too many tokens")) {
    return { hasError: true, errorType: "context_overflow", errorMessage: "コンテキスト長超過" };
  }
  if (text.includes("timed out") || text.includes("timeout") || text.includes("ETIMEDOUT")) {
    return { hasError: true, errorType: "timeout", errorMessage: "タイムアウト" };
  }
  if (text.includes("\"error\"") || text.includes("agent_error") || text.includes("Agent failed")) {
    return { hasError: true, errorType: "agent_error", errorMessage: "エージェント実行エラー" };
  }
  return { hasError: false, errorType: null, errorMessage: null };
}

function extractTokens(toolResponse) {
  let inputTokens = 0, outputTokens = 0;
  if (!toolResponse) return { inputTokens, outputTokens };

  let obj = toolResponse;
  if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch { obj = null; } }

  if (obj && typeof obj === "object") {
    if (obj.totalTokens) {
      const usage = obj.usage || {};
      outputTokens = usage.output_tokens || 0;
      inputTokens = obj.totalTokens - outputTokens;
      return { inputTokens, outputTokens };
    }
    const usage = obj.usage || {};
    if (usage.input_tokens !== undefined) {
      inputTokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      outputTokens = usage.output_tokens || 0;
      return { inputTokens, outputTokens };
    }
  }

  const text = typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse);
  const totalMatch = text.match(/totalTokens["\s:]+(\d+)/);
  if (totalMatch) inputTokens = parseInt(totalMatch[1], 10);
  return { inputTokens, outputTokens };
}

function nowISO() { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }

function calcDurationSeconds(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  return Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 1000);
}

function extractReportText(toolResponse) {
  if (!toolResponse) return "";
  let obj = toolResponse;
  if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch { return toolResponse; } }
  if (obj.content && Array.isArray(obj.content)) {
    const texts = obj.content.filter(c => c.type === "text" && c.text).map(c => c.text);
    if (texts.length > 0) return texts.join("\n");
  }
  return typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse);
}

function updateObservability(status) {
  if (!status.observability) status.observability = { stage_metrics: {}, rework_log: [] };
  const metrics = {};
  let totalDuration = 0, totalRework = 0;

  for (const key of PIPELINE_ORDER) {
    const stage = status.stages[key];
    if (!stage) continue;
    const m = {
      status: stage.status, run_count: stage.run_count || 0,
      error_count: stage.error_count || 0, rework_count: stage.rework_count || 0,
      duration_seconds: stage.duration_seconds || 0, total_tokens: 0,
      quality_gate_passed: stage.quality_gate_passed || false,
      subtask_count: stage.subtasks ? stage.subtasks.length : 0,
    };
    if (stage.runs) {
      for (const run of stage.runs) m.total_tokens += (run.input_tokens || 0) + (run.output_tokens || 0);
    }
    // サブタスクのトークンも集計
    if (stage.subtasks) {
      for (const st of stage.subtasks) {
        if (st.runs) {
          for (const run of st.runs) m.total_tokens += (run.input_tokens || 0) + (run.output_tokens || 0);
        }
      }
    }
    metrics[key] = m;
    totalDuration += m.duration_seconds;
    totalRework += m.rework_count;
  }

  status.observability.stage_metrics = metrics;
  status.pipeline.total_duration_seconds = totalDuration;
  status.pipeline.total_rework_count = totalRework;
}

// === PreToolUse ===

function handlePreToolUse(hookInput) {
  const subagentType = hookInput.tool_input?.subagent_type || "";
  const stageKey = AGENT_STAGE_MAP[subagentType];
  if (!stageKey) return;

  const statusPath = getStatusFilePath();
  const lockPath = getLockFilePath();

  if (!acquireLock(lockPath)) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: "ファイルロック取得失敗" }) + "\n");
    return;
  }

  try {
    const status = ensureStatus(statusPath);
    const now = nowISO();
    const stage = status.stages[stageKey];
    const prompt = hookInput.tool_input?.prompt || "";
    const subtaskInfo = parseSubtaskInfo(prompt);

    // トークン上限チェック
    if (status.pipeline.token_limit_reached === true) {
      const reason = "トークン上限に達しています。Pipeline Monitor (http://localhost:8089) から変更してください。";
      process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
      return;
    }

    // === 工程間の逐次チェック ===
    // 現在別の工程が動いている場合はブロック（同一工程のサブタスク追加は許可）
    const currentStage = status.pipeline.current_stage;
    if (currentStage && currentStage !== stageKey) {
      const reason = `別の工程「${currentStage}」が実行中です。工程は逐次実行のため、完了を待ってください。`;
      process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
      process.stderr.write(`[pipeline] ブロック（工程間逐次）: ${reason}\n`);
      return;
    }

    // === 前工程の品質ゲート（新規工程開始時のみ） ===
    if (!currentStage || currentStage !== stageKey) {
      const gateResult = checkPreviousStageQualityGate(status, stageKey);
      if (!gateResult.passed) {
        const reason = `品質ゲート未通過: ${gateResult.message}`;
        process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
        process.stderr.write(`[pipeline] ブロック（品質ゲート）: ${reason}\n`);
        return;
      }
    }

    // === 並列上限チェック ===
    const activeAgents = status.pipeline.active_agents || [];
    const maxParallel = status.pipeline.max_parallel || 3;
    if (activeAgents.length >= maxParallel) {
      const reason = `並列上限（${maxParallel}）に達しています。稼働中: ${activeAgents.map(a => a.subtask_id || a.stage).join(", ")}`;
      process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
      return;
    }

    // === サブタスクモード判定 ===
    if (subtaskInfo) {
      // --- サブタスクモード（工程内並列） ---
      // 並列許可工程でなければブロック
      if (!PARALLEL_ALLOWED_STAGES.includes(stageKey)) {
        const reason = `工程「${stageKey}」は工程内並列が許可されていません。並列可能: ${PARALLEL_ALLOWED_STAGES.join(", ")}`;
        process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
        process.stderr.write(`[pipeline] ブロック（並列不許可工程）: ${reason}\n`);
        return;
      }
      stage.parallel = true;

      // 同一サブタスクIDの重複チェック
      const activeSubtask = activeAgents.find(a => a.stage === stageKey && a.subtask_id === subtaskInfo.id);
      if (activeSubtask) {
        const reason = `サブタスク「${subtaskInfo.id}」は既に実行中です。`;
        process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
        return;
      }

      // スコープ重複チェック — 稼働中エージェントの担当範囲と比較
      for (const a of activeAgents) {
        if (a.stage === stageKey && a.scope && scopesOverlap(a.scope, subtaskInfo.scope)) {
          const reason = `担当範囲が重複しています。\n  新規: [${subtaskInfo.scope.join(", ")}]\n  稼働中(${a.subtask_id}): [${a.scope.join(", ")}]`;
          process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
          process.stderr.write(`[pipeline] ブロック（スコープ重複）: ${subtaskInfo.id} vs ${a.subtask_id}\n`);
          return;
        }
      }

      // 既存サブタスクの完了済みチェック（同一IDの再実行=手戻り）
      let existingSt = stage.subtasks.find(st => st.id === subtaskInfo.id);
      if (!existingSt) {
        existingSt = {
          id: subtaskInfo.id, scope: subtaskInfo.scope,
          status: "not_started", started_at: null, completed_at: null,
          run_count: 0, error_count: 0, last_error: null, runs: [],
        };
        stage.subtasks.push(existingSt);
      }

      existingSt.status = "in_progress";
      existingSt.started_at = now;
      existingSt.scope = subtaskInfo.scope; // 更新
      existingSt.pending_command = prompt;

      // active_agents に追加
      status.pipeline.active_agents.push({
        agent: subagentType, stage: stageKey,
        subtask_id: subtaskInfo.id, scope: subtaskInfo.scope,
        started_at: now,
      });

      process.stderr.write(`[pipeline] ${stageKey}/${subtaskInfo.id}: 開始 (scope: [${subtaskInfo.scope.join(", ")}], 稼働数: ${status.pipeline.active_agents.length})\n`);

    } else {
      // --- 単体モード（従来の1工程1エージェント） ---

      // 同一工程で既にエージェントが動いている場合はブロック
      if (activeAgents.some(a => a.stage === stageKey)) {
        const reason = `工程「${stageKey}」は既に実行中です。サブタスク分割する場合は命令書に【サブタスク: {id}】【担当範囲: {scope}】を記載してください。`;
        process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
        return;
      }

      stage.pending_command = prompt;

      // active_agents に追加
      status.pipeline.active_agents.push({
        agent: subagentType, stage: stageKey,
        subtask_id: null, scope: null, started_at: now,
      });
    }

    // 共通処理
    status.pipeline.current_stage = stageKey;
    status.pipeline.updated_at = now;

    stage.status = "in_progress";
    if (!stage.started_at) stage.started_at = now;

    // 手戻り検出
    if (stage.completed_at && !subtaskInfo) {
      stage.rework_count = (stage.rework_count || 0) + 1;
      if (!status.observability) status.observability = { stage_metrics: {}, rework_log: [] };
      status.observability.rework_log.push({
        stage: stageKey, rework_number: stage.rework_count,
        triggered_at: now, previous_completed_at: stage.completed_at,
      });
      process.stderr.write(`[pipeline] 手戻り検出: ${stageKey} (${stage.rework_count}回目)\n`);
    }

    status.pipeline.status = determinePipelineStatus(status.stages);
    if (!status.pipeline.started_at) status.pipeline.started_at = now;

    saveStatus(statusPath, status);
    if (!subtaskInfo) {
      process.stderr.write(`[pipeline] ${subagentType} -> ${stageKey}: 開始\n`);
    }
  } finally {
    releaseLock(lockPath);
  }
}

// === PostToolUse ===

function handlePostToolUse(hookInput) {
  const subagentType = hookInput.tool_input?.subagent_type || "";
  const stageKey = AGENT_STAGE_MAP[subagentType];
  if (!stageKey) return;

  const statusPath = getStatusFilePath();
  const lockPath = getLockFilePath();

  if (!acquireLock(lockPath)) {
    process.stderr.write(`[pipeline] ロック取得失敗 (PostToolUse)\n`);
    return;
  }

  try {
    const status = ensureStatus(statusPath);
    const now = nowISO();
    const stage = status.stages[stageKey];
    const prompt = hookInput.tool_input?.prompt || "";
    const subtaskInfo = parseSubtaskInfo(prompt);

    // エラー検出
    const errorInfo = detectAgentError(hookInput.tool_response);

    // トークン・レポート抽出
    const { inputTokens, outputTokens } = extractTokens(hookInput.tool_response);
    const report = extractReportText(hookInput.tool_response);

    if (subtaskInfo) {
      // --- サブタスク完了処理 ---
      const st = stage.subtasks.find(s => s.id === subtaskInfo.id);
      if (!st) {
        process.stderr.write(`[pipeline] サブタスク ${subtaskInfo.id} が見つからない\n`);
        // active_agents から除去だけしておく
        status.pipeline.active_agents = (status.pipeline.active_agents || [])
          .filter(a => !(a.stage === stageKey && a.subtask_id === subtaskInfo.id));
        saveStatus(statusPath, status);
        return;
      }

      const command = st.pending_command || "";
      delete st.pending_command;

      if (errorInfo.hasError) {
        st.error_count = (st.error_count || 0) + 1;
        st.last_error = { type: errorInfo.errorType, message: errorInfo.errorMessage, occurred_at: now };
        const retryPolicy = status.retry_policy || { max_retries_per_stage: 2, retry_on: [] };
        const canRetry = retryPolicy.retry_on.includes(errorInfo.errorType) && st.error_count <= retryPolicy.max_retries_per_stage;
        st.status = canRetry ? "retry_pending" : "error";

        // active_agents から除去
        status.pipeline.active_agents = (status.pipeline.active_agents || [])
          .filter(a => !(a.stage === stageKey && a.subtask_id === subtaskInfo.id));

        // 工程レベルのエラーカウント
        stage.error_count = (stage.error_count || 0) + 1;

        // 全サブタスクがエラーなら工程もエラー
        const allErrorOrDone = stage.subtasks.every(s => s.status === "completed" || s.status === "error");
        const anyError = stage.subtasks.some(s => s.status === "error");
        if (allErrorOrDone && anyError) {
          stage.status = "error";
        }

        status.pipeline.updated_at = now;
        updateObservability(status);
        saveStatus(statusPath, status);
        process.stderr.write(`[pipeline] ${stageKey}/${subtaskInfo.id}: エラー (${errorInfo.errorType})\n`);
        return;
      }

      // 正常完了
      st.run_count = (st.run_count || 0) + 1;
      const runDuration = calcDurationSeconds(st.started_at, now);
      if (!st.runs) st.runs = [];
      st.runs.push({
        run: st.run_count, completed_at: now, duration_seconds: runDuration,
        input_tokens: inputTokens, output_tokens: outputTokens,
        command: command, report: report,
      });
      st.status = "completed";
      st.completed_at = now;
      st.last_error = null;

      // active_agents から除去
      status.pipeline.active_agents = (status.pipeline.active_agents || [])
        .filter(a => !(a.stage === stageKey && a.subtask_id === subtaskInfo.id));

      // 全サブタスク完了チェック → 工程完了
      const allCompleted = stage.subtasks.every(s => s.status === "completed");
      if (allCompleted) {
        stage.status = "completed";
        stage.completed_at = now;
        // 工程全体の duration = 最初の started_at から今まで
        stage.duration_seconds = calcDurationSeconds(stage.started_at, now);
        stage.run_count = stage.subtasks.reduce((sum, s) => sum + (s.run_count || 0), 0);

        // current_stage をクリア
        status.pipeline.current_stage = null;
        status.pipeline.last_completed_stage = stageKey;
        status.pipeline.checkpoint.last_successful_stage = stageKey;
        status.pipeline.checkpoint.last_successful_at = now;

        process.stderr.write(`[pipeline] ${stageKey}: 全サブタスク完了 → 工程完了\n`);
      } else {
        const remaining = stage.subtasks.filter(s => s.status !== "completed").map(s => s.id);
        process.stderr.write(`[pipeline] ${stageKey}/${subtaskInfo.id}: 完了 (残り: ${remaining.join(", ")})\n`);
      }

      // トークン集計
      status.pipeline.total_input_tokens += inputTokens;
      status.pipeline.total_output_tokens += outputTokens;

    } else {
      // --- 単体モード完了処理（従来と同じ） ---
      const command = stage.pending_command || "";
      delete stage.pending_command;

      if (errorInfo.hasError) {
        stage.error_count = (stage.error_count || 0) + 1;
        stage.last_error = { type: errorInfo.errorType, message: errorInfo.errorMessage, occurred_at: now, error_number: stage.error_count };
        const retryPolicy = status.retry_policy || { max_retries_per_stage: 2, retry_on: [] };
        const canRetry = retryPolicy.retry_on.includes(errorInfo.errorType) && stage.error_count <= retryPolicy.max_retries_per_stage;

        status.pipeline.active_agents = (status.pipeline.active_agents || []).filter(a => a.stage !== stageKey);

        if (canRetry) {
          stage.status = "retry_pending";
          status.pipeline.updated_at = now;
          saveStatus(statusPath, status);
          process.stderr.write(`[pipeline] ${stageKey}: エラー (${errorInfo.errorType}) — リトライ可能 (${stage.error_count}/${retryPolicy.max_retries_per_stage})\n`);
          return;
        } else {
          stage.status = "error";
          status.pipeline.current_stage = null;
          status.pipeline.updated_at = now;
          status.pipeline.status = determinePipelineStatus(status.stages);
          updateObservability(status);
          saveStatus(statusPath, status);
          process.stderr.write(`[pipeline] ${stageKey}: エラー (${errorInfo.errorType}) — リトライ上限\n`);
          return;
        }
      }

      stage.run_count += 1;
      const runDuration = calcDurationSeconds(stage.started_at, now);
      stage.runs.push({
        run: stage.run_count, completed_at: now, duration_seconds: runDuration,
        input_tokens: inputTokens, output_tokens: outputTokens,
        command: command, report: report,
      });
      stage.duration_seconds = (stage.duration_seconds || 0) + runDuration;
      stage.status = "completed";
      stage.completed_at = now;
      stage.last_error = null;

      status.pipeline.active_agents = (status.pipeline.active_agents || []).filter(a => a.stage !== stageKey);
      status.pipeline.current_stage = null;
      status.pipeline.updated_at = now;
      status.pipeline.last_completed_stage = stageKey;
      status.pipeline.checkpoint.last_successful_stage = stageKey;
      status.pipeline.checkpoint.last_successful_at = now;
      status.pipeline.total_input_tokens += inputTokens;
      status.pipeline.total_output_tokens += outputTokens;

      process.stderr.write(`[pipeline] ${subagentType} -> ${stageKey}: 完了 (第${stage.run_count}回, ${runDuration}s, in=${inputTokens}, out=${outputTokens})\n`);
    }

    // トークン上限チェック
    const totalTokens = status.pipeline.total_input_tokens + status.pipeline.total_output_tokens;
    const tokenLimit = status.pipeline.token_limit;
    if (tokenLimit !== null && tokenLimit !== undefined && totalTokens > tokenLimit) {
      status.pipeline.token_limit_reached = true;
      status.pipeline.status = "suspended";
      updateObservability(status);
      saveStatus(statusPath, status);
      process.stderr.write(`[pipeline] トークン上限到達: ${totalTokens} / ${tokenLimit}\n`);
      process.stdout.write(JSON.stringify({ decision: "block", reason: `トークン上限到達（${totalTokens}/${tokenLimit}）` }) + "\n");
      return;
    }

    status.pipeline.status = determinePipelineStatus(status.stages);
    if (status.pipeline.status === "completed") status.pipeline.completed_at = now;

    updateObservability(status);
    saveStatus(statusPath, status);
  } finally {
    releaseLock(lockPath);
  }
}

function debugLog(msg, data) {
  const line = `[${new Date().toISOString()}] ${msg}: ${JSON.stringify(data)}\n`;
  fs.appendFileSync(DEBUG_LOG, line, "utf-8");
}

// 標準入力からフック入力を読み取る
let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let hookInput;
  try { hookInput = JSON.parse(input); } catch { process.exit(0); }

  debugLog("hook_received", {
    tool_name: hookInput.tool_name, hook_event_name: hookInput.hook_event_name,
    subagent_type: hookInput.tool_input?.subagent_type,
    has_tool_response: !!hookInput.tool_response,
  });

  if (hookInput.tool_name !== "Agent") process.exit(0);

  const event = hookInput.hook_event_name || (hookInput.tool_response ? "PostToolUse" : "PreToolUse");
  debugLog("event_determined", { event });

  if (event === "PreToolUse") handlePreToolUse(hookInput);
  else if (event === "PostToolUse") handlePostToolUse(hookInput);
});
