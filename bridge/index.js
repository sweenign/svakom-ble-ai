const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "";
const PORT = process.env.PORT || 3000;

// Serve toy.html for phone BLE bridge
app.use(express.static(path.join(__dirname)));

// --- Command queue ---
const queue = [];

function auth(req, res, next) {
  const s = req.query.secret || req.headers["x-bridge-secret"] || "";
  if (SECRET && s !== SECRET) {
    return res.status(403).json({ error: "unauthorized" });
  }
  next();
}

// --- MCP POST endpoint (JSON-RPC, for Claude.ai Integrations) ---
app.post("/mcp", auth, (req, res) => {
  const { method, params, id } = req.body || {};

  if (method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "toy_status",
            description: "Check BLE bridge online status",
            input_schema: { type: "object", properties: {} },
          },
          {
            name: "toy_set_speed",
            description: "Set toy intensity (0.0-1.0), optional sec for duration",
            input_schema: {
              type: "object",
              properties: {
                speed: { type: "number", description: "0.0-1.0" },
                sec: { type: "number", description: "duration in seconds" },
              },
              required: ["speed"],
            },
          },
          {
            name: "toy_set_pattern",
            description: "Set vibration pattern (1-8) and level (0.2-1.0)",
            input_schema: {
              type: "object",
              properties: {
                pattern: { type: "integer", description: "1-8" },
                level: { type: "number", description: "0.2-1.0" },
              },
              required: ["pattern"],
            },
          },
          {
            name: "toy_stop",
            description: "Immediately stop the toy",
            input_schema: { type: "object", properties: {} },
          },
        ],
      },
    });
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
        result = { ok: true, command: cmd };
        break;
      }
      case "toy_set_pattern": {
        const cmd = {
          pattern: Math.max(1, Math.min(8, Number(args.pattern) || 1)),
          level: Math.max(0.2, Math.min(1, Number(args.level) || 0.6)),
        };
        queue.push(cmd);
        result = { ok: true, command: cmd };
        break;
      }
      case "toy_stop":
        queue.push({ stop: true });
        result = { ok: true };
        break;
      default:
        return res.status(400).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Tool not found: " + name },
        });
    }

    return res.json({ jsonrpc: '2.0', id, result });
  }

  return res.status(400).json({
    jsonrpc: "2.0",
    id,
    error: { code: -32600, message: 'Invalid request' },
  });
});

// --- SSE MCP endpoint ---
app.get("/mcp", auth, (req, res) => {
  res.json({
    mcp: "json-rpc",
    version: "1.0.0",
  });
});

// --- Polling endpoint for bridge.py ---
app.get("/toy-next", auth, (req, res) => {
  const cmd = queue.shift() || { type: "hello" };
  res.json(cmd);
});

// --- Health check ---
app.get("/", (req, res) => {
  res.json({ ok: true, name: 'svakom-ble-bridge', queue: queue.length });
});

app.listen(PORT, () => {
  console.log("bridge server running on port " + PORT);
});