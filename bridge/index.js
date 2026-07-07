const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "";
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

const queue = [];
const sseClients = new Map();
let sessionCounter = 0;

function auth(req, res, next) {
  const s = req.query.secret || req.headers["x-bridge-secret"] || "";
  if (SECRET && s !== SECRET) {
    return res.status(403).json({ error: "unauthorized" });
  }
  next();
}

function getTools() {
  return [
    { name: "toy_status", description: "Check BLE bridge online status", inputSchema: { type: "object", properties: {} } },
    { name: "toy_set_speed", description: "Set toy intensity (0.0 to 1.0), optional sec for duration", inputSchema: { type: "object", properties: { speed: { type: "number", description: "0.0 to 1.0" }, sec: { type: "number", description: "duration in seconds" } }, required: ["speed"] } },
    { name: "toy_set_pattern", description: "Set vibration pattern (1-8) and level (0.2-1.0)", inputSchema: { type: "object", properties: { pattern: { type: "integer", description: "1-8" }, level: { type: "number", description: "0.2 to 1.0" } }, required: ["pattern"] } },
    { name: "toy_stop", description: "Immediately stop the toy", inputSchema: { type: "object", properties: {} } },
  ];
}

function handleRpc(body) {
  const { method, params, id } = body || {};

  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "svakom-ble-bridge", version: "1.0.0" } } };
  }

  if (method === "notifications/initialized" || (method && method.startsWith("notifications/"))) {
    return null;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: getTools() } };
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params || {};
    let result = {};

    switch (name) {
      case "toy_status":
        result = { online: true, queue_length: queue.length };
        break;
      case "toy_set_speed": {
        const cmd = { speed: Math.max(0, Math.min(1, Number(args.speed) || 0)) };
        if (args.sec) cmd.sec = Number(args.sec);
        queue.push(cmd);
        result = { content: [{ type: "text", text: JSON.stringify(cmd) }] };
        break;
      }
      case "toy_set_pattern": {
        const cmd = { pattern: Math.max(1, Math.min(8, Number(args.pattern) || 1)), level: Math.max(0.2, Math.min(1, Number(args.level) || 0.6)) };
        queue.push(cmd);
        result = { content: [{ type: "text", text: JSON.stringify(cmd) }] };
        break;
      }
      case "toy_stop":
        queue.push({ stop: true });
        result = { content: [{ type: "text", text: "stopped" }] };
        break;
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: "Tool not found: " + name } };
    }

    return { jsonrpc: "2.0", id, result };
  }

  return { jsonrpc: "2.0", id, error: { code: -32600, message: "Method not found: " + method } };
}

// Streamable HTTP (for Claude.ai + standard MCP clients)
app.post("/mcp", auth, (req, res) => {
  const result = handleRpc(req.body);
  if (result === null) return res.status(202).end();
  res.json(result);
});

// SSE transport (for MCP-compatible iOS / desktop clients)
app.get("/mcp/sse", auth, (req, res) => {
  sessionCounter++;
  const sessionId = "sess-" + sessionCounter + "-" + Date.now();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const endpointUrl = "/mcp/message?sessionId=" + sessionId + "&secret=" + (req.query.secret || "");
  res.write("event: endpoint\ndata: " + JSON.stringify({ uri: req.protocol + "://" + req.get("host") + endpointUrl }) + "\n\n");

  sseClients.set(sessionId, res);
  req.on("close", () => { sseClients.delete(sessionId); });
});

app.post("/mcp/message", auth, (req, res) => {
  const sessionId = req.query.sessionId;
  const sseRes = sseClients.get(sessionId);
  const result = handleRpc(req.body);

  if (result === null) return res.status(202).end();

  if (sseRes) {
    sseRes.write("data: " + JSON.stringify(result) + "\n\n");
    return res.status(202).end();
  }

  res.json(result);
});

// Bridge polling + health
app.get("/toy-next", auth, (req, res) => {
  res.json(queue.shift() || { type: "hello" });
});

app.get("/", (req, res) => {
  res.json({ ok: true, name: "svakom-ble-bridge", queue: queue.length });
});

app.listen(PORT, () => {
  console.log("bridge server running on port " + PORT);
});
