#!/usr/bin/env node

/**
 * Standalone WebSocket server for Claude-to-Figma communication.
 *
 * This process is spawned detached by the first MCP session that needs it.
 * It survives parent process exit and auto-shuts down after a grace period
 * once all WebSocket clients have disconnected.
 *
 * Usage: node standalone-server.cjs [--port=3055] [--idle-timeout=30000]
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";

// --- CLI args ---
const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const idleArg = args.find((a) => a.startsWith("--idle-timeout="));
const PORT = portArg ? parseInt(portArg.split("=")[1], 10) : 3055;
const IDLE_TIMEOUT = idleArg ? parseInt(idleArg.split("=")[1], 10) : 30_000;

// --- Logging (stderr so it doesn't interfere if stdio is inherited) ---
const log = {
  info: (msg: string) => process.stderr.write(`[standalone-ws] [INFO] ${msg}\n`),
  error: (msg: string) => process.stderr.write(`[standalone-ws] [ERROR] ${msg}\n`),
};

// --- Channel management ---
const channels = new Map<string, Set<WebSocket>>();

interface ClientMeta {
  clientId: string;
}
const clientMeta = new WeakMap<WebSocket, ClientMeta>();

interface FigmaSession {
  channel: string;
  documentName: string;
  pageName: string;
  registeredAt: number;
  lastHeartbeat: number;
  clientId: string;
}
const sessions = new Map<string, FigmaSession>();

// Clean up stale sessions every 60s
setInterval(() => {
  const now = Date.now();
  sessions.forEach((session, channel) => {
    if (now - session.lastHeartbeat > 120_000) {
      log.info(`Removing stale session for channel ${channel}`);
      sessions.delete(channel);
    }
  });
}, 60_000).unref();

const stats = {
  totalConnections: 0,
  activeConnections: 0,
  messagesSent: 0,
  messagesReceived: 0,
  errors: 0,
};

// --- Idle shutdown ---
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function startIdleTimer() {
  resetIdleTimer();
  idleTimer = setTimeout(() => {
    log.info(`No connections for ${IDLE_TIMEOUT / 1000}s — shutting down`);
    process.exit(0);
  }, IDLE_TIMEOUT);
  idleTimer.unref(); // don't keep process alive just for this timer
}

function checkIdle() {
  if (stats.activeConnections === 0) {
    startIdleTimer();
  } else {
    resetIdleTimer();
  }
}

// Start idle timer immediately — if nobody connects within the grace period, exit
startIdleTimer();

// --- Helpers ---
function safeSend(ws: WebSocket, data: string): boolean {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      stats.messagesSent++;
      return true;
    }
  } catch {
    stats.errors++;
  }
  return false;
}

function getClientId(ws: WebSocket): string {
  return clientMeta.get(ws)?.clientId ?? "unknown";
}

// --- Connection handler ---
function handleConnection(ws: WebSocket) {
  stats.totalConnections++;
  stats.activeConnections++;
  resetIdleTimer();

  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  clientMeta.set(ws, { clientId });

  log.info(`Client connected: ${clientId} (active: ${stats.activeConnections})`);

  safeSend(ws, JSON.stringify({
    type: "system",
    message: "Please join a channel to start communicating with Figma",
  }));

  ws.on("message", (raw: any) => {
    try {
      stats.messagesReceived++;
      const data = JSON.parse(raw.toString());
      const cid = getClientId(ws);

      if (data.type === "join") {
        const channelName = data.channel;
        if (!channelName || typeof channelName !== "string") {
          safeSend(ws, JSON.stringify({ type: "error", message: "Channel name is required" }));
          return;
        }
        if (!channels.has(channelName)) channels.set(channelName, new Set());
        const channelClients = channels.get(channelName)!;
        channelClients.add(ws);
        log.info(`Client ${cid} joined channel: ${channelName}`);
        safeSend(ws, JSON.stringify({ type: "system", message: `Joined channel: ${channelName}`, channel: channelName }));
        safeSend(ws, JSON.stringify({ type: "system", message: { id: data.id, result: "Connected to channel: " + channelName }, channel: channelName }));
        channelClients.forEach((client) => {
          if (client !== ws) safeSend(client, JSON.stringify({ type: "system", message: "A new client has joined the channel", channel: channelName }));
        });
        return;
      }

      if (data.type === "register") {
        const channelName = data.channel;
        const metadata = data.metadata || {};
        if (channelName && typeof channelName === "string") {
          const now = Date.now();
          sessions.set(channelName, {
            channel: channelName,
            documentName: metadata.documentName || "Unknown",
            pageName: metadata.pageName || "Unknown",
            registeredAt: sessions.get(channelName)?.registeredAt || now,
            lastHeartbeat: now,
            clientId: cid,
          });
        }
        return;
      }

      if (data.type === "heartbeat") {
        const channelName = data.channel;
        if (channelName && sessions.has(channelName)) {
          sessions.get(channelName)!.lastHeartbeat = Date.now();
        }
        return;
      }

      if (data.type === "message") {
        const channelName = data.channel;
        if (!channelName || typeof channelName !== "string") {
          safeSend(ws, JSON.stringify({ type: "error", message: "Channel name is required" }));
          return;
        }
        const channelClients = channels.get(channelName);
        if (!channelClients || !channelClients.has(ws)) {
          safeSend(ws, JSON.stringify({ type: "error", message: "You must join the channel first" }));
          return;
        }
        channelClients.forEach((client) => {
          safeSend(client, JSON.stringify({
            type: "broadcast",
            message: data.message,
            sender: client === ws ? "You" : "User",
            channel: channelName,
          }));
        });
        return;
      }

      if (data.type === "progress_update") {
        const channelName = data.channel;
        if (!channelName || typeof channelName !== "string") return;
        const channelClients = channels.get(channelName);
        if (!channelClients) return;
        channelClients.forEach((client) => safeSend(client, JSON.stringify(data)));
        return;
      }
    } catch (err) {
      stats.errors++;
      log.error(`Error handling message: ${err instanceof Error ? err.message : String(err)}`);
      safeSend(ws, JSON.stringify({ type: "error", message: "Error processing your message" }));
    }
  });

  ws.on("close", (code: number) => {
    const cid = getClientId(ws);
    stats.activeConnections--;
    log.info(`Client disconnected: ${cid} (active: ${stats.activeConnections})`);

    channels.forEach((clients, channelName) => {
      if (clients.delete(ws)) {
        const session = sessions.get(channelName);
        if (session && session.clientId === cid) {
          sessions.delete(channelName);
        }
        clients.forEach((client) => {
          safeSend(client, JSON.stringify({ type: "system", message: "A client has left the channel", channel: channelName }));
        });
      }
    });

    checkIdle();
  });

  ws.on("error", (err: Error) => {
    stats.errors++;
    log.error(`Socket error for ${getClientId(ws)}: ${err.message}`);
  });
}

// --- HTTP handler ---
function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  if (url.pathname === "/sessions") {
    const sessionList = Array.from(sessions.values()).map((s) => ({
      channel: s.channel,
      documentName: s.documentName,
      pageName: s.pageName,
      registeredAt: s.registeredAt,
      lastHeartbeat: s.lastHeartbeat,
    }));
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(sessionList));
    return;
  }

  if (url.pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ status: "running", standalone: true, uptime: process.uptime(), channels: channels.size, stats }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
  res.end("Claude to Figma WebSocket server running (standalone).");
}

// --- Start server ---
const server = createServer(handleHttpRequest);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    log.info(`Port ${PORT} already in use — another standalone server is running. Exiting.`);
    process.exit(0);
  }
  log.error(`Server error: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, () => {
  const wsServer = new WebSocketServer({ server });
  wsServer.on("connection", handleConnection);
  log.info(`Standalone WebSocket server running on port ${PORT}`);
});
