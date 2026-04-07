# Claude Code Agent Pipeline

Claude Code のサブエージェント機能を活用した、ソフトウェア開発パイプラインシステム。
要件定義からテストまでの全工程を、専門エージェントが順番に自動実行する。

## 概要

ユーザー（将軍閣下）が開発したいシステムを指示すると、全体管理エージェント（隊長）が11の専門エージェント（兵）に作業を順次指示し、成果物を `artifacts/` に出力する。

コーディング・テスト工程は**工程内並列実行**に対応しており、モジュール単位で複数エージェントが同時稼働できる。

```
将軍閣下（ユーザー）
  │ 命令
  ▼
隊長（CLAUDE.md）── 全体管理・進捗管理・品質ゲート
  │ モード判定 → 承認
  ▼

【新規開発モード】              【機能追加モード】
1. 要件定義                     1. 要件定義
  ▼ [承認]                       ▼ [承認]
2. データモデリング             2. データモデリング
  ▼                               ▼
  (スキップ)                    3. プロジェクトルール解析
  ▼                               ▼
3. 基本設計                     4. 基本設計
  ▼ [承認]                       ▼ [承認]
4. コーディング   ← 並列可     5. コーディング   ← 並列可
  ▼                               ▼
5. 単体テスト     ← 並列可     6. 単体テスト     ← 並列可
  ▼                               ▼
6. 結合テスト                   7. 結合テスト
  ▼                               ▼
7. スキル開発（任意）           8. スキル開発（任意）
  ▼                               ▼
8. ドキュメントマージ           9. ドキュメントマージ

【強化テストモード】            【完全テストモード】
1. 強化テスト     ← 並列可     1. 完全テスト     ← 並列可
  ▼                               ▼
2. 結合テスト                   2. 結合テスト
  ▼                               ▼
3. ドキュメントマージ           3. ドキュメントマージ
```

※ 要件定義完了後・基本設計完了後に、内容を確認して承認（「進めよ」など）してから次工程へ進む。

### 開発モード

パイプライン起動時に開発モードを判定し、実行する工程が変わる。

| モード | 概要 | 事前条件 |
|--------|------|---------|
| **新規開発** | ゼロからシステムを構築 | なし |
| **機能追加** | 既存コードに機能を追加 | `artifacts/code/` に既存コード配置 |
| **強化テスト** | カバレッジ100%テスト | `artifacts/code/` に既存コード配置 |
| **完全テスト** | 条件網羅テスト | `artifacts/code/` に既存コード配置 |

## ディレクトリ構成

