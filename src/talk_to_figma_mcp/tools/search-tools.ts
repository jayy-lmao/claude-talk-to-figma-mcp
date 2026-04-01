import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma, getJoinedChannels } from "../utils/websocket.js";

/**
 * Register search tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerSearchTools(server: McpServer): void {
  const filterParams = {
    scope: z
      .enum(["currentPage", "allPages"])
      .default("currentPage")
      .describe("Search current page only or all pages in the document"),
    nodeTypes: z
      .array(z.string())
      .optional()
      .describe('Filter by Figma node types, e.g. ["FRAME", "TEXT", "INSTANCE", "COMPONENT"]'),
    name: z.string().optional().describe("Substring match on node name (case-insensitive)"),
    nameRegex: z.string().optional().describe("Regex match on node name (case-insensitive)"),
    textContent: z
      .string()
      .optional()
      .describe("Substring match on TEXT node characters (case-insensitive)"),
    componentName: z
      .string()
      .optional()
      .describe("Match INSTANCE nodes by main component name (case-insensitive)"),
    hasAnnotations: z.boolean().optional().describe("Find nodes that have annotations"),
    annotationLabel: z
      .string()
      .optional()
      .describe("Substring match on annotation label text (case-insensitive)"),
    limit: z.number().default(100).describe("Max results to return"),
    offset: z.number().default(0).describe("Skip first N results (for pagination)"),
  };

  // find_nodes — single channel search
  server.tool(
    "find_nodes",
    "Search for nodes in a Figma document by name, text content, component type, annotations, or node type. Supports pagination and current-page or all-pages scope.",
    {
      ...filterParams,
      channel: z
        .string()
        .optional()
        .describe("Target channel (uses active channel if omitted)"),
    },
    async ({ scope, nodeTypes, name, nameRegex, textContent, componentName, hasAnnotations, annotationLabel, limit, offset, channel }) => {
      try {
        const filters: Record<string, unknown> = {};
        if (nodeTypes) filters.nodeTypes = nodeTypes;
        if (name) filters.name = name;
        if (nameRegex) filters.nameRegex = nameRegex;
        if (textContent) filters.textContent = textContent;
        if (componentName) filters.componentName = componentName;
        if (hasAnnotations !== undefined) filters.hasAnnotations = hasAnnotations;
        if (annotationLabel) filters.annotationLabel = annotationLabel;

        const result = await sendCommandToFigma(
          "find_nodes",
          { scope, filters, limit, offset },
          { channel }
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error searching nodes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // find_nodes_all_channels — broadcast search across all joined channels
  server.tool(
    "find_nodes_all_channels",
    "Search for nodes across ALL joined Figma channels (files). Same filters as find_nodes but broadcasts to every active channel and aggregates results.",
    filterParams,
    async ({ scope, nodeTypes, name, nameRegex, textContent, componentName, hasAnnotations, annotationLabel, limit, offset }) => {
      try {
        const channels = getJoinedChannels();
        if (channels.size === 0) {
          return {
            content: [{ type: "text", text: "No channels joined. Join a channel first." }],
          };
        }

        const filters: Record<string, unknown> = {};
        if (nodeTypes) filters.nodeTypes = nodeTypes;
        if (name) filters.name = name;
        if (nameRegex) filters.nameRegex = nameRegex;
        if (textContent) filters.textContent = textContent;
        if (componentName) filters.componentName = componentName;
        if (hasAnnotations !== undefined) filters.hasAnnotations = hasAnnotations;
        if (annotationLabel) filters.annotationLabel = annotationLabel;

        const results: Record<string, unknown> = {};
        const promises = [...channels].map(async (ch) => {
          try {
            const result = await sendCommandToFigma(
              "find_nodes",
              { scope, filters, limit, offset },
              { channel: ch }
            );
            results[ch] = result;
          } catch (error) {
            results[ch] = {
              error: error instanceof Error ? error.message : String(error),
            };
          }
        });

        await Promise.all(promises);

        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error searching across channels: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
