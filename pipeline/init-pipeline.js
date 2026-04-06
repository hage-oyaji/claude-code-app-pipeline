const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname);
const src = path.join(dir, 'pipeline-status-format.json');
const dst = path.join(dir, 'pipeline-status.json');

// モード引数（省略時は normal）
let mode = (process.argv[2] || 'normal').toLowerCase().trim();

// モード名の正規化（揺れ吸収）
const modeAliases = {
  'normal': 'normal',
  'enhanced-test': 'enhanced-test',
  'enhanced-test-only': 'enhanced-test',
  'enhanced': 'enhanced-test',
  'complete-test': 'complete-test',
  'complete-test-only': 'complete-test',
  'complete': 'complete-test'
};
mode = modeAliases[mode] || mode;

const validModes = ['normal', 'enhanced-test', 'complete-test'];
if (!validModes.includes(mode)) {
  console.error('無効なモード: ' + mode);
  console.error('有効なモード: ' + validModes.join(', '));
  process.exit(1);
}

// モードごとの enabled 定義
const modeEnabled = {
  'normal': {
    'requirements': true, 'data-modeling': true, 'design': true, 'project-rule': true,
    'coding': true, 'unit-test': true, 'enhanced-test': false, 'complete-test': false,
    'integration-test': true, 'skill-dev': true
  },
  'enhanced-test': {
    'requirements': false, 'data-modeling': false, 'design': false, 'project-rule': false,
    'coding': false, 'unit-test': false, 'enhanced-test': true, 'complete-test': false,
    'integration-test': true, 'skill-dev': false
  },
  'complete-test': {
    'requirements': false, 'data-modeling': false, 'design': false, 'project-rule': false,
    'coding': false, 'unit-test': false, 'enhanced-test': false, 'complete-test': true,
    'integration-test': true, 'skill-dev': false
  }
};

// 既存ファイルのバックアップ
if (fs.existsSync(dst)) {
  const backupDir = path.join(dir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const now = new Date();
  const ts = now.getFullYear().toString()
    + String(now.getMonth()+1).padStart(2,'0')
    + String(now.getDate()).padStart(2,'0')
    + '_'
    + String(now.getHours()).padStart(2,'0')
    + String(now.getMinutes()).padStart(2,'0')
    + String(now.getSeconds()).padStart(2,'0');
  const backup = path.join(backupDir, 'pipeline-status-' + ts + '.json');
  fs.renameSync(dst, backup);
  console.log('バックアップ: ' + backup);
}

// フォーマットファイルをコピーして初期化
const fmt = JSON.parse(fs.readFileSync(src, 'utf-8'));
fmt.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fmt.pipeline.mode = mode;

// モードに応じて各 stage の enabled を設定
const enabledMap = modeEnabled[mode];
for (const [stageKey, stage] of Object.entries(fmt.stages)) {
  if (enabledMap.hasOwnProperty(stageKey)) {
    stage.enabled = enabledMap[stageKey];
  }
}

fs.writeFileSync(dst, JSON.stringify(fmt, null, 2), 'utf-8');
console.log('初期化完了: ' + dst + ' (モード: ' + mode + ')');
