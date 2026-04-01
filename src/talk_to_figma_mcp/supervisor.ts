#!/usr/bin/env node

/**
 * Supervisor wrapper for the Figma MCP Server.
 * Spawns the actual server as a child process, proxies stdio,
 * and watches dist/ for rebuilds — restarting the server automatically.
 *
 * Usage: node dist/talk_to_figma_mcp/supervisor.cjs [--server=...] [--port=...] [--watch]
 *
 * The --watch flag enables file watching (default: enabled).
 * Use --no-watch to disable.
 */

import { spawn, ChildProcess } from "child_process";
import { watch, FSWatcher } from "fs";
import { resolve, dirname } from "path";

const args = process.argv.slice(2);
const noWatch = args.includes("--no-watch");
const serverArgs = args.filter(a => a !== "--watch" && a !== "--no-watch");

// Resolve paths relative to this file's location in dist/
const distDir = dirname(resolve(process.argv[1]));
// Detect CJS vs ESM output to spawn the right server file
const isCjs = process.argv[1].endsWith(".cjs");
const serverScript = resolve(distDir, isCjs ? "server.cjs" : "server.js");
const watchDir = distDir;

let child: ChildProcess | null = null;
let watcher: FSWatcher | null = null;
let restarting = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

function log(msg: string) {
  process.stderr.write(`[supervisor] ${msg}\n`);
}

function startServer() {
  log(`Starting MCP server: ${serverScript}`);
  child = spawn("node", [serverScript, ...serverArgs], {
    stdio: ["pipe", "pipe", "inherit"], // stdin/stdout piped, stderr inherited
  });

  // Proxy stdin from parent to child
  process.stdin.pipe(child.stdin!);

  // Proxy stdout from child to parent
  child.stdout!.pipe(process.stdout);

  child.on("exit", (code, signal) => {
    if (restarting) {
      // Expected restart — respawn
      restarting = false;
      startServer();
    } else {
      log(`Server exited (code=${code}, signal=${signal})`);
      cleanup();
      process.exit(code ?? 1);
    }
  });

  child.on("error", (err) => {
    log(`Server process error: ${err.message}`);
  });
}

function restartServer() {
  if (restartTimer) return; // Already scheduled

  // Debounce — builds write multiple files
  restartTimer = setTimeout(() => {
    restartTimer = null;
    log("Build output changed — restarting server...");
    restarting = true;

    // Unpipe before killing so we can re-pipe to the new child
    if (child) {
      process.stdin.unpipe(child.stdin!);
      child.stdout!.unpipe(process.stdout);
      child.kill("SIGTERM");
    } else {
      restarting = false;
      startServer();
    }
  }, 500);
}

function startWatcher() {
  log(`Watching ${watchDir} for changes...`);
  // Watch the parent dist/ directory (not just our subdirectory)
  const parentDistDir = resolve(watchDir, "..");
  watcher = watch(parentDistDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // Only react to server .js/.cjs changes, ignore supervisor's own files and sourcemaps
    if (filename.includes("supervisor")) return;
    if (filename.endsWith(".map")) return;
    if (filename.endsWith(".js") || filename.endsWith(".cjs")) {
      log(`Detected change: ${filename}`);
      restartServer();
    }
  });

  watcher.on("error", (err) => {
    // Watcher may error if dist/ is cleaned during rebuild — just log and continue
    log(`Watcher error (will recover on next build): ${err.message}`);
  });
}

function cleanup() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

// Graceful shutdown
process.on("SIGTERM", () => {
  log("SIGTERM received — shutting down");
  cleanup();
  if (child) child.kill("SIGTERM");
  else process.exit(0);
});

process.on("SIGINT", () => {
  log("SIGINT received — shutting down");
  cleanup();
  if (child) child.kill("SIGINT");
  else process.exit(0);
});

// Start
startServer();
if (!noWatch) {
  startWatcher();
}
