const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname);
const src = path.join(dir, 'pipeline-status-format.json');
const dst = path.join(dir, 'pipeline-status.json');

const fmt = JSON.parse(fs.readFileSync(src, 'utf-8'));
const modeDefs = fmt.pipeline.mode_definitions || {};
const validModes = Object.keys(modeDefs);

let mode = (process.argv[2] || '').toLowerCase().trim();

const modeAliases = {
  'new': 'new-development',
  'new-dev': 'new-development',
  'feature': 'feature-addition',
  'add': 'feature-addition',
  'enhanced': 'enhanced-test',
  'enhanced-test-only': 'enhanced-test',
  'complete': 'complete-test',
  'complete-test-only': 'complete-test',
};
mode = modeAliases[mode] || mode;

if (!validModes.includes(mode)) {
  console.error('\u4f7f\u7528\u65b9\u6cd5: node init-pipeline.js <\u30e2\u30fc\u30c9>');
  console.error('\u6709\u52b9\u306a\u30e2\u30fc\u30c9: ' + validModes.join(', '));
  for (const [k, v] of Object.entries(modeDefs)) {
    console.error('  ' + k + ' \u2014 ' + v.description);
  }
  process.exit(1);
}

// Backup existing file
const backupDir = path.join(dir, 'backups');
if (fs.existsSync(dst)) {
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
  console.log('\u30d0\u30c3\u30af\u30a2\u30c3\u30d7: ' + backup);
}

// Get enabled stages from mode_definitions
const enabledStages = modeDefs[mode].enabled_stages || [];

fmt.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fmt.pipeline.mode = mode;

// Set enabled/skipped per mode
for (const [stageKey, stage] of Object.entries(fmt.stages)) {
  stage.enabled = enabledStages.includes(stageKey);
  if (!stage.enabled) {
    stage.status = 'skipped';
  }
}

// Remove mode_definitions from runtime file (only needed during init)
delete fmt.pipeline.mode_definitions;

fs.writeFileSync(dst, JSON.stringify(fmt, null, 2), 'utf-8');
console.log('\u521d\u671f\u5316\u5b8c\u4e86: ' + dst + ' (\u30e2\u30fc\u30c9: ' + mode + ')');
console.log('\u6709\u52b9\u5de5\u7a0b: ' + enabledStages.join(', '));

// Cleanup old backups (keep latest 10)
if (fs.existsSync(backupDir)) {
  const MAX_BACKUPS = 10;
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('pipeline-status-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(backupDir, f));
      console.log('\u30d0\u30c3\u30af\u30a2\u30c3\u30d7\u524a\u9664: ' + f);
    }
    console.log('\u30af\u30ea\u30fc\u30f3\u30a2\u30c3\u30d7\u5b8c\u4e86: ' + toDelete.length + '\u4ef6\u524a\u9664\u3001' + MAX_BACKUPS + '\u4ef6\u4fdd\u6301');
  }
}
