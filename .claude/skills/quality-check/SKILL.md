---
name: quality-check
description: 品質ゲートの検証手順。フックによるブロック時の対処、および隊長による手動品質確認を行う。
---

# 品質ゲート検証手順

品質ゲートがブロックした場合、または隊長が手動で成果物品質を確認する場合に使用せよ。

## 1. 品質ゲート状況の確認

```bash
node -e "
const fs = require('fs');
const path = require('path');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
const gates = s.quality_gates || {};
const PIPELINE_ORDER = ['requirements','data-modeling','project-rule','design','coding','code-review','unit-test','enhanced-test','complete-test','integration-test','skill-dev','doc-merge'];

console.log('=== 品質ゲート検証レポート ===');
console.log('稼働中: ' + JSON.stringify((s.pipeline.active_agents || []).map(a => a.subtask_id || a.stage)));
console.log('');

for (const key of PIPELINE_ORDER) {
  const stage = s.stages[key];
  const gate = gates[key];
  if (!gate) { console.log(key + ': 品質ゲート未定義'); continue; }

  const stageStatus = stage?.status || 'not_started';
  const gatePassed = stage?.quality_gate_passed || false;
  const icon = gatePassed ? 'PASS' : (stageStatus === 'completed' ? 'PENDING' : 'N/A');

  console.log('--- ' + key + ' [' + icon + '] ---');
  console.log('  ステータス: ' + stageStatus);
  if (stage?.subtasks?.length > 0) {
    console.log('  サブタスク: ' + stage.subtasks.map(st => st.id + '(' + st.status + ')').join(', '));
  }

  if (gate.required_artifacts) {
    for (const artifact of gate.required_artifacts) {
      try {
        const stat = fs.statSync(path.resolve(artifact));
        const size = stat.isFile() ? stat.size : '(dir)';
        const minSize = gate.min_file_size_bytes || 0;
        const sizeOk = stat.isDirectory() || stat.size >= minSize;
        console.log('  ' + (sizeOk ? 'OK' : 'NG') + ' ' + artifact + ' (' + size + ' bytes)');
      } catch { console.log('  NG ' + artifact + ' (存在しない)'); }
    }
  }
  if (gate.custom_check) console.log('  カスタムチェック: ' + gate.custom_check);
  console.log('');
}
"
```

## 2. フックがブロックした場合の対処

1. 上記の診断コマンドで不足成果物を特定する
2. 不足の原因を判断する:
   - **成果物が未作成**: 前工程のエージェントに `/format-order` で補完を命じる
   - **成果物のサイズが不足**: 前工程のエージェントに内容の充実を命じる
   - **前工程が未完了**: 前工程を先に完了させる（サブタスクが残っている可能性もある）
3. 補完完了後、再度次工程のエージェントを起動する

## 3. 隊長による手動品質確認

### 報告書の確認

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
const targetStage = process.argv[1];
const stage = s.stages[targetStage];
if (!stage) { console.log('工程が存在しません: ' + targetStage); process.exit(1); }

// 通常runs
if (stage.runs && stage.runs.length > 0) {
  const latestRun = stage.runs[stage.runs.length - 1];
  const report = latestRun.report || '';
  const hasIssues = report.includes('問題・懸念事項') && !report.includes('特になし');
  const hasEscalation = report.includes('上申事項') && !report.includes('特になし');
  console.log('=== ' + targetStage + ' 報告書分析 (第' + latestRun.run + '回) ===');
  console.log('問題・懸念事項: ' + (hasIssues ? '【あり】' : 'なし'));
  console.log('上申事項: ' + (hasEscalation ? '【あり】' : 'なし'));
  if (hasIssues || hasEscalation) { console.log(''); console.log(report); }
}

// サブタスクruns
if (stage.subtasks && stage.subtasks.length > 0) {
  console.log('');
  console.log('=== サブタスク報告 ===');
  for (const st of stage.subtasks) {
    if (!st.runs || st.runs.length === 0) continue;
    const r = st.runs[st.runs.length - 1];
    const rpt = r.report || '';
    const hasIssues = rpt.includes('問題・懸念事項') && !rpt.includes('特になし');
    console.log(st.id + ' [' + st.status + ']: ' + (hasIssues ? '【問題あり】' : 'OK'));
  }
}
" '確認対象の工程キーをここに指定'
```

### テスト工程の結果確認

テスト工程（`unit-test`, `enhanced-test`, `complete-test`, `integration-test`）の報告書にテスト失敗がある場合:
- テスト失敗がコード起因 → コーディング工程に手戻り
- テスト失敗が設計起因 → 基本設計工程に手戻り
- 手戻り判断は pipeline-rules.md の手戻り規則に従うこと
- サブタスクモードで実行した場合は、全サブタスクの結果を集約してから判断すること
- **テストモード（強化テスト・完全テスト）では手戻り先の工程（コーディング・基本設計）が無効のため、手戻りは実行できない。** 将軍閣下に上申し、コード修正の指示を仰ぐこと。結合テスト工程も同様。
