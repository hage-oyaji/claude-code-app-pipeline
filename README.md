# Claude Code Agent Pipeline

Claude Code のサブエージェント機能を活用した、ソフトウェア開発パイプラインシステム。
要件定義からテストまでの全工程を、専門エージェントが順番に自動実行する。

## 登場人物

| 役割 | 呼称 | 説明 |
|------|------|------|
| 👑 ユーザー | **将軍閣下** | パイプラインの最高司令官。開発の命令を下し、工程完了後のレビューと承認を行う。 |
| 🎖️ 全体管理エージェント | **隊長** | 将軍閣下の命令を受け取り、各工程の専門エージェントに作業を割り振る指揮官。`CLAUDE.md` がルールブック。進捗管理・品質ゲート・手戻り判断を担う。自らはコードを書かない。 |
| ⚔️ 専門エージェント | **兵** | 各工程（要件定義・設計・コーディング・テスト等）を担当するサブエージェント群。隊長の命令に従い、成果物を `artifacts/` に出力する。 |

## 概要

ユーザー（将軍閣下）が開発したいシステムを指示すると、全体管理エージェント（隊長）が12の専門エージェント（兵）に作業を順次指示し、成果物を `artifacts/` に出力する。

コーディング・テスト工程は**工程内並列実行**に対応しており、モジュール単位で複数エージェントが同時稼働できる。

将軍閣下が命令を下すと、隊長が開発モードを判定して最適な工程を順番に実行する。

### 新規開発モード（ゼロからシステムを構築）

| STEP | 工程 | 担当 | 備考 |
|------|------|------|------|
| STEP 1 | 要件定義 | 兵 ① | 完了後、将軍閣下の承認が必須 ✅ |
| STEP 2 | データモデリング | 兵 ② | |
| STEP 3 | 基本設計 | 兵 ④ | |
| STEP 4 | コーディング | 兵 ⑤ | 並列実行可 🔀 |
| STEP 5 | ソースレビュー | 兵 ⑥ | 隊長判断で実行（任意）|
| STEP 6 | 単体テスト | 兵 ⑦ | 並列実行可 🔀 |
| STEP 7 | 結合テスト | 兵 ⑩ | |
| STEP 8 | スキル開発 | 兵 ⑪ | 隊長判断で実行（任意）|
| STEP 9 | ドキュメントマージ | 兵 ⑫ | |

### 機能追加モード（既存コードに機能を追加）

| STEP | 工程 | 担当 | 備考 |
|------|------|------|------|
| STEP 1 | 要件定義 | 兵 ① | 完了後、将軍閣下の承認が必須 ✅ |
| STEP 2 | データモデリング | 兵 ② | |
| STEP 3 | プロジェクトルール解析 | 兵 ③ | 既存コードの規約を解析 |
| STEP 4 | 基本設計 | 兵 ④ | |
| STEP 5 | コーディング | 兵 ⑤ | 並列実行可 🔀 |
| STEP 6 | ソースレビュー | 兵 ⑥ | 隊長判断で実行（任意）|
| STEP 7 | 単体テスト | 兵 ⑦ | 並列実行可 🔀 |
| STEP 8 | 結合テスト | 兵 ⑩ | |
| STEP 9 | スキル開発 | 兵 ⑪ | 隊長判断で実行（任意）|
| STEP 10 | ドキュメントマージ | 兵 ⑫ | |

### 強化テストモード（カバレッジ100%テスト）

| STEP | 工程 | 担当 | 備考 |
|------|------|------|------|
| STEP 1 | 強化テスト | 兵 ⑧ | 並列実行可 🔀 |
| STEP 2 | 結合テスト | 兵 ⑩ | |
| STEP 3 | ドキュメントマージ | 兵 ⑫ | |

### 完全テストモード（条件網羅テスト）

| STEP | 工程 | 担当 | 備考 |
|------|------|------|------|
| STEP 1 | 完全テスト | 兵 ⑨ | 並列実行可 🔀 |
| STEP 2 | 結合テスト | 兵 ⑩ | |
| STEP 3 | ドキュメントマージ | 兵 ⑫ | |

> ✅ **承認ゲート**: 要件定義完了後は必ず将軍閣下の承認が必要。隊長が成果物を要約して報告し、「進めよ」などの承認を受けてから次工程へ進む。

### 開発モード

パイプライン起動時に開発モードを判定し、実行する工程が変わる。

| モード | 概要 | 事前条件 |
|--------|------|---------|
| **新規開発** | ゼロからシステムを構築 | なし |
| **機能追加** | 既存コードに機能を追加 | `artifacts/code/` に既存コード<br>`artifacts/data-model/base` にデータモデル<br>`artifacts/design/base` にAPI一覧を配置 |
| **強化テスト** | カバレッジ100%テスト | `artifacts/code/` に既存コード<br>`artifacts/data-model/base` にデータモデル<br>`artifacts/design/base` にAPI一覧を配置 |
| **完全テスト** | 条件網羅テスト | `artifacts/code/` に既存コード<br>`artifacts/data-model/base` にデータモデル<br>`artifacts/design/base` にAPI一覧を配置 |