```
.claude/
  CLAUDE.md                    # 隊長（全体管理）のルールブック
  settings.json                # フック設定・権限
  settings.local.json          # ローカル権限設定
  agents/                      # 各工程のエージェント定義（11ファイル）
    requirements.md            # 要件定義エージェント
    data-modeling.md           # データモデリングエージェント
    design.md                  # 基本設計エージェント
    project-rule.md            # プロジェクトルール解析エージェント
    coding.md                  # コーディングエージェント
    unit-test.md               # 単体テストエージェント
    enhanced-test.md           # 強化テストエージェント
    complete-test.md           # 完全テストエージェント
    integration-test.md        # 結合テストエージェント
    skill-dev.md               # スキル開発エージェント
    doc-merge.md               # ドキュメントマージエージェント
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

rules/
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

## 初期設定

### フォルダ構成の作成

クローン後、以下のコマンドで成果物フォルダを作成する。

```bash
mkdir -p artifacts/requirements
mkdir -p artifacts/data-model
mkdir -p artifacts/design
mkdir -p artifacts/code
mkdir -p artifacts/test-results
mkdir -p rules
```

### 既存資産の配置（機能追加・テストモード）

機能追加・強化テスト・完全テストモードでは、事前に既存資産を配置する必要がある。

```bash
# 既存コードを配置（必須）
cp -r /path/to/existing-project/* artifacts/code/

# 既存のDDL・ER図がある場合は data-model/ にも配置（推奨）
cp /path/to/existing-ddl.sql artifacts/data-model/ddl.sql
cp /path/to/existing-er.md artifacts/data-model/er-diagram.md
```

- `artifacts/code/` が空の場合、機能追加・テストモードは**開始不可**（隊長が事前条件チェックでブロック）
- 機能追加モードで `artifacts/data-model/ddl.sql` が存在しない場合、データモデルを新規作成してよいか確認される

### 絶対パスの書き換え

このリポジトリは一部のファイルに**絶対パスがハードコードされている**。クローン後、自分の環境に合わせて以下を書き換えること。

### 影響を受けるファイル

| ファイル | 記載内容 | 書き換え箇所 |
|---------|---------|------------|
| `.claude/settings.local.json` | `Read/Write/Edit` 権限のパス | `artifacts/` 配下へのパス |
| `.claude/settings.json` | `Bash` 権限のパス | Pipeline Monitor スクリプトパス・JDKパス |

### `.claude/settings.local.json`

`Read/Write/Edit` 権限はツールが渡す絶対パスと照合されるため、相対パスは無効。  
パス形式は **bash スタイル**（`//c/...`）で記載すること（`C:\...` 形式は非対応）。

```json
{
  "permissions": {
    "allow": [
      "Bash(find *)",
      "Read(//c/<ドライブ以下のパス>/artifacts/**)",
      "Write(//c/<ドライブ以下のパス>/artifacts/**)",
      "Edit(//c/<ドライブ以下のパス>/artifacts/**)"
    ]
  }
}
```

**例**: プロジェクトが `C:\work\my-pipeline` にある場合
```
//c/work/my-pipeline/artifacts/**
```

### `.claude/settings.json`

Pipeline Monitor と JDK のパスを書き換える。

```json
"Bash(node <プロジェクトの絶対パス>/tools/pipeline-monitor.js)"
```

JDK パスを含む行（`/c/Users/.../java.exe` の形式）も実際のインストール先に変更する。  
Pipeline Monitor の Bash 権限が不要な場合は該当行をまとめて削除してよい。

---

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
PostgreSQLを使用し、テストもPostgreSQLで動くようにしろ。
```

**機能追加の例:**
```
既存の社員管理APIに、勤怠管理機能を追加しろ。
```
※ 事前に `artifacts/code/` へ既存コードを配置しておくこと。

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

### 4. 手戻り

テストで不具合が見つかった場合、隊長が自動で原因工程に差し戻す。

| 問題の種類 | 手戻り先 |
|-----------|---------|
| コード起因 | コーディング工程 |
| 設計起因 | 基本設計工程 |
| 要件不備 | 要件定義工程（報告書で通知） |

同一工程への手戻りが2回を超えた場合は、ユーザーに判断を仰ぐ。

### 5. エラーリカバリ

- フックがエージェント失敗を自動検出し `retry_pending` または `error` ステータスを設定する
- `retry_pending` の場合、隊長が `/pipeline-recover` でリトライする
- パイプラインが途中で中断された場合、次回起動時に `pipeline-status.json` のチェックポイントから自動復旧できる

## 品質ゲート

各工程の遷移時にフックが成果物の存在・サイズ・ビルド結果を自動検証する。

| 工程 | 検証内容 |
|------|---------|
| 要件定義 | `artifacts/requirements/requirements.md` の存在（100B以上） |
| データモデリング | `artifacts/data-model/ddl.sql` + `er-diagram.md` の存在（各100B以上） |
| プロジェクトルール解析 | `rules/project-rule.md` の存在（100B以上） |
| 基本設計 | `artifacts/design/basic-design.md` の存在（100B以上） |
| コーディング | `artifacts/code/` ディレクトリの存在（ファイル1つ以上） |
| テスト工程 | `artifacts/test-results/` ディレクトリの存在 |

フックがブロックした場合は隊長が `/quality-check` で対処する。

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

| 工程 | エージェント | 入力 | 出力 | 並列 |
|------|------------|------|------|------|
| 要件定義 | 要件定義エージェント | ユーザーの指示 | `artifacts/requirements/` | 不可 |
| データモデリング | データモデリングエージェント | requirements/ + data-model/ | `artifacts/data-model/` | 不可 |
| プロジェクトルール解析 | プロジェクトルール解析エージェント | requirements/ + data-model/ + code/ | `rules/` | 不可 |
| 基本設計 | 基本設計エージェント | requirements/ + data-model/ + rules/ | `artifacts/design/` | 不可 |
| コーディング | コーディングエージェント | data-model/ + design/(今回分のみ) + rules/ | `artifacts/code/` | **可** |
| 単体テスト | 単体テストエージェント | code/ + rules/ | `artifacts/test-results/` | **可** |
| 強化テスト | 強化テストエージェント | code/ + rules/ | `artifacts/test-results/` | **可** |
| 完全テスト | 完全テストエージェント | data-model/ + design/(今回分のみ) + code/ + rules/ | `artifacts/test-results/` | **可** |
| 結合テスト | 結合テストエージェント | design/(今回分のみ) + code/ + rules/ | `artifacts/test-results/` | 不可 |
| スキル開発 | スキル開発エージェント | requirements/ + design/ + code/ + test-results/ + .claude/skills/ | `artifacts/skills/` | 不可 |
| ドキュメントマージ | ドキュメントマージエージェント | requirements/ + data-model/ + design/ + test-results/ + rules/ | `artifacts/merged-docs/` | 不可 |

## カスタマイズ

### エージェントの変更

`.claude/agents/` 配下の Markdown ファイルを編集する。各ファイルの frontmatter でモデルやツールを指定できる。

### 工程の追加

1. `.claude/agents/` に新しいエージェント定義を追加
2. `.claude/hooks/update-pipeline-status.js` の `AGENT_STAGE_MAP` と `PIPELINE_ORDER` に追記
3. `pipeline/pipeline-status-format.json` に `mode_definitions.enabled_stages`・`quality_gates`・`stages` を追加
4. `.claude/skills/` 配下の各スキル（pipeline-start, pipeline-recover, pipeline-metrics, quality-check）の `PIPELINE_ORDER` に追記
5. `tools/pipeline-monitor.html` の `STAGES` 配列に追加
