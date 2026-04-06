const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, 'pipeline-status.json');
const reportText = process.argv[2];

if (!reportText) {
  console.error('使用方法: node save-final-report.js "報告書テキスト"');
  process.exit(1);
}

const s = JSON.parse(fs.readFileSync(f, 'utf-8'));

// 全 enabled 工程が completed または skipped であることを検証する
const PIPELINE_ORDER = [
  "requirements", "data-modeling", "project-rule",
  "design", "coding", "code-review", "unit-test", "enhanced-test", "complete-test",
  "integration-test", "skill-dev", "doc-merge",
];

const incomplete = [];
for (const key of PIPELINE_ORDER) {
  const stage = s.stages[key];
  if (!stage || stage.enabled === false) continue;
  const status = stage.status || "not_started";
  if (status !== "completed" && status !== "skipped") {
    incomplete.push(`${key} (status: ${status})`);
  }
}

if (incomplete.length > 0) {
  console.error('ERROR: 以下の enabled 工程が未完了のため、最終報告を記録できません:');
  for (const item of incomplete) {
    console.error(`  - ${item}`);
  }
  console.error('');
  console.error('全ての有効工程を完了してから再実行してください。');
  process.exit(1);
}

s.pipeline.status = 'completed';
s.pipeline.completed_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
s.pipeline.updated_at = s.pipeline.completed_at;
s.pipeline.current_stage = null;
s.pipeline.active_agents = [];
s.pipeline.final_report = reportText;

fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf-8');
console.log('最終報告記録完了');
