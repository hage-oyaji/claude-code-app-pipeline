---
name: pipeline-start
description: パイプライン開始時の初動手順（バックアップ・初期化・命令記録・チェックポイント復旧）を実行する
---

# パイプライン開始時の初動手順

将軍閣下から命令を受けたら、最初の工程（要件定義）に命令を出す**前に**、以下を順番に実行せよ。

## 0. チェックポイント確認（復旧判定）

まず既存の `pipeline-status.json` を確認し、中断されたパイプラインの復旧が可能か判定せよ。

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
if (!fs.existsSync(f)) { console.log('STATUS: no_existing_pipeline'); process.exit(0); }
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
const p = s.pipeline;
const checkpoint = p.checkpoint || {};
const stages = s.stages || {};

const errorStages = Object.entries(stages)
  .filter(([k, v]) => v.status === 'error' || v.status === 'retry_pending')
  .map(([k, v]) => ({ stage: k, status: v.status, error: v.last_error }));
const inProgress = Object.entries(stages)
  .filter(([k, v]) => v.status === 'in_progress')
  .map(([k]) => k);
const activeAgents = p.active_agents || [];

console.log('STATUS: ' + p.status);
console.log('CHECKPOINT: ' + (checkpoint.last_successful_stage || 'none'));
console.log('CHECKPOINT_AT: ' + (checkpoint.last_successful_at || 'none'));
console.log('ACTIVE_AGENTS: ' + JSON.stringify(activeAgents.map(a => a.subtask_id || a.stage)));
console.log('ERROR_STAGES: ' + JSON.stringify(errorStages));
console.log('IN_PROGRESS: ' + JSON.stringify(inProgress));
console.log('INITIAL_COMMAND: ' + (p.initial_command || 'none'));
console.log('TOTAL_TOKENS: ' + ((p.total_input_tokens || 0) + (p.total_output_tokens || 0)));
console.log('REWORK_COUNT: ' + (p.total_rework_count || 0));
"
```

**判定基準:**
- `STATUS` が `error` または `suspended` で、`CHECKPOINT` が存在する場合 → **復旧モード**に移行（手順1をスキップし、手順2-Rへ）
- `STATUS` が `in_progress` の場合 → 将軍閣下に状況を報告し、新規開始か復旧かの指示を仰げ
- それ以外 → **通常の新規開始**（手順1へ）

## 1. pipeline-status.json の初期化（新規開始時のみ）

```bash
node -e "
const fs = require('fs');
const path = require('path');
const dir = 'pipeline';
const src = path.join(dir, 'pipeline-status-format.json');
const dst = path.join(dir, 'pipeline-status.json');

if (fs.existsSync(dst)) {
  const now = new Date();
  const ts = now.getFullYear().toString()
    + String(now.getMonth()+1).padStart(2,'0')
    + String(now.getDate()).padStart(2,'0')
    + '_'
    + String(now.getHours()).padStart(2,'0')
    + String(now.getMinutes()).padStart(2,'0')
    + String(now.getSeconds()).padStart(2,'0');
  const backup = path.join(dir, 'pipeline-status-' + ts + '.json');
  fs.renameSync(dst, backup);
  console.log('バックアップ: ' + backup);
}

const fmt = JSON.parse(fs.readFileSync(src, 'utf-8'));
fmt.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(dst, JSON.stringify(fmt, null, 2), 'utf-8');
console.log('初期化完了: ' + dst);
"
```

## 2. 将軍閣下の命令を記録（新規開始時）

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
s.pipeline.initial_command = process.argv[1];
s.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf-8');
console.log('命令記録完了');
" '将軍閣下の命令内容をここに記載'
```

## 2-R. 復旧モード（チェックポイントからの再開時）

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
const PIPELINE_ORDER = ['requirements','data-modeling','design','project-rule','coding','unit-test','integration-test','skill-dev'];

const checkpoint = s.pipeline.checkpoint?.last_successful_stage;
if (!checkpoint) { console.log('チェックポイントなし — 新規開始が必要'); process.exit(0); }

const checkpointIdx = PIPELINE_ORDER.indexOf(checkpoint);
console.log('チェックポイント: ' + checkpoint + ' (index=' + checkpointIdx + ')');

for (let i = checkpointIdx + 1; i < PIPELINE_ORDER.length; i++) {
  const key = PIPELINE_ORDER[i];
  const stage = s.stages[key];
  if (stage && (stage.status === 'error' || stage.status === 'retry_pending' || stage.status === 'in_progress')) {
    console.log('リセット: ' + key + ' (' + stage.status + ' -> not_started)');
    stage.status = 'not_started';
    stage.last_error = null;
    stage.subtasks = [];
  }
}

s.pipeline.status = 'in_progress';
s.pipeline.token_limit_reached = false;
s.pipeline.current_stage = null;
s.pipeline.active_agents = [];
s.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf-8');

const nextIdx = checkpointIdx + 1;
if (nextIdx < PIPELINE_ORDER.length) {
  console.log('再開工程: ' + PIPELINE_ORDER[nextIdx]);
} else {
  console.log('全工程完了済み');
}
"
```

表示された「再開工程」から `/format-order` で命令を発令せよ。

## 3. 要件定義工程へ命令発令（新規開始時）

`/format-order` スキルを使用して、要件定義エージェントへの命令書を作成・発令せよ。
