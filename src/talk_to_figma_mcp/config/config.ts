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
- \`get_library_components\` to discover ALL components from team libraries (not just those already used)
- \`get_node_info(mode='summary')\` over \`get_node_info()\` unless you need fills/strokes/styles
- \`preflight_component_check\` before ANY component placement — discovers property keys, text slots, variant axes
- \`build_screen_from_template\` for scaffolding screens with component instances
- \`create_instance_with_properties\` over create + configure separately
- \`bulk_create_nodes\` / \`bulk_update_text\` over individual calls
- \`find_nodes_all_channels\` over per-channel \`find_nodes\` when searching across files

## Component Workflow (MANDATORY for design system work)
1. **Discover**: \`get_library_components\` (full team catalog) or \`get_all_components\` (in-doc only)
2. **Inspect**: \`preflight_component_check\` with all component keys you plan to use — returns property keys, text slot names, and variant axes
3. **Build**: \`build_screen_from_template\` with exact property keys and text node names from step 2
4. **Manual text**: when using \`create_text\`, always specify \`fontFamily\`/\`fontStyle\` matching the design system — never rely on the default font
5. NEVER guess property key formats — they differ between components (e.g., \`Label#72:8\` vs \`Label#73:17\`)

## Colors & Coordinates
RGBA values 0–1 (not 0–255). Coordinates are local to parent.

## Prompts Available
Load \`figma_guide\`, \`design_strategy\`, \`text_replacement_strategy\`, or \`tool_reference\` for in-depth guidance on specific workflows.`;