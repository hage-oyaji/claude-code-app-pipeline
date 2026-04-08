#!/usr/bin/env node
/**
 * 将軍閣下レビュー設定スクリプト
 *
 * 使用方法:
 *   node pipeline/set-stage-reviews.js design,coding
 *   node pipeline/set-stage-reviews.js '{"design":true,"coding":false}'
 *   node pipeline/set-stage-reviews.js --clear   ← 必須工程以外のレビューをリセット
 *
 * 指定した工程に review_required: true を設定する。
 * 指定しなかった有効工程は review_required: false になる。
 *
 * 注意: review_mandatory: true の工程（現在: requirements）は
 *       常に review_required: true に強制される。--clear でも解除不可。
 */

const fs = require('fs');
const path = require('path');

const STATUS_FILE = path.join(__dirname, 'pipeline-status.json');

if (!fs.existsSync(STATUS_FILE)) {
  console.error('ERROR: pipeline-status.json が見つかりません。init-pipeline.js を先に実行してください。');
  process.exit(1);
}

const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
const arg = (process.argv[2] || '').trim();

// --clear オプション
if (arg === '--clear') {
  for (const [key, stage] of Object.entries(status.stages)) {
    if (stage.review_mandatory) {
      // 必須工程は解除不可
      stage.review_required = true;
      console.log('  [保護] ' + key + ' は必須レビュー工程のため解除できません。');
    } else {
      stage.review_required = false;
      stage.review_status = null;
      stage.review_comment = null;
    }
  }
  status.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
  console.log('必須工程以外のレビュー設定をリセットしました。');
  process.exit(0);
}

// JSON 形式 or カンマ区切り
let reviewMap = {};
if (arg.startsWith('{')) {
  try {
    reviewMap = JSON.parse(arg);
  } catch (e) {
    console.error('ERROR: JSON パースエラー: ' + e.message);
    process.exit(1);
  }
} else if (arg) {
  for (const key of arg.split(',').map(s => s.trim()).filter(Boolean)) {
    reviewMap[key] = true;
  }
} else {
  console.error('使用方法: node pipeline/set-stage-reviews.js <stage1,stage2,...>');
  console.error('       または: node pipeline/set-stage-reviews.js \'{"stage1":true,"stage2":false}\'');
  console.error('       または: node pipeline/set-stage-reviews.js --clear');
  process.exit(1);
}

const PIPELINE_ORDER = [
  'requirements','data-modeling','project-rule','design','coding',
  'code-review','unit-test','enhanced-test','complete-test',
  'integration-test','skill-dev','doc-merge'
];

const changed = [];
for (const key of PIPELINE_ORDER) {
  const stage = status.stages[key];
  if (!stage) continue;

  // 必須工程は常に true に強制（外部からの変更を無視）
  if (stage.review_mandatory) {
    if (!stage.review_required) {
      stage.review_required = true;
      changed.push(key + ': false -> true (必須工程のため強制)');
    }
    continue;
  }

  const wasRequired = stage.review_required || false;
  // JSON形式で明示指定があればその値、カンマ区切りなら指定キーはtrue、未指定はfalse
  const nowRequired = key in reviewMap ? Boolean(reviewMap[key]) : false;
  stage.review_required = nowRequired;
  if (!nowRequired) {
    stage.review_status = null;
    stage.review_comment = null;
  }
  if (wasRequired !== nowRequired) {
    changed.push(key + ': ' + wasRequired + ' -> ' + nowRequired);
  }
}

status.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');

if (changed.length > 0) {
  console.log('レビュー設定を更新しました:');
  changed.forEach(c => console.log('  ' + c));
} else {
  console.log('変更なし（既に同じ設定です）。');
}

// 現在の設定を表示
console.log('\n現在のレビュー設定:');
for (const key of PIPELINE_ORDER) {
  const stage = status.stages[key];
  if (!stage || !stage.enabled) continue;
  let mark, suffix = '';
  if (stage.review_mandatory) {
    mark = '[★ レビュー必須]';
    suffix = ' ← 必須（変更不可）';
  } else if (stage.review_required) {
    mark = '[✓ レビューあり]';
  } else {
    mark = '[  レビューなし]';
  }
  console.log('  ' + mark + ' ' + key + suffix);
}
