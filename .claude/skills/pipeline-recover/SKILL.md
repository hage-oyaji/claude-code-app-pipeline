---
name: pipeline-recover
description: パイプラインのエラー復旧手順。retry_pending/error 状態の工程を診断し、リトライまたは上申を行う。
---

# パイプライン復旧手順

エージェント実行の失敗（タイムアウト、コンテキスト溢れ等）が発生した場合に使用せよ。

## 1. 現状診断

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
const PIPELINE_ORDER = ['requirements','data-modeling','project-rule','design','coding','code-review','unit-test','enhanced-test','complete-test','integration-test','skill-dev','doc-merge'];

console.log('=== パイプライン復旧診断 ===');
console.log('パイプライン状態: ' + s.pipeline.status);
console.log('チェックポイント: ' + (s.pipeline.checkpoint?.last_successful_stage || 'なし'));
console.log('稼働中: ' + JSON.stringify((s.pipeline.active_agents || []).map(a => a.subtask_id || a.stage)));
console.log('');

const retryPolicy = s.retry_policy || { max_retries_per_stage: 2 };

for (const key of PIPELINE_ORDER) {
  const stage = s.stages[key];
  if (!stage || (stage.status !== 'error' && stage.status !== 'retry_pending' && stage.status !== 'in_progress')) continue;

  console.log('--- ' + key + ' ---');
  console.log('  ステータス: ' + stage.status);
  console.log('  エラー回数: ' + (stage.error_count || 0) + ' / ' + retryPolicy.max_retries_per_stage);

  // サブタスク状況
  if (stage.subtasks && stage.subtasks.length > 0) {
    console.log('  サブタスク:');
    for (const st of stage.subtasks) {
      console.log('    ' + st.id + ': ' + st.status + (st.last_error ? ' ('+st.last_error.type+')' : '') + ' scope=[' + (st.scope||[]).join(', ') + ']');
    }
  }

  if (stage.last_error) {
    console.log('  エラー種別: ' + stage.last_error.type);
    console.log('  エラー内容: ' + stage.last_error.message);
  }

  if (stage.status === 'retry_pending') {
    const errType = stage.last_error?.type || 'unknown';
    if (errType === 'context_overflow') console.log('  >> 対処: 参照ドキュメントを絞って再実行');
    else if (errType === 'timeout') console.log('  >> 対処: タスクを分割して再実行');
    else console.log('  >> 対処: エラー分析して命令書修正');
  } else if (stage.status === 'error') {
    console.log('  >> リトライ上限到達。将軍閣下に上申せよ。');
  }
  console.log('');
}
"
```

## 1-S. suspended 状態の復旧（トークン上限到達時）

トークン上限到達により `suspended` になった場合の復旧手順。

1. 将軍閣下に現状を報告し、以下のいずれかの指示を仰げ:
   - **上限を引き上げて継続**: Pipeline Monitor（http://localhost:8089）から `token_limit` を変更し、以下のコマンドでフラグを解除する
   - **パイプラインを終了**: `/pipeline-metrics` で途中経過を報告して終了する

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));

console.log('現在のトークン上限: ' + (s.pipeline.token_limit || '未設定'));
console.log('合計トークン消費: ' + ((s.pipeline.total_input_tokens||0) + (s.pipeline.total_output_tokens||0)));
console.log('token_limit_reached: ' + s.pipeline.token_limit_reached);

if (s.pipeline.token_limit_reached) {
  s.pipeline.token_limit_reached = false;
  s.pipeline.status = 'in_progress';
  s.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf-8');
  console.log('>> suspended 解除完了。パイプライン再開可能。');
} else {
  console.log('>> suspended 状態ではありません。');
}
"
```

解除後、中断された工程のエージェントに `/format-order` で命令を出せ。

## 2. リトライ実行（`retry_pending` の場合）

1. 対処アドバイスに従い、命令書の内容を調整する
2. `/format-order` スキルで調整済みの命令書を発令し、同一工程のエージェントを再起動する
3. サブタスクモードで一部のみエラーの場合は、エラーのサブタスクのみ再発令してよい

### エラー種別ごとの調整方針

| エラー種別 | 命令書の調整内容 |
|-----------|----------------|
| `context_overflow` | 参照ドキュメントを必要最小限に絞る |
| `timeout` | タスクを分割する |
| `agent_error` | エラー内容を分析し、命令書を修正する |
| `rate_limit` | 時間を置いて再実行する。改善しない場合は将軍閣下に上申 |
| `quota_exceeded` | 課金上限到達のためリトライ不可。将軍閣下に上申せよ |

## 3. 上申（`error` の場合）

`/format-report` スキルで将軍閣下に上申せよ。報告書に以下を含めること:
- 失敗した工程名（サブタスクがあればサブタスクID）
- エラー種別と回数
- 試みた対処内容
- 隊長としての所見

## 4. ステータスのリセット（手動復旧）

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
const targetStage = process.argv[1];

if (!s.stages[targetStage]) { console.log('工程が存在しません: ' + targetStage); process.exit(1); }

s.stages[targetStage].status = 'not_started';
s.stages[targetStage].last_error = null;
s.stages[targetStage].subtasks = [];
s.pipeline.status = 'in_progress';
s.pipeline.current_stage = null;
s.pipeline.active_agents = (s.pipeline.active_agents || []).filter(a => a.stage !== targetStage);
s.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf-8');
console.log('リセット完了: ' + targetStage);
" 'リセット対象の工程キーをここに指定'
```

リセット後、`/format-order` で該当工程のエージェントに命令を出せ。

## 5. サブタスク個別リセット（並列実行中のエラーサブタスクのみ再実行）

工程内並列でエラーになったサブタスクだけをリセットし、他の完了済みサブタスクはそのまま保持する。

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
const targetStage = process.argv[1];
const targetSubtask = process.argv[2];

const stage = s.stages[targetStage];
if (!stage) { console.log('工程が存在しません: ' + targetStage); process.exit(1); }
if (!stage.subtasks || stage.subtasks.length === 0) { console.log('サブタスクがありません'); process.exit(1); }

const st = stage.subtasks.find(s => s.id === targetSubtask);
if (!st) { console.log('サブタスクが見つかりません: ' + targetSubtask); process.exit(1); }

console.log('リセット前: ' + st.id + ' [' + st.status + ']');
st.status = 'not_started';
st.last_error = null;
st.started_at = null;
st.completed_at = null;

// 工程ステータスも in_progress に戻す
stage.status = 'in_progress';
s.pipeline.status = 'in_progress';
s.pipeline.current_stage = targetStage;
s.pipeline.active_agents = (s.pipeline.active_agents || []).filter(a => !(a.stage === targetStage && a.subtask_id === targetSubtask));
s.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf-8');
console.log('リセット完了: ' + targetStage + '/' + targetSubtask);
" 'リセット対象の工程キー' 'リセット対象のサブタスクID'
```

リセット後、`/format-order` でサブタスク命令書（【サブタスク: {id}】【担当範囲: {scope}】付き）を発令せよ。