## ディレクトリ構成

```
.claude/
  CLAUDE.md                    # 隊長（全体管理）のルールブック
  settings.json                # フック設定・権限
  settings.local.json          # ローカル権限設定
  agents/                      # 各工程のエージェント定義（パイプライン12 + パイプライン外2）
    requirements.md            # 要件定義エージェント（兵 ①）
    data-modeling.md           # データモデリングエージェント（兵 ②）
    project-rule.md            # プロジェクトルール解析エージェント（兵 ③）
    design.md                  # 基本設計エージェント（兵 ④）
    coding.md                  # コーディングエージェント（兵 ⑤）
    code-review.md             # ソースレビューエージェント（兵 ⑥・隊長判断で実行）
    unit-test.md               # 単体テストエージェント（兵 ⑦）
    enhanced-test.md           # 強化テストエージェント（兵 ⑧）
    complete-test.md           # 完全テストエージェント（兵 ⑨）
    integration-test.md        # 結合テストエージェント（兵 ⑩）
    skill-dev.md               # スキル開発エージェント（兵 ⑪・隊長判断で実行）
    doc-merge.md               # ドキュメントマージエージェント（兵 ⑫）
    # ── パイプライン外エージェント（隊長が直接呼び出すユーティリティ）──
    prompt-optimizer.md        # プロンプト最適化エージェント（エージェント/スキル定義の改善）
    system-overview.md         # システム概要整理エージェント（コードベース全体の静的解析・一覧生成）
  hooks/
    update-pipeline-status.js  # パイプライン自動追跡フック（PreToolUse/PostToolUse）
  skills/
    format-order/SKILL.md      # 命令書フォーマット
    format-report/SKILL.md     # 報告書フォーマット
    pipeline-start/SKILL.md    # パイプライン初期化・チェックポイント復旧
    pipeline-metrics/SKILL.md  # 観測メトリクス取得
    pipeline-recover/SKILL.md  # エラーリカバリ手順
    quality-check/SKILL.md     # 品質ゲート検証・手動確認

pipeline/                      # パイプライン進捗管理
  pipeline-status-format.json  # 初期化テンプレート
  pipeline-status.json         # 実行中の進捗状態（フックが自動更新）
  init-pipeline.js             # pipeline-status.json を format から初期化するスクリプト（/pipeline-start から呼び出し）
  save-final-report.js         # 最終報告書を pipeline-status.json に保存するスクリプト（/pipeline-metrics から呼び出し）
  set-stage-reviews.js         # 工程ごとの将軍閣下レビュー要否（review_required）を一括設定するスクリプト

rules/
  pipeline-rules.md            # パイプライン詳細ルール（開発モード・並列実行・手戻り・品質ゲート等）隊長が開始前に参照
  project-rule.md              # コーディング規約・アーキテクチャ・参考プログラム一覧（自動生成）

tools/
  pipeline-monitor.js          # 監視用Webサーバー（http://localhost:8089）
  pipeline-monitor.html        # 監視用WebUI

artifacts/                     # 各工程の成果物（パイプライン実行で自動生成）
  requirements/                # 要件定義書
  data-model/                  # ER図・DDL・テストデータ
  design/                      # 基本設計書
  code/                        # ソースコード一式（Maven プロジェクト）
  test-results/                # テスト結果レポート
  merged-docs/                 # 最終統合ドキュメント
```

## セットアップ

初期設定・パス書き換えなどの環境構築手順は [SETUP.md](SETUP.md) を参照。

## 使い方

### 1. Pipeline Monitor を起動する

```bash
node tools/pipeline-monitor.js
```

ブラウザで http://localhost:8089 を開く。パイプラインの進捗・トークン消費量・各工程の命令書と報告をリアルタイムで確認できる。

### 2. Claude Code で命令する

Claude Code を起動し、作りたいシステムを指示する。

**新規開発の例:**
```
Java + Spring Boot + MyBatis で、会社・組織・社員を管理するREST APIを作れ。
MYSQLを使用し、テストもMYSQLで動くようにしろ。
```

**機能追加の例:**
```
mdx-dev-tenantにQA機能を実装しろ。
同一テナント内に閉じて使う機能とし、open～closeまでのステータスを管理しろ。
QAの担当者が設定されたときは、その担当者にメールを配信しろ。
QAがクローズされたときは、起票者にメールを配信しろ。
```

**強化テストの例:**
```
既存コードに対して強化テストを実施しろ。
```

