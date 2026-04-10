# セットアップガイド

## 既存資産の配置（機能追加・テストモード）

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

## 絶対パスの書き換え

このリポジトリは一部のファイルに**絶対パスがハードコードされている**。クローン後、自分の環境に合わせて以下を書き換えること。

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
