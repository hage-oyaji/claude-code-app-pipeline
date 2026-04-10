---
name: pipeline-start
description: パイプライン開始時の初動手順（モード判定・バックアップ・初期化・命令記録・チェックポイント復旧）を実行する
---

# パイプライン開始時の初動手順

将軍閣下から命令を受けたら、最初の工程に命令を出す**前に**、以下を順番に実行せよ。

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
console.log('MODE: ' + (p.mode || 'none'));
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
- `STATUS` が `error` または `suspended` で、`CHECKPOINT` が存在する場合 → **復旧モード**に移行（手順1をスキップし、手順3-Rへ）
- `STATUS` が `in_progress` の場合 → 将軍閣下に状況を報告し、新規開始か復旧かの指示を仰げ
- それ以外 → **通常の新規開始**（手順1へ）

## 1. 開発モードの判定

将軍閣下の指示内容から開発モードを判定し、**確認を取れ**。

| モード | 値 | 判定基準 |
|--------|---|---------|
| 新規開発 | `new-development` | 既存資産への言及なし。ゼロからの構築を指示 |
| 機能追加 | `feature-addition` | 既存プロジェクトへの追加・改修を指示 |
| 強化テスト | `enhanced-test` | 強化テスト・カバレッジテストを明示的に指示 |
| 完全テスト | `complete-test` | 完全テスト・条件網羅テストを明示的に指示 |

将軍閣下に以下の形式で確認:
```
開発モードを「{モード名}」と判断いたしました。
{モードの説明}
この方針でよろしいでしょうか、将軍閣下。
```

## 2. pipeline-status.json の初期化 + モード適用（新規開始時のみ）

将軍閣下の承認後、`init-pipeline.js` でバックアップ・初期化・モード適用・バックアップクリーンアップを一括実行する。

```bash
node pipeline/init-pipeline.js '{モード値}'
```

**注意:** `{モード値}` を判定したモード値に必ず置換してから実行せよ。有効なモード値: `new-development`, `feature-addition`, `enhanced-test`, `complete-test`。エイリアス（`new`, `feature`, `enhanced`, `complete` 等）も使用可。

### 事前条件の検証（機能追加・テストモード）

初期化後、モードに応じた事前条件を検証する。

```bash
node -e "
const fs = require('fs');
const fmt = JSON.parse(fs.readFileSync('pipeline/pipeline-status-format.json', 'utf-8'));
const s = JSON.parse(fs.readFileSync('pipeline/pipeline-status.json', 'utf-8'));
const modeDef = fmt.pipeline.mode_definitions[s.pipeline.mode];
if (!modeDef) { console.log('モード未設定'); process.exit(1); }
const missing = [];

for (const p of modeDef.preconditions || []) {
  try { fs.statSync(p); } catch { missing.push(p); }
}

if (missing.length > 0) {
  console.log('ERROR: 事前条件未充足');
  missing.forEach(m => console.log('  未配置: ' + m));
} else {
  console.log('事前条件OK');
}
"
```

- **ERROR の場合**: 将軍閣下に不足している資産の配置を依頼し、配置完了後に再実行せよ
- 機能追加モードで `artifacts/data-model/ddl.sql` が存在しない場合: 将軍閣下にデータモデルを新規作成してよいか確認を取ること

## 2.5. 将軍閣下レビュー設定（新規開始時のみ）

`init-pipeline.js` による初期化完了後、有効工程の一覧を提示し、**どの工程にレビューを入れるか**を将軍閣下に確認せよ。

### 有効工程の一覧を取得（必須・任意分類）

```bash
node -e "
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('pipeline/pipeline-status.json', 'utf-8'));
const ORDER = ['requirements','data-modeling','project-rule','design','coding','code-review','unit-test','enhanced-test','complete-test','integration-test','skill-dev','doc-merge'];
const NAMES = {'requirements':'要件定義','data-modeling':'データモデリング','project-rule':'プロジェクトルール解析','design':'基本設計','coding':'コーディング','code-review':'ソースレビュー','unit-test':'単体テスト','enhanced-test':'強化テスト','complete-test':'完全テスト','integration-test':'結合テスト','skill-dev':'スキル開発','doc-merge':'ドキュメントマージ'};
const enabled = ORDER.filter(k => s.stages[k] && s.stages[k].enabled);
console.log('=== 必須レビュー工程（変更不可） ===');
enabled.filter(k => s.stages[k].review_mandatory).forEach(k => console.log('  [★必須] '+k+' ('+NAMES[k]+')'));
console.log('=== 任意レビュー工程（チェックボックス） ===');
enabled.filter(k => !s.stages[k].review_mandatory).forEach((k,i) => console.log('  '+(i+1)+'. '+k+' ('+NAMES[k]+')'));
"
```

