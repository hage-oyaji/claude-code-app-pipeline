#!/usr/bin/env node
/**
 * パイプラインモニター（工程内並列対応版）
 *
 *   node tools/pipeline-monitor.js
 *   http://localhost:8089
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8089;
const PROJECT_DIR = path.resolve(__dirname, "..");
const STATUS_FILE = path.join(PROJECT_DIR, "pipeline", "pipeline-status.json");
const HTML_FILE = path.join(__dirname, "pipeline-monitor.html");

function readStatus() {
  try { return fs.readFileSync(STATUS_FILE, "utf-8"); }
  catch { return '{"pipeline":{"status":"not_started","active_agents":[]},"stages":{}}'; }
}

function readAndParseStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8")); }
  catch { return null; }
}

function writeStatus(status) {
  status.pipeline.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), "utf-8");
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/status")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(readStatus());

  } else if (req.url === "/api/token-limit" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { token_limit } = JSON.parse(body);
        const status = readAndParseStatus();
        if (!status) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "読み込み失敗" })); return; }

        const totalTokens = (status.pipeline.total_input_tokens || 0) + (status.pipeline.total_output_tokens || 0);
        status.pipeline.token_limit = (token_limit === null || token_limit === undefined) ? null : Number(token_limit);

        if (status.pipeline.token_limit === null) {
          status.pipeline.token_limit_reached = false;
          if (status.pipeline.status === "suspended") status.pipeline.status = "in_progress";
        } else if (totalTokens > status.pipeline.token_limit) {
          status.pipeline.token_limit_reached = true;
          status.pipeline.status = "suspended";
        } else {
          status.pipeline.token_limit_reached = false;
          if (status.pipeline.status === "suspended") status.pipeline.status = "in_progress";
        }

        writeStatus(status);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, token_limit: status.pipeline.token_limit }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.url === "/api/initial-command" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { initial_command } = JSON.parse(body);
        const status = readAndParseStatus();
        if (!status) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "読み込み失敗" })); return; }

        status.pipeline.initial_command = initial_command || null;
        writeStatus(status);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else {
    let html;
    try { html = fs.readFileSync(HTML_FILE, "utf-8"); }
    catch { res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); res.end("HTML読み込み失敗"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Pipeline Monitor: http://localhost:${PORT}`);
  console.log("Ctrl+C で停止");
});
