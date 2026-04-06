const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, 'pipeline-status.json');
const command = process.argv[2];

if (!command) {
  console.error('使用方法: node record-command.js "命令内容"');
  process.exit(1);
}

const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
s.pipeline.initial_command = command;
s.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(f, JSON.stringify(s, null, 2), 'utf-8');
console.log('命令記録完了');
