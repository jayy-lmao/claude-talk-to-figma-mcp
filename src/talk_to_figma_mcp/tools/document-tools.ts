import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma, joinChannel, getCurrentChannel, getJoinedChannels, setActiveChannel, leaveChannel } from "../utils/websocket.js";
import { filterFigmaNode } from "../utils/figma-helpers.js";
import { defaultPort } from "../config/config.js";

/**
 * Register document-related tools to the MCP server
 * @param server - The MCP server instance
 */
export function registerDocumentTools(server: McpServer): void {
  // Document Info Tool
  server.tool(
    "get_document_info",
    "Get detailed information about the current Figma document",
    {
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ channel }) => {
      try {
        const result = await sendCommandToFigma("get_document_info", {}, { channel });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting document info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Selection Tool
  server.tool(
    "get_selection",
    "Get information about the current selection in Figma",
    {
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ channel }) => {
      try {
        const result = await sendCommandToFigma("get_selection", {}, { channel });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting selection: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Node Info Tool
  server.tool(
    "get_node_info",
    "Get detailed information about a specific node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to get information about"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ nodeId, channel }) => {
      try {
        const result = await sendCommandToFigma("get_node_info", { nodeId }, { channel });
        const filtered = filterFigmaNode(result);
        const coordinateNote = filtered.absoluteBoundingBox && filtered.localPosition
          ? "absoluteBoundingBox contains global coordinates (relative to canvas). localPosition contains local coordinates (relative to parent, use these for move_node)."
          : undefined;

        const payload = coordinateNote ? { ...filtered, _note: coordinateNote } : filtered;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting node info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Nodes Info Tool
  server.tool(
    "get_nodes_info",
    "Get detailed information about multiple nodes in Figma",
    {
      nodeIds: z.array(z.string()).describe("Array of node IDs to get information about"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ nodeIds, channel }) => {
      try {
        const results = await sendCommandToFigma('get_nodes_info', { nodeIds }, { channel }) as any[];
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results.map((result) => filterFigmaNode(result.document || result.info)))
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting nodes info: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Get Styles Tool
  server.tool(
    "get_styles",
    "Get all styles from the current Figma document",
    {
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ channel }) => {
      try {
        const result = await sendCommandToFigma("get_styles", {}, { channel });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting styles: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Local Components Tool
  server.tool(
    "get_local_components",
    "Get all local components from the Figma document",
    {
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ channel }) => {
      try {
        const result = await sendCommandToFigma("get_local_components", {}, { channel });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting local components: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Remote Components Tool
  server.tool(
    "get_remote_components",
    "Get remote library components currently used in the Figma document. Optionally filter by libraryName (exact match) or nameFilter (case-insensitive substring match on component name). Set allPages=true to scan all pages instead of just the current page.",
    {
      libraryName: z.string().optional().describe("Return only components from this library (exact name match)"),
      nameFilter: z.string().optional().describe("Case-insensitive substring to filter component names (e.g. 'Button' returns all button variants)"),
      allPages: z.boolean().optional().default(false).describe("When true, scan all pages in the document instead of just the current page"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ libraryName, nameFilter, allPages, channel }) => {
      try {
        const result = await sendCommandToFigma("get_remote_components", { libraryName, nameFilter, allPages }, { channel });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting remote components: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Get Available Libraries Tool
  server.tool(
    "get_available_libraries",
    "Get team libraries available in the Figma document, including their variable collections.",
    {
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ channel }) => {
      try {
        const result = await sendCommandToFigma("get_available_libraries", {}, { channel });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting available libraries: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Text Node Scanning Tool
  server.tool(
    "scan_text_nodes",
    "Scan all text nodes in the selected Figma node",
    {
      nodeId: z.string().describe("ID of the node to scan"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ nodeId, channel }) => {
      try {
        // Initial response to indicate we're starting the process
        const initialStatus = {
          type: "text" as const,
          text: "Starting text node scanning. This may take a moment for large designs...",
        };

        // Use the plugin's scan_text_nodes function with chunking flag
        const result = await sendCommandToFigma("scan_text_nodes", {
          nodeId,
          useChunking: true,  // Enable chunking on the plugin side
          chunkSize: 10       // Process 10 nodes at a time
        }, { channel });

        // If the result indicates chunking was used, format the response accordingly
        if (result && typeof result === 'object' && 'chunks' in result) {
          const typedResult = result as {
            success: boolean,
            totalNodes: number,
            processedNodes: number,
            chunks: number,
            textNodes: Array<any>
          };

          const summaryText = `
          Scan completed:
          - Found ${typedResult.totalNodes} text nodes
          - Processed in ${typedResult.chunks} chunks
          `;

          return {
            content: [
              initialStatus,
              {
                type: "text" as const,
                text: summaryText
              },
              {
                type: "text" as const,
                text: JSON.stringify(typedResult.textNodes, null, 2)
              }
            ],
          };
        }

        // If chunking wasn't used or wasn't reported in the result format, return the result as is
        return {
          content: [
            initialStatus,
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error scanning text nodes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Join Channel Tool
  server.tool(
    "join_channel",
    "Join a specific channel to communicate with Figma",
    {
      channel: z.string().describe("The name of the channel to join"),
    },
    async ({ channel }) => {
      try {
        if (!channel) {
          // If no channel provided, ask the user for input
          return {
            content: [
              {
                type: "text",
                text: "Please provide a channel name to join:",
              },
            ],
            followUp: {
              tool: "join_channel",
              description: "Join the specified channel",
            },
          };
        }

        await joinChannel(channel);
        const joined = [...getJoinedChannels()];

        return {
          content: [
            {
              type: "text",
              text: `Successfully joined channel: ${channel} (now active). Joined channels: ${joined.join(', ')}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error joining channel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // List Sessions Tool
  server.tool(
    "list_sessions",
    "List active Figma plugin sessions available for connection. Returns channel IDs, document names, and page names.",
    {},
    async () => {
      try {
        const response = await fetch(`http://localhost:${defaultPort}/sessions`);
        const sessions = await response.json();
        if (!Array.isArray(sessions) || sessions.length === 0) {
          return {
            content: [{ type: "text", text: "No active Figma sessions found. Please open a Figma file and run the Claude MCP plugin." }],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error listing sessions: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );

  // Auto Join Session Tool
  server.tool(
    "auto_join_session",
    "Automatically connect to a Figma session. If one session is active, joins it directly. If multiple, returns the list for selection.",
    {},
    async () => {
      try {
        const response = await fetch(`http://localhost:${defaultPort}/sessions`);
        const sessions = await response.json();

        if (!Array.isArray(sessions) || sessions.length === 0) {
          return {
            content: [{ type: "text", text: "No active Figma sessions found. Please open a Figma file and run the Claude MCP plugin." }],
          };
        }

        if (sessions.length === 1) {
          await joinChannel(sessions[0].channel);
          return {
            content: [{ type: "text", text: `Auto-joined session: "${sessions[0].documentName}" on page "${sessions[0].pageName}" (channel: ${sessions[0].channel})` }],
          };
        }

        return {
          content: [{ type: "text", text: `Multiple sessions found. Use join_channel with one of:\n${JSON.stringify(sessions, null, 2)}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error auto-joining session: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );

  // Set Active Channel Tool
  server.tool(
    "set_active_channel",
    "Switch the active channel for sending commands. The channel must already be joined via join_channel.",
    {
      channel: z.string().describe("The channel to set as active"),
    },
    async ({ channel }) => {
      try {
        setActiveChannel(channel);
        return {
          content: [{ type: "text", text: `Active channel set to "${channel}"` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );

  // List Channels Tool
  server.tool(
    "list_channels",
    "List all currently joined channels and which one is active",
    {},
    async () => {
      const joined = [...getJoinedChannels()];
      const active = getCurrentChannel();
      return {
        content: [{ type: "text", text: JSON.stringify({ activeChannel: active, joinedChannels: joined }, null, 2) }],
      };
    }
  );

  // Leave Channel Tool
  server.tool(
    "leave_channel",
    "Leave a previously joined channel. If leaving the active channel, another joined channel becomes active.",
    {
      channel: z.string().describe("The channel to leave"),
    },
    async ({ channel }) => {
      leaveChannel(channel);
      const active = getCurrentChannel();
      return {
        content: [{ type: "text", text: `Left channel "${channel}". Active channel: ${active ?? 'none'}` }],
      };
    }
  );

  // Get Connection Status Tool
  server.tool(
    "get_connection_status",
    "Check the current WebSocket connection status and active Figma channel. Use this before sending commands to verify the connection is ready.",
    {},
    async () => {
      const activeChannel = getCurrentChannel();
      const joinedChannels = [...getJoinedChannels()];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              connected: activeChannel !== null,
              activeChannel,
              joinedChannels,
            }),
          },
        ],
      };
    }
  );

  // Export Node as Image Tool
  server.tool(
    "export_node_as_image",
    "Export a node as an image from Figma",
    {
      nodeId: z.string().describe("The ID of the node to export"),
      format: z
        .enum(["PNG", "JPG", "SVG", "PDF"])
        .optional()
        .describe("Export format"),
      scale: z.number().positive().optional().describe("Export scale"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ nodeId, format, scale, channel }) => {
      try {
        const result = await sendCommandToFigma("export_node_as_image", {
          nodeId,
          format: format || "PNG",
          scale: scale || 1,
        }, { timeoutMs: 120000, channel }); // 120 second timeout for image export
        const typedResult = result as { imageData: string; mimeType: string };

        return {
          content: [
            {
              type: "image",
              data: typedResult.imageData,
              mimeType: typedResult.mimeType || "image/png",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error exporting node as image: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Create Page Tool
  server.tool(
    "create_page",
    "Create a new page in the current Figma document",
    {
      name: z.string().describe("Name for the new page"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ name, channel }) => {
      try {
        const result = await sendCommandToFigma("create_page", { name }, { channel });
        const typedResult = result as { id: string; name: string };
        return {
          content: [
            {
              type: "text",
              text: `Created page "${typedResult.name}" with ID: ${typedResult.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Create Slide Tool (Figma Slides only)
  server.tool(
    "create_slide",
    "Create a new slide in a Figma Slides document. Returns the slide ID and its contents/backgrounds layer IDs for adding child elements.",
    {
      name: z.string().optional().describe("Optional name for the slide"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ name, channel }) => {
      try {
        const result = await sendCommandToFigma("create_slide", { name }, { channel });
        const typedResult = result as {
          id: string;
          name: string;
          type: string;
          contentsId: string | null;
          backgroundsId: string | null;
          width: number;
          height: number;
        };
        return {
          content: [
            {
              type: "text",
              text: `Created slide "${typedResult.name}" with ID: ${typedResult.id}. Contents layer ID: ${typedResult.contentsId}. Backgrounds layer ID: ${typedResult.backgroundsId}. Size: ${typedResult.width}x${typedResult.height}. Use contentsId as parentId to add text and shapes to this slide.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating slide: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Delete Page Tool
  server.tool(
    "delete_page",
    "Delete a page from the current Figma document",
    {
      pageId: z.string().describe("ID of the page to delete"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ pageId, channel }) => {
      try {
        const result = await sendCommandToFigma("delete_page", { pageId }, { channel });
        const typedResult = result as { success: boolean; name: string };
        return {
          content: [
            {
              type: "text",
              text: `Deleted page "${typedResult.name}" successfully`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Rename Page Tool
  server.tool(
    "rename_page",
    "Rename an existing page in the Figma document",
    {
      pageId: z.string().describe("ID of the page to rename"),
      name: z.string().describe("New name for the page"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ pageId, name, channel }) => {
      try {
        const result = await sendCommandToFigma("rename_page", { pageId, name }, { channel });
        const typedResult = result as { id: string; name: string; oldName: string };
        return {
          content: [
            {
              type: "text",
              text: `Renamed page from "${typedResult.oldName}" to "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get Pages Tool
  server.tool(
    "get_pages",
    "Get all pages in the current Figma document",
    {
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ channel }) => {
      try {
        const result = await sendCommandToFigma("get_pages", {}, { channel });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting pages: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Set Current Page Tool
  server.tool(
    "set_current_page",
    "Switch to a specific page in the Figma document",
    {
      pageId: z.string().describe("ID of the page to switch to"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ pageId, channel }) => {
      try {
        const result = await sendCommandToFigma("set_current_page", { pageId }, { channel });
        const typedResult = result as { id: string; name: string };
        return {
          content: [
            {
              type: "text",
              text: `Switched to page "${typedResult.name}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error switching page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Duplicate Page Tool
  server.tool(
    "duplicate_page",
    "Duplicate an existing page in the Figma document, creating a complete copy of all its contents",
    {
      pageId: z.string().describe("ID of the page to duplicate"),
      name: z.string().optional().describe("Optional name for the duplicated page (defaults to 'Original Name (Copy)')"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ pageId, name, channel }) => {
      try {
        const result = await sendCommandToFigma("duplicate_page", { pageId, name }, { channel });
        const typedResult = result as { id: string; name: string; originalName: string };
        return {
          content: [
            {
              type: "text",
              text: `Duplicated page "${typedResult.originalName}" → "${typedResult.name}" with ID: ${typedResult.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error duplicating page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}