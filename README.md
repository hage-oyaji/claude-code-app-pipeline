# Claude Code Agent Pipeline

Claude Code のサブエージェント機能を活用した、ソフトウェア開発パイプラインシステム。
要件定義からテストまでの全工程を、専門エージェントが順番に自動実行する。

## 概要

ユーザー（将軍閣下）が開発したいシステムを指示すると、全体管理エージェント（隊長）が10の専門エージェント（兵）に作業を順次指示し、成果物を `artifacts/` に出力する。

コーディング・テスト工程は**工程内並列実行**に対応しており、モジュール単位で複数エージェントが同時稼働できる。

```
将軍閣下（ユーザー）
  │ 命令
  ▼
隊長（CLAUDE.md）── 全体管理・進捗管理・品質ゲート
  │ 命令書
  ▼
┌──────┐  ┌──────┐  ┌──────┐  ┌──────────┐  ┌──────┐     ┌──────┐  ┌──────┐  ┌──────┐
│要件  │─▶│データ│─▶│基本  │─▶│プロジェ  │─▶│コーディ│[並列]▶│単体  │[並列]▶│結合  │─▶│スキル│
│定義  │  │モデル│  │設計  │  │クトルール│  │ング    │     │テスト│     │テスト│  │開発  │
└──────┘  └──────┘  └──────┘  └──────────┘  └──────┘     └──────┘  └──────┘  └──────┘
```

※ 要件定義完了後、内容を確認して承認（「進めよ」など）してから次工程へ進む。

### テストモード

| モード | 使用エージェント | 概要 |
|--------|----------------|------|
| **通常テスト** | 単体テスト / 結合テスト | 正常系・異常系・境界値テスト |
| **強化テスト** | 強化テストエージェント | カバレッジ100%を目標 |
| **完全テスト** | 完全テストエージェント | 条件網羅・SQL全組み合わせテスト |

通常パイプラインでは通常テストを使用する。強化テスト・完全テストは明示的に指示した場合のみ実行される。

## ディレクトリ構成

```
.claude/
  CLAUDE.md                    # 隊長（全体管理）のルールブック
  settings.json                # フック設定・権限
  settings.local.json          # ローカル権限設定
  agents/                      # 各工程のエージェント定義（10ファイル）
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
```

## 初期設定（絶対パスの書き換え）

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

```
Java + Spring Boot + MyBatis で、会社・組織・社員を管理するREST APIを作れ。
MySQLを使用し、テストはH2で動くようにしろ。
```

隊長が自動的に以下を実行する:

1. `/pipeline-start` — パイプライン初期化（既存データのバックアップ・チェックポイント確認含む）
2. `/format-order` — 要件定義エージェントへ命令書を発令
3. 要件定義完了後、将軍閣下に報告し**承認を待つ**
4. 承認後、データモデリング → 基本設計 → プロジェクトルール解析 → コーディング → 単体テスト → 結合テスト と順次進行
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
| 要件定義 | `artifacts/requirements/requirements.md` の存在 |
| データモデリング | DDL・ER図の存在 |
| 基本設計 | 基本設計書の存在 |
| プロジェクトルール解析 | `rules/project-rule.md` の存在 |
| コーディング | `artifacts/code/src/` の存在 + `mvn compile` 通過 |
| テスト工程 | `artifacts/test-results/` の存在 + テスト合格率 |

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
| `/pipeline-start` | パイプライン初期化・命令記録 | パイプライン開始時（最初の1回） |
| `/format-order` | 命令書フォーマット適用 | 兵に命令を出す時 |
| `/format-report` | 報告書フォーマット適用 | 将軍閣下に報告する時 |

## エージェント一覧

| 工程 | エージェント | 入力 | 出力 | 並列 |
|------|------------|------|------|------|
| 要件定義 | 要件定義エージェント | ユーザーの指示 | `artifacts/requirements/` | 不可 |
| データモデリング | データモデリングエージェント | requirements/ | `artifacts/data-model/` | 不可 |
| 基本設計 | 基本設計エージェント | requirements/ + data-model/ | `artifacts/design/` | 不可 |
| プロジェクトルール解析 | プロジェクトルール解析エージェント | requirements/ + design/ + code/ | `rules/` | 不可 |
| コーディング | コーディングエージェント | requirements/ + data-model/ + design/ + rules/ | `artifacts/code/` | **可** |
| 単体テスト | 単体テストエージェント | design/ + code/ + rules/ | `artifacts/test-results/` | **可** |
| 強化テスト | 強化テストエージェント | design/ + code/ + rules/ | `artifacts/test-results/` | **可** |
| 完全テスト | 完全テストエージェント | requirements/ + data-model/ + design/ + code/ + rules/ | `artifacts/test-results/` | **可** |
| 結合テスト | 結合テストエージェント | design/ + code/ + rules/ | `artifacts/test-results/` | 不可 |
| スキル開発 | スキル開発エージェント | requirements/ + design/ + code/ + test-results/ + .claude/skills/ | `artifacts/skills/` | 不可 |

## カスタマイズ

### エージェントの変更

`.claude/agents/` 配下の Markdown ファイルを編集する。各ファイルの frontmatter でモデルやツールを指定できる。

### 工程の追加

1. `.claude/agents/` に新しいエージェント定義を追加
2. `.claude/hooks/update-pipeline-status.js` の `AGENT_STAGE_MAP` と `PIPELINE_ORDER` に追記
3. `pipeline/pipeline-status-format.json` に新工程のステージ定義を追加
4. `tools/pipeline-monitor.html` の `STAGES` 配列に追加
