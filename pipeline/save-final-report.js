const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, 'pipeline-status.json');
const reportText = process.argv[2];

if (!reportText) {
  console.error('使用方法: node save-final-report.js "報告書テキスト"');
  process.exit(1);
}

const s = JSON.parse(fs.readFileSync(f, 'utf-8'));

s.pipeline.status = 'completed';
s.pipeline.completed_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
s.pipeline.updated_at = s.pipeline.completed_at;
s.pipeline.current_stage = null;
s.pipeline.active_agents = [];
s.pipeline.final_report = reportText;

fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf-8');
console.log('最終報告記録完了');
