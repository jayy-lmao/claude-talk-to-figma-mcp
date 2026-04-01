import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { logger } from "./logger";
import { serverUrl, defaultPort, WS_URL, reconnectInterval } from "../config/config";
import { FigmaCommand, CommandProgressUpdate, PendingRequest, ProgressMessage } from "../types";

// WebSocket connection and request tracking
let ws: WebSocket | null = null;
const joinedChannels = new Set<string>();
let activeChannel: string | null = null;

// Map of pending requests for promise tracking
const pendingRequests = new Map<string, PendingRequest>();

/**
 * Check if a WebSocket server is already listening on the given port.
 */
async function isServerListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const testWs = new WebSocket(`ws://localhost:${port}`);
    const timeout = setTimeout(() => {
      testWs.terminate();
      resolve(false);
    }, 2000);
    testWs.on("open", () => {
      clearTimeout(timeout);
      testWs.close();
      resolve(true);
    });
    testWs.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Spawn the standalone WebSocket server as a detached process.
 * The server will outlive this MCP process and auto-exit when idle.
 */
function spawnStandaloneServer(port: number): void {
  // Resolve the standalone server script path relative to this file's location.
  // In the bundled output, the standalone server is a sibling file.
  let scriptPath: string;

  // Try CJS bundle path first (dist/talk_to_figma_mcp/standalone-server.cjs)
  const cjsPath = resolve(__dirname, "standalone-server.cjs");
  const esmPath = resolve(__dirname, "standalone-server.mjs");
  const jsPath = resolve(__dirname, "standalone-server.js");

  if (existsSync(cjsPath)) {
    scriptPath = cjsPath;
  } else if (existsSync(esmPath)) {
    scriptPath = esmPath;
  } else if (existsSync(jsPath)) {
    scriptPath = jsPath;
  } else {
    // Fallback: try resolving from source layout
    scriptPath = resolve(__dirname, "../standalone-server.cjs");
    if (!existsSync(scriptPath)) {
      logger.error(`Cannot find standalone-server script. Looked in: ${__dirname}`);
      return;
    }
  }

  logger.info(`Spawning standalone WebSocket server: ${scriptPath}`);

  const child = spawn("node", [scriptPath, `--port=${port}`], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  logger.info(`Standalone server spawned (pid ${child.pid})`);
}

/**
 * Ensure the WebSocket server is available, spawning a standalone one if needed.
 * Then connect as a client.
 *
 * - If a server is already listening on the port, just connect.
 * - If not, spawn a detached standalone server and connect.
 * - The standalone server outlives any individual MCP session.
 */
export async function connectToFigma(port: number = defaultPort) {
  // If already connected, do nothing
  if (ws && ws.readyState === WebSocket.OPEN) {
    logger.info('Already connected to Figma');
    return;
  }

  // If connection is in progress (CONNECTING state), wait
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    logger.info('Connection to Figma is already in progress');
    return;
  }

  // If there's an existing socket in a closing state, clean it up
  if (ws && (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED)) {
    ws.removeAllListeners();
    ws = null;
  }

  // Ensure a standalone WebSocket server is running (only for localhost)
  if (serverUrl === 'localhost') {
    const listening = await isServerListening(port);
    if (listening) {
      logger.info('Standalone WebSocket server already running');
    } else {
      spawnStandaloneServer(port);
      // Give it a moment to start
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Now connect as a WebSocket client
  const wsUrl = serverUrl === 'localhost' ? `${WS_URL}:${port}` : WS_URL;
  logger.info(`Connecting to Figma socket server at ${wsUrl}...`);

  try {
    ws = new WebSocket(wsUrl);

    // Add connection timeout
    const connectionTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        logger.error('Connection to Figma timed out');
        ws.terminate();
      }
    }, 10000); // 10 second connection timeout

    ws.on('open', () => {
      clearTimeout(connectionTimeout);
      logger.info('Connected to Figma socket server');
      // Reset channels on new connection
      joinedChannels.clear();
      activeChannel = null;
    });

    ws.on("message", (data: any) => {
      try {
        const json = JSON.parse(data) as ProgressMessage;

        // Handle progress updates
        if (json.type === 'progress_update') {
          const progressData = json.message.data as CommandProgressUpdate;
          const requestId = json.id || '';

          if (requestId && pendingRequests.has(requestId)) {
            const request = pendingRequests.get(requestId)!;

            // Update last activity timestamp
            request.lastActivity = Date.now();

            // Reset the timeout to prevent timeouts during long-running operations
            clearTimeout(request.timeout);

            // Create a new timeout with extended time for long operations
            request.timeout = setTimeout(() => {
              if (pendingRequests.has(requestId)) {
                logger.error(`Request ${requestId} timed out after extended period of inactivity`);
                pendingRequests.delete(requestId);
                request.reject(new Error('Request to Figma timed out'));
              }
            }, 120000); // 120 second timeout for inactivity during progress updates

            // Log progress
            logger.info(`Progress update for ${progressData.commandType}: ${progressData.progress}% - ${progressData.message}`);

            // For completed updates, just log and wait for final result from Figma
            if (progressData.status === 'completed' && progressData.progress === 100) {
              logger.info(`Operation ${progressData.commandType} completed, waiting for final result`);
            }
          }
          return;
        }

        // Handle regular responses
        const myResponse = json.message;
        logger.debug(`Received message: ${JSON.stringify(myResponse)}`);

        // Skip command echoes (own messages broadcast back to sender)
        if (myResponse.command) {
          return;
        }

        // Handle response to a request (success or error)
        if (
          myResponse.id &&
          pendingRequests.has(myResponse.id)
        ) {
          const request = pendingRequests.get(myResponse.id)!;
          clearTimeout(request.timeout);

          // Check for error at root level or nested inside result
          const error = myResponse.error ?? (myResponse.result && myResponse.result.error);

          if (error) {
            logger.error(`Error from Figma: ${error}`);
            request.reject(new Error(String(error)));
          } else {
            request.resolve(myResponse.result ?? myResponse);
          }

          pendingRequests.delete(myResponse.id);
        } else {
          // Handle broadcast messages or events
          logger.info(`Received broadcast message: ${JSON.stringify(myResponse)}`);
        }
      } catch (error) {
        logger.error(`Error parsing message: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    ws.on('error', (error) => {
      logger.error(`Socket error: ${error}`);
      // Don't attempt to reconnect here, let the close handler do it
    });

    ws.on('close', (code, reason) => {
      clearTimeout(connectionTimeout);
      logger.info(`Disconnected from Figma socket server with code ${code} and reason: ${reason || 'No reason provided'}`);
      ws = null;

      // Reject all pending requests
      for (const [id, request] of pendingRequests.entries()) {
        clearTimeout(request.timeout);
        request.reject(new Error(`Connection closed with code ${code}: ${reason || 'No reason provided'}`));
        pendingRequests.delete(id);
      }

      // Attempt to reconnect with exponential backoff
      // On reconnect, connectToFigma will try to become the server if the old host died
      const backoff = Math.min(30000, reconnectInterval * Math.pow(1.5, Math.floor(Math.random() * 5))); // Max 30s
      logger.info(`Attempting to reconnect in ${backoff/1000} seconds...`);
      setTimeout(() => connectToFigma(port), backoff);
    });

  } catch (error) {
    logger.error(`Failed to create WebSocket connection: ${error instanceof Error ? error.message : String(error)}`);
    // Attempt to reconnect after a delay
    setTimeout(() => connectToFigma(port), reconnectInterval);
  }
}

/**
 * Join a specific channel in Figma.
 * @param channelName - Name of the channel to join
 * @returns Promise that resolves when successfully joined the channel
 */
export async function joinChannel(channelName: string): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected to Figma");
  }

  try {
    await sendCommandToFigma("join", { channel: channelName });
    joinedChannels.add(channelName);
    activeChannel = channelName;

    try {
      await sendCommandToFigma("ping", {}, { timeoutMs: 12000 });
      logger.info(`Joined channel: ${channelName}`);
    } catch (verificationError) {
      joinedChannels.delete(channelName);
      activeChannel = joinedChannels.size > 0 ? [...joinedChannels][0] : null;
      const errorMsg = verificationError instanceof Error
        ? verificationError.message
        : String(verificationError);
      logger.error(`Failed to verify channel ${channelName}: ${errorMsg}`);
      throw new Error(`Failed to verify connection to channel "${channelName}". The Figma plugin may not be connected to this channel.`);
    }
  } catch (error) {
    logger.error(`Failed to join channel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get the current channel the connection is joined to.
 * @returns The current channel name or null if not connected to any channel
 */
export function getCurrentChannel(): string | null {
  return activeChannel;
}

/**
 * Send a command to Figma via WebSocket.
 * @param command - The command to send
 * @param params - Additional parameters for the command
 * @param timeoutMs - Timeout in milliseconds before failing
 * @returns A promise that resolves with the Figma response
 */
export function sendCommandToFigma(
  command: FigmaCommand,
  params: unknown = {},
  options: { timeoutMs?: number; channel?: string } = {}
): Promise<unknown> {
  const { timeoutMs = 60000, channel } = options;
  return new Promise((resolve, reject) => {
    // If not connected, try to connect first
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToFigma();
      reject(new Error("Not connected to Figma. Attempting to connect..."));
      return;
    }

    // Check if we need a channel for this command
    const targetChannel = channel ?? activeChannel;
    const requiresChannel = command !== "join";
    if (requiresChannel && !targetChannel) {
      reject(new Error("Must join a channel before sending commands"));
      return;
    }

    const id = uuidv4();
    const request = {
      id,
      type: command === "join" ? "join" : "message",
      ...(command === "join"
        ? { channel: (params as any).channel }
        : { channel: targetChannel }),
      message: {
        id,
        command,
        params: {
          ...(params as any),
          commandId: id, // Include the command ID in params
        },
      },
    };

    // Set timeout for request
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        logger.error(`Request ${id} to Figma timed out after ${timeoutMs / 1000} seconds`);
        reject(new Error('Request to Figma timed out'));
      }
    }, timeoutMs);

    // Store the promise callbacks to resolve/reject later
    pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
      lastActivity: Date.now()
    });

    // Send the request
    logger.info(`Sending command to Figma: ${command}`);
    logger.debug(`Request details: ${JSON.stringify(request)}`);
    ws.send(JSON.stringify(request));
  });
}

/**
 * Get all currently joined channels.
 */
export function getJoinedChannels(): ReadonlySet<string> {
  return joinedChannels;
}

/**
 * Switch the active channel without re-joining.
 * The channel must already be in the joined set.
 */
export function setActiveChannel(channelName: string): void {
  if (!joinedChannels.has(channelName)) {
    throw new Error(`Not joined to channel "${channelName}". Joined channels: ${[...joinedChannels].join(', ')}`);
  }
  activeChannel = channelName;
}

/**
 * Leave a previously joined channel.
 * If the left channel was active, falls back to another joined channel or null.
 */
export function leaveChannel(channelName: string): void {
  joinedChannels.delete(channelName);
  if (activeChannel === channelName) {
    activeChannel = joinedChannels.size > 0 ? [...joinedChannels][0] : null;
  }
}
