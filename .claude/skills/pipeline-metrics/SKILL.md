---
name: pipeline-metrics
description: パイプラインの観測データ（実行時間・トークン消費量・手戻り・エラー・サブタスク）を集計し、報告書用のサマリーを出力する。
---

# パイプライン観測メトリクス取得

パイプライン完了報告時、または途中経過を確認する時に使用せよ。

## メトリクスサマリーの取得

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
const PIPELINE_ORDER = ['requirements','data-modeling','project-rule','design','coding','unit-test','enhanced-test','complete-test','integration-test','skill-dev'];
const STAGE_NAMES = {
  'requirements':'要件定義','data-modeling':'データモデリング',
  'project-rule':'プロジェクトルール解析','design':'基本設計',
  'coding':'コーディング','unit-test':'単体テスト',
  'enhanced-test':'強化テスト','complete-test':'完全テスト',
  'integration-test':'結合テスト','skill-dev':'スキル開発',
};

const p = s.pipeline;
console.log('=== パイプライン観測レポート ===');
console.log('');
console.log('■ 全体サマリー');
console.log('  ステータス: ' + p.status);
console.log('  開始: ' + (p.started_at || 'N/A'));
console.log('  完了: ' + (p.completed_at || '未完了'));
console.log('  合計所要時間: ' + (p.total_duration_seconds || 0) + '秒');
console.log('  合計入力トークン: ' + (p.total_input_tokens || 0).toLocaleString());
console.log('  合計出力トークン: ' + (p.total_output_tokens || 0).toLocaleString());
console.log('  合計トークン: ' + ((p.total_input_tokens||0)+(p.total_output_tokens||0)).toLocaleString());
console.log('  合計手戻り: ' + (p.total_rework_count || 0));
console.log('  並列上限: ' + (p.max_parallel || 3));
console.log('');

console.log('■ 工程別メトリクス');
console.log('  工程名 | 状態 | 時間(秒) | トークン | 実行回数 | エラー | 手戻り | サブタスク | 品質ゲート');
console.log('  ' + '-'.repeat(100));

let maxTokenStage = { name: '', tokens: 0 };
let maxDurationStage = { name: '', duration: 0 };

for (const key of PIPELINE_ORDER) {
  const stage = s.stages[key];
  if (!stage) continue;
  const name = STAGE_NAMES[key] || key;
  const status = stage.status || 'not_started';
  const duration = stage.duration_seconds || 0;
  const runCount = stage.run_count || 0;
  const errorCount = stage.error_count || 0;
  const reworkCount = stage.rework_count || 0;
  const subtaskCount = (stage.subtasks || []).length;
  const qg = stage.quality_gate_passed ? 'PASS' : '-';

  let totalTokens = 0;
  if (stage.runs) { for (const r of stage.runs) totalTokens += (r.input_tokens||0) + (r.output_tokens||0); }
  if (stage.subtasks) { for (const st of stage.subtasks) { if (st.runs) { for (const r of st.runs) totalTokens += (r.input_tokens||0) + (r.output_tokens||0); } } }

  if (totalTokens > maxTokenStage.tokens) maxTokenStage = { name, tokens: totalTokens };
  if (duration > maxDurationStage.duration) maxDurationStage = { name, duration };

  console.log('  ' + name.padEnd(20) + ' | ' + status.padEnd(12) + ' | ' + String(duration).padStart(8) + ' | ' + String(totalTokens.toLocaleString()).padStart(10) + ' | ' + String(runCount).padStart(8) + ' | ' + String(errorCount).padStart(6) + ' | ' + String(reworkCount).padStart(6) + ' | ' + String(subtaskCount).padStart(9) + ' | ' + qg);
}

console.log('');
console.log('■ ハイライト');
if (maxTokenStage.tokens > 0) console.log('  最多トークン消費: ' + maxTokenStage.name + ' (' + maxTokenStage.tokens.toLocaleString() + ')');
if (maxDurationStage.duration > 0) console.log('  最長実行時間: ' + maxDurationStage.name + ' (' + maxDurationStage.duration + '秒)');

// サブタスク詳細
const parallelStages = PIPELINE_ORDER.filter(k => (s.stages[k]?.subtasks||[]).length > 0);
if (parallelStages.length > 0) {
  console.log('');
  console.log('■ サブタスク詳細');
  for (const key of parallelStages) {
    const stage = s.stages[key];
    console.log('  ' + (STAGE_NAMES[key]||key) + ':');
    for (const st of stage.subtasks) {
      let stTokens = 0;
      if (st.runs) { for (const r of st.runs) stTokens += (r.input_tokens||0) + (r.output_tokens||0); }
      console.log('    ' + st.id + ' [' + st.status + '] scope=[' + (st.scope||[]).join(', ') + '] tokens=' + stTokens.toLocaleString());
    }
  }
}

const reworkLog = s.observability?.rework_log || [];
if (reworkLog.length > 0) {
  console.log('');
  console.log('■ 手戻り履歴');
  for (const e of reworkLog) console.log('  ' + e.triggered_at + ' | ' + (STAGE_NAMES[e.stage]||e.stage) + ' (第' + e.rework_number + '回)');
}

const errorStages = PIPELINE_ORDER.filter(k => (s.stages[k]?.error_count || 0) > 0);
if (errorStages.length > 0) {
  console.log('');
  console.log('■ エラー発生工程');
  for (const key of errorStages) {
    const stage = s.stages[key];
    console.log('  ' + (STAGE_NAMES[key]||key) + ': ' + stage.error_count + '回');
    if (stage.last_error) console.log('    最終: ' + stage.last_error.type + ' - ' + stage.last_error.message);
  }
}
"
```

## 報告書への記載

上記出力を `/format-report` の報告書の末尾に「■ 観測データ」セクションとして含めよ。

特に以下を必ず含めること:
- 合計所要時間・合計トークン
- サブタスク分割した工程があればその詳細（ID, scope, トークン消費量）
- 手戻り・エラーがあればその詳細

## 最終報告の保存（パイプライン完了時のみ）

パイプライン完了報告（最終報告）の場合、`/format-report` で将軍閣下に報告した後、報告書テキストを `pipeline-status.json` に記録せよ。Pipeline Monitor から最終報告を参照できるようにするためである。

```bash
node pipeline/save-final-report.js '報告書テキストをここに記載'
```

- パイプラインの全工程が完了した時のみ実行すること（途中経過確認では実行しない）
- このスクリプトは `pipeline.status` を `completed` に設定し、`pipeline.final_report` に報告書テキストを保存する
