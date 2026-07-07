import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import crypto from "crypto";

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "";
const PORT = process.env.PORT || 3000;

// Serve toy.html for phone BLE bridge
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(__dirname));

// --- Command queue ---
// The BLE bridge polls /toy-next; the MCP / Claude pushes commands in.
const queue = [];

function auth(req, res, next) {
  const s = req.query.secret || req.headers["x-bridge-secret"] || "";
  if (SECRET && s !== SECRET) {
    return res.status(403).json({ error: "unauthorized" });
  }
  next();
}

// --- MCP (Model Context Protocol) SSE endpoint ---
// Claude.ai connects here to expose tools to the AI.
app.get("/mcp", auth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send server info event
  res.write(`data: ${JSON.stringify({ type: "server", version: "1.0.0" })}\n\n`);

  // --- Tools list ---
  const tools = [
    {
      name: "toy_status",
      description: "Check whether the BLE bridge is currently connected and online.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "toy_set_speed",
      description: "Set the toy intensity/speed (0.0 to 1.0). Optionally set duration in seconds.",
      input_schema: {
        type: "object",
        properties: {
          speed: { type: "number", description: "Intensity 0.0–1.0" },
          sec: { type: "number", description: "Duration in seconds (optional)" },
        },
        required: ["speed"],
      },
    },
    {
      name: "toy_set_pattern",
      description: "Set vibration pattern (1-8) and level (0.2-1.0). Only vibrator responds.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "integer", description: "Pattern 1-8" },
          level: { type: "number", description: "Level 0.2-1.0, default 0.6" },
        },
        required: ["pattern"],
      },
    },
    {
      name: "toy_stop",
      description: "Immediately stop the toy.",
      input_schema: { type: "object", properties: {} },
    },
  ];

  res.write(`data: ${JSON.stringify({ type: "tools", tools })}\n\n`);

  // Listen for tool calls
  let buf = "";
  req.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const msg = JSON.parse(line.slice(6));
        handleMcpCall(msg, res);
      } catch (e) {
        // ignore parse errors
      }
    }
  });

  req.on("close", () => {
    // client disconnected
  });
});

// MCP tool call handler
async function handleMcpCall(msg, res) {
  if (msg.type !== "call") return;

  const { id, tool, args = {} } = msg;
  let result = {};

  switch (tool) {
    case "toy_status": {
      result = { online: true, queue_length: queue.length };
      break;
    }
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
    case "toy_stop": {
      queue.push({ stop: true });
      result = { ok: true };
      break;
    }
    default:
      result = { error: `unknown tool: ${tool}` };
  }

  res.write(`data: ${JSON.stringify({ type: "result", id, result })}\n\n`);
}

// --- Simplified MCP via POST (for Claude.ai Integrations) ---
app.post("/mcp", auth, async (req, res) => {
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
            description: "Set toy intensity (0.0–1.0), optional sec for duration",
            input_schema: {
              type: "object",
              properties: {
                speed: { type: "number", description: "0.0–1.0" },
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
        return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Tool not found: ${name}` } });
    }

    return res.json({ jsonrpc: "2.0", id, result });
  }

  return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid request" } });
});

// --- Polling endpoint for bridge.py ---
app.get("/toy-next", auth, (req, res) => {
  const cmd = queue.shift() || { type: "hello" };
  res.json(cmd);
});

// --- Health check ---
app.get("/", (req, res) => {
  res.json({ ok: true, name: "svakom-ble-bridge", queue: queue.length });
});

app.listen(PORT, () => {
  console.log(`bridge server running on port ${PORT}`);
});
