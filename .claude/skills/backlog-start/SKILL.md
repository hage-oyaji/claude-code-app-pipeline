---
name: backlog-start
description: Backlogの課題を取得してパイプラインを開始する。課題キーを受け取り、Backlog APIで課題内容を取得し、その内容を要件としてパイプラインを起動する。
---

# Backlog課題取得 & パイプライン開始手順

将軍閣下から課題キー（例: `DXS_DEV-123`）を受け取ったら、以下を順番に実行せよ。

## 1. Backlog APIで課題を取得

環境変数 `BACKLOG_APIKEY` からAPIキーを取得し、課題の詳細を取得する。

```bash
node -e "
const https = require('https');
const issueKey = process.argv[1];
const apiKey = process.env.BACKLOG_APIKEY;

if (!apiKey) {
  console.error('ERROR: 環境変数 BACKLOG_APIKEY が設定されていません');
  process.exit(1);
}
if (!issueKey) {
  console.error('ERROR: 課題キーが指定されていません');
  process.exit(1);
}

const url = 'https://tribeckst.backlog.jp/api/v2/issues/' + encodeURIComponent(issueKey) + '?apiKey=' + encodeURIComponent(apiKey);

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('ERROR: APIエラー status=' + res.statusCode);
      console.error(data);
      process.exit(1);
    }
    const issue = JSON.parse(data);
    console.log('=== Backlog課題取得完了 ===');
    console.log('課題キー: ' + issue.issueKey);
    console.log('件名: ' + issue.summary);
    console.log('種別: ' + (issue.issueType ? issue.issueType.name : '未設定'));
    console.log('状態: ' + (issue.status ? issue.status.name : '未設定'));
    console.log('優先度: ' + (issue.priority ? issue.priority.name : '未設定'));
    console.log('担当者: ' + (issue.assignee ? issue.assignee.name : '未設定'));
    console.log('開始日: ' + (issue.startDate || '未設定'));
    console.log('期限日: ' + (issue.dueDate || '未設定'));
    console.log('');
    console.log('--- 説明 ---');
    console.log(issue.description || '（説明なし）');
    console.log('--- 説明終わり ---');
    console.log('');
    console.log('ISSUE_JSON_START');
    console.log(JSON.stringify(issue, null, 2));
    console.log('ISSUE_JSON_END');
  });
}).on('error', (e) => {
  console.error('ERROR: ' + e.message);
  process.exit(1);
});
" '{課題キーをここに置換}'
```

**注意:** `{課題キーをここに置換}` を将軍閣下が指定した課題キーに置換してから実行せよ。

## 2. 子課題の取得（任意）

親課題に子課題がある場合、子課題一覧も取得して要件の全体像を把握する。

```bash
node -e "
const https = require('https');
const issueKey = process.argv[1];
const apiKey = process.env.BACKLOG_APIKEY;

const url = 'https://tribeckst.backlog.jp/api/v2/issues?apiKey=' + encodeURIComponent(apiKey) + '&parentIssueId[]=' + encodeURIComponent(issueKey) + '&count=100';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode !== 200) { console.log('子課題取得スキップ'); return; }
    const issues = JSON.parse(data);
    if (issues.length === 0) { console.log('子課題: なし'); return; }
    console.log('=== 子課題一覧 ===');
    issues.forEach(i => {
      console.log('  ' + i.issueKey + ': ' + i.summary + ' [' + (i.status ? i.status.name : '未設定') + ']');
    });
  });
}).on('error', () => console.log('子課題取得スキップ'));
" '{課題IDをここに置換（課題キーではなく数値IDを使用）}'
```

**注意:** 子課題取得には数値IDが必要。手順1の取得結果 `issue.id` の値を使用すること。子課題が存在しない場合はスキップしてよい。

## 3. 取得内容の要約を将軍閣下に報告

取得した課題内容を以下の形式で将軍閣下に報告し、パイプライン開始の確認を取れ。

```
Backlog課題 {課題キー} を取得いたしました。

【課題概要】
- 件名: {summary}
- 種別: {issueType}
- 状態: {status}
- 担当者: {assignee}
- 期限: {dueDate}

【説明要約】
{description の要約（200文字以内）}

この課題内容を要件としてパイプラインを開始いたします。
よろしいでしょうか、将軍閣下。
```

将軍閣下の承認（「進めよ」等）を待て。

## 4. パイプライン開始

将軍閣下の承認後、`/pipeline-start` スキルを実行せよ。

このとき、「将軍閣下の命令内容」として Backlog課題の以下の情報を使用すること:
- 課題キー
- 件名（summary）
- 説明（description）全文
- 子課題一覧（存在する場合）

`/pipeline-start` の手順3「将軍閣下の命令を記録」では、上記の課題内容を `initial_command` として記録せよ。

## エラー時の対処

| エラー | 対処 |
|--------|------|
| `BACKLOG_APIKEY が設定されていません` | 将軍閣下に環境変数の設定を依頼せよ |
| `APIエラー status=401` | APIキーが無効。将軍閣下に確認せよ |
| `APIエラー status=404` | 課題キーが存在しない。将軍閣下に確認せよ |
| `APIエラー status=403` | アクセス権限なし。将軍閣下に確認せよ |
| ネットワークエラー | VPN接続等を確認するよう将軍閣下に依頼せよ |