隊長が自動的に以下を実行する:

1. `/pipeline-start` — 開発モード判定・パイプライン初期化（バックアップ・チェックポイント確認含む）
2. モードに応じた最初の工程へ `/format-order` で命令書を発令
3. 新規開発・機能追加: 要件定義完了後、将軍閣下に報告し**承認を待つ**
4. 承認後、モードに応じた工程を順次進行
5. 各工程完了時に `/format-report` — 将軍閣下へ報告書を提出
6. パイプライン完了後、`/pipeline-metrics` で観測データを集計して最終報告

### 3. Pipeline Monitor で確認する

- **ステージカード**: 各工程のステータス・トークン消費量・実行回数を表示
- **ステージクリック**: 命令書（隊長→兵）と報告書（兵→隊長）の通信履歴をモーダルで確認
- **「将軍閣下の命令」ボタン**: 最初に出した命令をモーダルで確認
- **トークン上限**: 入力欄から上限を設定可能。上限到達でパイプラインを自動停止

## 品質ゲート

各工程の遷移時にフックが成果物の存在・サイズ・ビルド結果を自動検証する。

| 工程 | 開始前チェック（入力） | 完了チェック（出力） |
|------|----------------------|-------------------|
| 要件定義 | ー（ユーザー指示のみ） | `artifacts/requirements/requirements.md` |
| データモデリング | `artifacts/requirements/requirements.md` | `artifacts/data-model/er-diagram.md`<br>`artifacts/data-model/ddl.sql`<br>`artifacts/data-model/table-definition.md` |
| プロジェクトルール解析 | `artifacts/code/`（.gitkeep を除く1つ以上） | `rules/project-rule.md` |
| 基本設計 | `artifacts/requirements/requirements.md`<br>`artifacts/data-model/ddl.sql`<br>`rules/project-rule.md` | `artifacts/design/basic-design.md` |
| コーディング | `artifacts/data-model/ddl.sql`<br>`artifacts/design/basic-design.md`<br>`rules/project-rule.md` | `artifacts/code/` |
| 単体テスト | `artifacts/design/basic-design.md`<br>`artifacts/code/`（.gitkeep を除く1つ以上）<br>`rules/project-rule.md` | `artifacts/test-results/unit-test-report.md` |
| 強化テスト | `artifacts/data-model/ddl.sql`<br>`artifacts/code/`（.gitkeep を除く1つ以上）<br>`rules/project-rule.md` | `artifacts/test-results/enhanced-test-report.md` |
| 完全テスト | `artifacts/code/`（.gitkeep を除く1つ以上）<br>`rules/project-rule.md` | `artifacts/test-results/complete-test-report.md` |
| 結合テスト | `artifacts/design/basic-design.md`<br>`artifacts/code/`（.gitkeep を除く1つ以上）<br>`rules/project-rule.md` | `artifacts/test-results/integration-test-report.md` |
| スキル開発 | `artifacts/requirements/requirements.md`<br>`artifacts/design/basic-design.md`<br>`artifacts/code/`（.gitkeep を除く1つ以上）<br>`artifacts/test-results/integration-test-report.md` | `.claude/skills/{skill-name}/SKILL.md`<br>`artifacts/docs/skill-dev-report.md` |
| ドキュメントマージ | `artifacts/requirements/requirements.md`<br>`artifacts/data-model/ddl.sql`<br>`artifacts/design/basic-design.md`<br>`artifacts/test-results/integration-test-report.md`<br>`rules/project-rule.md` | `artifacts/merged-docs/merged-document.md` |

※ ソースレビューは成果物ファイルを出力しないため、上記テーブルの対象外。レビュー結果は報告書としてフックに記録される。

フックがブロックした場合は隊長が `/quality-check` で対処する。

## 手戻り

テストで不具合が見つかった場合、隊長が自動で原因工程に差し戻す。

| 問題の種類 | 手戻り先 |
|-----------|---------|
| コード起因 | コーディング工程 |
| 設計起因 | 基本設計工程 |
| 要件不備 | 要件定義工程（報告書で通知） |

同一工程への手戻りが2回を超えた場合は、ユーザーに判断を仰ぐ。

## エラーリカバリ

- フックがエージェント失敗を自動検出し `retry_pending` または `error` ステータスを設定する
- `retry_pending` の場合、隊長が `/pipeline-recover` でリトライする
- パイプラインが途中で中断された場合、次回起動時に `pipeline-status.json` のチェックポイントから自動復旧できる

## 観測可能性

フックがパイプライン全体の以下の指標を `pipeline-status.json` に自動記録する:

- 各工程の実行時間・トークン消費量・実行回数・エラー回数・手戻り回数
- サブタスク数（並列実行時の分割数）
- 手戻りログ（発生工程・原因・手戻り先）

