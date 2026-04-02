import { z } from "zod";

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const serverArg = args.find(arg => arg.startsWith('--server='));
const portArg = args.find(arg => arg.startsWith('--port='));
const reconnectArg = args.find(arg => arg.startsWith('--reconnect-interval='));

// Configuración de conexión extraída de argumentos CLI
export const serverUrl = serverArg ? serverArg.split('=')[1] : 'localhost';
export const defaultPort = portArg ? parseInt(portArg.split('=')[1], 10) : 3055;
export const reconnectInterval = reconnectArg ? parseInt(reconnectArg.split('=')[1], 10) : 2000;

// URL de WebSocket basada en el servidor (WS para localhost, WSS para remoto)
export const WS_URL = serverUrl === 'localhost' ? `ws://${serverUrl}` : `wss://${serverUrl}`;

// Configuración del servidor MCP
export const SERVER_CONFIG = {
  name: "ClaudeTalkToFigmaMCP",
  description: "Claude MCP Plugin for Figma",
  version: "0.4.0",
};

// Server-level instructions — loaded into every LLM conversation automatically.
// Keep concise: this competes for context window space.
export const SERVER_INSTRUCTIONS = `Direct Figma manipulation via WebSocket plugin. Requires the ClaudeTalkToFigma plugin open in Figma Desktop.

## Quick Start
1. \`auto_join_session\` to connect (or \`join_channel\` per file if multiple sessions)
2. For multi-file workflows (reference design + component library + tokens + target), call \`generate_design_brief\` FIRST — it reads all sources in one call with role-based extraction (reference, library, tokens, target)
3. For single-file work, start with \`get_node_tree\` (compact structure) or \`get_all_components(summary=true)\` (component discovery)

## Prefer Compound Tools
- \`generate_design_brief\` over manual per-file reads — when 2+ files are joined, always use this
- \`get_node_tree\` over \`get_node_info\` for understanding structure
- \`get_all_components(summary=true)\` over separate \`get_remote_components\`/\`get_local_components\` for discovery
- \`get_node_info(mode='summary')\` over \`get_node_info()\` unless you need fills/strokes/styles
- \`build_screen_from_template\` for scaffolding screens with component instances
- \`create_instance_with_properties\` over create + configure separately
- \`bulk_create_nodes\` / \`bulk_update_text\` over individual calls
- \`find_nodes_all_channels\` over per-channel \`find_nodes\` when searching across files

## Colors & Coordinates
RGBA values 0–1 (not 0–255). Coordinates are local to parent.

## Prompts Available
Load \`figma_guide\`, \`design_strategy\`, \`text_replacement_strategy\`, or \`tool_reference\` for in-depth guidance on specific workflows.`;