### 将軍閣下への確認フォーマット

取得した一覧をもとに、以下の形式で将軍閣下に確認せよ（必須工程はチェックボックスに含めず、冒頭コメントとして明示する）：

```
各工程完了後のレビュー有無を設定します。

★ 要件定義は必須レビュー工程です（変更不可）。
  完了時に必ず成果物を報告し、将軍閣下の承認をいただいてから次工程へ進みます。

以下の工程について、レビューを入れる工程の **番号** をお答えください。
選択された工程が完了した時点で隊長が成果物を報告し、
将軍閣下の承認をいただいてから次工程へ進みます。

{モード名}モードのレビュー選択可能工程:
  1. データモデリング
  2. 基本設計
  3. コーディング
  4. 単体テスト
  5. 結合テスト
  6. ドキュメントマージ
  （上記は例。実際の有効かつ非必須の工程を番号付きで列挙すること）

回答例:
  「2, 3」     → 基本設計とコーディングにレビューを入れる
  「全て」     → 全工程にレビューを入れる
  「なし」     → レビューなしで全工程を自動進行

レビューを入れる工程の番号をご回答ください、将軍閣下。
```

### 将軍閣下の回答を受けてレビュー設定を適用

将軍閣下の回答から任意レビュー対象の工程を特定し、`set-stage-reviews.js` で設定を適用する。
**`requirements` は `review_mandatory: true` のため、指定不要・指定しても強制 `true` になる。**

```bash
node pipeline/set-stage-reviews.js '{任意レビュー対象の工程キーをカンマ区切りで記載}'
```

例:
- 「基本設計とコーディング」→ `node pipeline/set-stage-reviews.js design,coding`
- 「全工程（必須以外）」→ 有効かつ非必須工程のキーを全て指定
- 「なし」→ `node pipeline/set-stage-reviews.js --clear`

設定後、スクリプトの出力に表示される設定一覧を将軍閣下に一言報告せよ。

**注意:** このステップは新規開始時のみ実行する。復旧（手順3-R）時はスキップしてよい。

## 3. 将軍閣下の命令を記録

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
s.pipeline.initial_command = process.argv[1];
s.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf-8');
console.log('命令記録完了');
" '{将軍閣下の命令内容をここに記載}'
```

**注意:** 上記スクリプトの最終行のシングルクォート内を、将軍閣下の命令内容に置換してから実行せよ。

## 3-R. 復旧モード（チェックポイントからの再開時）

```bash
node -e "
const fs = require('fs');
const f = 'pipeline/pipeline-status.json';
const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
const PIPELINE_ORDER = ['requirements','data-modeling','project-rule','design','coding','code-review','unit-test','enhanced-test','complete-test','integration-test','skill-dev','doc-merge'];

const checkpoint = s.pipeline.checkpoint?.last_successful_stage;
if (!checkpoint) { console.log('チェックポイントなし — 新規開始が必要'); process.exit(0); }

const checkpointIdx = PIPELINE_ORDER.indexOf(checkpoint);
console.log('チェックポイント: ' + checkpoint + ' (index=' + checkpointIdx + ')');
console.log('モード: ' + (s.pipeline.mode || 'none'));

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

// スキップされていない次の工程を探す
for (let i = checkpointIdx + 1; i < PIPELINE_ORDER.length; i++) {
  const key = PIPELINE_ORDER[i];
  const stage = s.stages[key];
  if (stage && stage.enabled !== false && stage.status !== 'skipped') {
    console.log('再開工程: ' + key);
    break;
  }
}
"
```

表示された「再開工程」から `/format-order` で命令を発令せよ。

## 4. 最初の有効工程へ命令発令（新規開始時）

`/format-order` スキルを使用して、モードに応じた最初の有効工程のエージェントへ命令書を作成・発令せよ。

- **新規開発 / 機能追加**: 要件定義エージェントへ
- **強化テスト**: 強化テストエージェントへ
- **完全テスト**: 完全テストエージェントへ