## パイプラインの仕組み

### 自動追跡（フック）

`.claude/settings.json` に設定されたフックが、エージェント起動・完了を自動検知し `pipeline/pipeline-status.json` を更新する。

- **PreToolUse**: エージェント開始時にステータスを `in_progress` に変更、命令書を記録
- **PostToolUse**: エージェント完了時にトークン使用量・報告書を記録、ステータスを `completed` に変更

### トークン上限管理

Pipeline Monitor のUI、または API で設定可能。

```bash
# 上限設定
curl -X POST http://localhost:8089/api/token-limit \
  -H "Content-Type: application/json" \
  -d '{"token_limit": 500000}'

# 上限解除
curl -X POST http://localhost:8089/api/token-limit \
  -H "Content-Type: application/json" \
  -d '{"token_limit": null}'
```

上限到達でパイプラインは `suspended` 状態になり、新しいエージェント起動がブロックされる。

### パイプラインのリセット

`/pipeline-start` スキルを実行すると:

1. 既存の `pipeline-status.json` を `pipeline-status-{yyyymmdd_hhmmss}.json` にバックアップ
2. `pipeline-status-format.json` から新しい初期状態を作成

`artifacts/` 配下は独立しているため、必要に応じて手動で削除できる。

## Skill 一覧

| Skill | 用途 | 使用タイミング |
|-------|------|--------------|
| `/pipeline-start` | パイプライン初期化・チェックポイント復旧 | パイプライン開始時（最初の1回） |
| `/format-order` | 命令書フォーマット適用 | 兵に命令を出す時 |
| `/format-report` | 報告書フォーマット適用 | 将軍閣下に報告する時 |
| `/pipeline-recover` | エラー復旧・リトライ | エージェント実行失敗時 |
| `/quality-check` | 品質ゲート検証・手動確認 | フックブロック時・成果物確認時 |
| `/pipeline-metrics` | 観測メトリクス取得 | パイプライン完了報告時 |

## エージェント一覧

| 工程 | 入力ドキュメント | 出力ドキュメント | 並列 |
|------|----------------|----------------|------|
| 要件定義 | ユーザーの指示 | `artifacts/requirements/requirements.md` | 不可 |
| データモデリング | `artifacts/requirements/requirements.md`<br>`artifacts/data-model/base/`（既存分） | `artifacts/data-model/er-diagram.md`<br>`artifacts/data-model/ddl.sql` | 不可 |
| プロジェクトルール解析 | `artifacts/requirements/requirements.md`<br>`artifacts/data-model/`<br>`artifacts/code/` | `rules/project-rule.md` | 不可 |
| 基本設計 | `artifacts/requirements/requirements.md`<br>`artifacts/data-model/`<br>`rules/project-rule.md` | `artifacts/design/basic-design.md` | 不可 |
| コーディング | `artifacts/data-model/`<br>`artifacts/design/basic-design.md`<br>`rules/project-rule.md` | `artifacts/code/`（ソースコード一式） | **可** |
| 単体テスト | `artifacts/design/basic-design.md`<br>`artifacts/code/`<br>`rules/project-rule.md` | `artifacts/test-results/unit/` | **可** |
| 強化テスト | `artifacts/data-model/`<br>`artifacts/code/`<br>`rules/project-rule.md` | `artifacts/test-results/enhanced/` | **可** |
| 完全テスト | `artifacts/code/`<br>`rules/project-rule.md` | `artifacts/test-results/complete/` | **可** |
| 結合テスト | `artifacts/design/basic-design.md`<br>`artifacts/code/`<br>`rules/project-rule.md` | `artifacts/test-results/integration/` | 不可 |
| スキル開発 | `artifacts/requirements/requirements.md`<br>`artifacts/design/`<br>`artifacts/code/`<br>`artifacts/test-results/`<br>`.claude/skills/` | `artifacts/skills/`（新規スキルファイル） | 不可 |
| ドキュメントマージ | `artifacts/requirements/`<br>`artifacts/data-model/`<br>`artifacts/design/`<br>`artifacts/test-results/`<br>`rules/project-rule.md` | `artifacts/merged-docs/`（統合ドキュメント） | 不可 |

## カスタマイズ

### 工程の追加

1. `.claude/agents/` に新しいエージェント定義を追加
2. `.claude/hooks/update-pipeline-status.js` の `AGENT_STAGE_MAP` と `PIPELINE_ORDER` に追記
3. `pipeline/pipeline-status-format.json` に `mode_definitions.enabled_stages`・`quality_gates`・`stages` を追加
4. `.claude/skills/` 配下の各スキル（pipeline-start, pipeline-recover, pipeline-metrics, quality-check）の `PIPELINE_ORDER` に追記
5. `tools/pipeline-monitor.html` の `STAGES` 配列に追加
