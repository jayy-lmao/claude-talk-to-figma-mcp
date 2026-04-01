import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma, getJoinedChannels } from "../utils/websocket";
import { applyColorDefaults, applyDefault, FIGMA_DEFAULTS } from "../utils/defaults";
import { filterFigmaNodeSummary } from "../utils/figma-helpers";

/**
 * Recursively build a compact hierarchical tree from a Figma node.
 * Each level fetches node info and expands children up to maxDepth.
 * Returns structural properties only (no fills, strokes, styles).
 */
export async function buildNodeTree(
  nodeId: string,
  maxDepth: number,
  channel?: string,
  currentDepth: number = 0
): Promise<any> {
  const result = await sendCommandToFigma("get_node_info", { nodeId }, { channel });
  const node = filterFigmaNodeSummary(result);

  if (!node) return null;

  // If children exist and we haven't hit max depth, expand them
  if (node.children && node.children.length > 0 && currentDepth < maxDepth) {
    const expandedChildren: any[] = [];
    for (const child of node.children) {
      try {
        const childTree = await buildNodeTree(child.id, maxDepth, channel, currentDepth + 1);
        if (childTree) expandedChildren.push(childTree);
      } catch (error) {
        expandedChildren.push({
          id: child.id,
          name: child.name,
          type: child.type,
          _error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    node.children = expandedChildren;
  }
  // If at max depth but children exist, leave shallow refs as-is (signals more depth available)

  return node;
}

/**
 * Register compound tools to the MCP server.
 * Compound tools combine multiple logical steps into a single operation to
 * reduce round-trips and speed up iteration cycles.
 * @param server - The MCP server instance
 */
export function registerCompoundTools(server: McpServer): void {
  // ── Create Frame with Auto-Layout ────────────────────────────────────────
  // Combines create_frame + set_auto_layout into a single call.
  server.tool(
    "create_frame_with_autolayout",
    "Create a new frame in Figma and immediately configure its auto-layout settings in a single operation. Combines create_frame and set_auto_layout.",
    {
      // Frame creation params
      x: z.number().describe("X position (local coordinates, relative to parent)"),
      y: z.number().describe("Y position (local coordinates, relative to parent)"),
      width: z.number().describe("Width of the frame"),
      height: z.number().describe("Height of the frame"),
      name: z.string().optional().describe("Optional name for the frame"),
      parentId: z.string().optional().describe("Optional parent node ID to append the frame to"),
      fillColor: z
        .object({
          r: z.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Fill color in RGBA format"),
      strokeColor: z
        .object({
          r: z.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Stroke color in RGBA format"),
      strokeWeight: z.number().positive().optional().describe("Stroke weight"),
      // Auto-layout params
      layoutMode: z
        .enum(["HORIZONTAL", "VERTICAL", "NONE"])
        .describe("Auto-layout direction"),
      paddingTop: z.number().optional().describe("Top padding in pixels"),
      paddingBottom: z.number().optional().describe("Bottom padding in pixels"),
      paddingLeft: z.number().optional().describe("Left padding in pixels"),
      paddingRight: z.number().optional().describe("Right padding in pixels"),
      itemSpacing: z.number().optional().describe("Spacing between items in pixels"),
      primaryAxisAlignItems: z
        .enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"])
        .optional()
        .describe("Alignment along the primary axis"),
      counterAxisAlignItems: z
        .enum(["MIN", "CENTER", "MAX"])
        .optional()
        .describe("Alignment along the counter axis"),
      layoutWrap: z
        .enum(["WRAP", "NO_WRAP"])
        .optional()
        .describe("Whether items wrap to new lines"),
      strokesIncludedInLayout: z
        .boolean()
        .optional()
        .describe("Whether strokes are included in layout calculations"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ x, y, width, height, name, parentId, fillColor, strokeColor, strokeWeight,
      layoutMode, paddingTop, paddingBottom, paddingLeft, paddingRight,
      itemSpacing, primaryAxisAlignItems, counterAxisAlignItems, layoutWrap,
      strokesIncludedInLayout, channel }) => {
      try {
        // Step 1: create the frame
        const frameResult = await sendCommandToFigma("create_frame", {
          x,
          y,
          width,
          height,
          name: name || "Frame",
          parentId,
          fillColor: fillColor || { r: 1, g: 1, b: 1, a: 1 },
          strokeColor,
          strokeWeight,
        }, { channel });
        const typedFrame = frameResult as { name: string; id: string };

        // Step 2: apply auto-layout
        await sendCommandToFigma("set_auto_layout", {
          nodeId: typedFrame.id,
          layoutMode,
          paddingTop,
          paddingBottom,
          paddingLeft,
          paddingRight,
          itemSpacing,
          primaryAxisAlignItems,
          counterAxisAlignItems,
          layoutWrap,
          strokesIncludedInLayout,
        }, { channel });

        return {
          content: [
            {
              type: "text",
              text: `Created auto-layout frame "${typedFrame.name}" with ID: ${typedFrame.id} (layoutMode: ${layoutMode}). Use the ID as parentId to append children.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating frame with auto-layout: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Set Node Appearance ──────────────────────────────────────────────────
  // Combines set_fill_color + set_stroke_color + set_corner_radius +
  // set_node_properties (opacity) into one call.
  server.tool(
    "set_node_appearance",
    "Set multiple visual properties of a node in a single operation. Combines set_fill_color, set_stroke_color, set_corner_radius, and opacity changes. Only the properties you provide are applied.",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      fillColor: z
        .object({
          r: z.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Fill color in RGBA format"),
      strokeColor: z
        .object({
          r: z.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Stroke color in RGBA format"),
      strokeWeight: z.number().min(0).optional().describe("Stroke weight"),
      cornerRadius: z.number().min(0).optional().describe("Corner radius in pixels"),
      opacity: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Node opacity (0 = fully transparent, 1 = fully opaque)"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ nodeId, fillColor, strokeColor, strokeWeight, cornerRadius, opacity, channel }) => {
      const applied: string[] = [];
      try {
        if (fillColor !== undefined) {
          const colorWithDefaults = applyColorDefaults(fillColor);
          await sendCommandToFigma("set_fill_color", {
            nodeId,
            color: colorWithDefaults,
          }, { channel });
          applied.push(
            `fill RGBA(${fillColor.r}, ${fillColor.g}, ${fillColor.b}, ${colorWithDefaults.a})`
          );
        }

        if (strokeColor !== undefined) {
          const colorWithDefaults = applyColorDefaults(strokeColor);
          const weight = applyDefault(strokeWeight, FIGMA_DEFAULTS.stroke.weight);
          await sendCommandToFigma("set_stroke_color", {
            nodeId,
            color: colorWithDefaults,
            strokeWeight: weight,
          }, { channel });
          applied.push(
            `stroke RGBA(${strokeColor.r}, ${strokeColor.g}, ${strokeColor.b}, ${colorWithDefaults.a}) weight=${weight}`
          );
        }

        if (cornerRadius !== undefined) {
          await sendCommandToFigma("set_corner_radius", {
            nodeId,
            radius: cornerRadius,
            corners: [true, true, true, true],
          }, { channel });
          applied.push(`cornerRadius=${cornerRadius}`);
        }

        if (opacity !== undefined) {
          await sendCommandToFigma("set_node_properties", {
            nodeId,
            opacity,
          }, { channel });
          applied.push(`opacity=${opacity}`);
        }

        if (applied.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No appearance properties were provided. Please specify at least one of: fillColor, strokeColor, cornerRadius, opacity.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Updated appearance of node ${nodeId}: ${applied.join(", ")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting node appearance: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Bulk Create Nodes ────────────────────────────────────────────────────
  // Create multiple nodes of various types in a single tool call.
  const colorSchema = z
    .object({
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
    })
    .describe("Color in RGBA format");

  server.tool(
    "bulk_create_nodes",
    "Create multiple Figma nodes of various types in a single operation. Supports rectangles, frames, text nodes, and ellipses. Returns the ID and name of every created node.",
    {
      nodes: z
        .array(
          z.discriminatedUnion("type", [
            z.object({
              type: z.literal("rectangle"),
              x: z.number().describe("X position"),
              y: z.number().describe("Y position"),
              width: z.number().describe("Width"),
              height: z.number().describe("Height"),
              name: z.string().optional().describe("Node name"),
              parentId: z.string().optional().describe("Parent node ID"),
              fillColor: colorSchema.optional(),
              strokeColor: colorSchema.optional(),
              strokeWeight: z.number().positive().optional().describe("Stroke weight"),
            }),
            z.object({
              type: z.literal("frame"),
              x: z.number().describe("X position"),
              y: z.number().describe("Y position"),
              width: z.number().describe("Width"),
              height: z.number().describe("Height"),
              name: z.string().optional().describe("Node name"),
              parentId: z.string().optional().describe("Parent node ID"),
              fillColor: colorSchema.optional(),
              strokeColor: colorSchema.optional(),
              strokeWeight: z.number().positive().optional().describe("Stroke weight"),
            }),
            z.object({
              type: z.literal("text"),
              x: z.number().describe("X position"),
              y: z.number().describe("Y position"),
              text: z.string().describe("Text content"),
              fontSize: z.number().optional().describe("Font size (default: 14)"),
              fontWeight: z.number().optional().describe("Font weight (default: 400)"),
              fontColor: colorSchema.optional().describe("Font color (default: black)"),
              name: z.string().optional().describe("Node name"),
              parentId: z.string().optional().describe("Parent node ID"),
              width: z.number().positive().optional().describe("Fixed width for the text node"),
              textAlignHorizontal: z
                .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
                .optional()
                .describe("Horizontal text alignment"),
            }),
            z.object({
              type: z.literal("ellipse"),
              x: z.number().describe("X position"),
              y: z.number().describe("Y position"),
              width: z.number().describe("Width"),
              height: z.number().describe("Height"),
              name: z.string().optional().describe("Node name"),
              parentId: z.string().optional().describe("Parent node ID"),
              fillColor: colorSchema.optional(),
              strokeColor: colorSchema.optional(),
              strokeWeight: z.number().positive().optional().describe("Stroke weight"),
            }),
          ])
        )
        .min(1)
        .describe("Array of node definitions to create"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ nodes, channel }) => {
      const created: Array<{ index: number; type: string; name: string; id: string }> = [];
      const errors: Array<{ index: number; type: string; error: string }> = [];

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        try {
          let result: unknown;
          if (node.type === "rectangle") {
            result = await sendCommandToFigma("create_rectangle", {
              x: node.x,
              y: node.y,
              width: node.width,
              height: node.height,
              name: node.name || "Rectangle",
              parentId: node.parentId,
              fillColor: node.fillColor,
              strokeColor: node.strokeColor,
              strokeWeight: node.strokeWeight,
            }, { channel });
          } else if (node.type === "frame") {
            result = await sendCommandToFigma("create_frame", {
              x: node.x,
              y: node.y,
              width: node.width,
              height: node.height,
              name: node.name || "Frame",
              parentId: node.parentId,
              fillColor: node.fillColor || { r: 1, g: 1, b: 1, a: 1 },
              strokeColor: node.strokeColor,
              strokeWeight: node.strokeWeight,
            }, { channel });
          } else if (node.type === "text") {
            result = await sendCommandToFigma("create_text", {
              x: node.x,
              y: node.y,
              text: node.text,
              fontSize: node.fontSize || 14,
              fontWeight: node.fontWeight || 400,
              fontColor: node.fontColor || { r: 0, g: 0, b: 0, a: 1 },
              name: node.name || "Text",
              parentId: node.parentId,
              width: node.width,
              textAlignHorizontal: node.textAlignHorizontal,
            }, { channel });
          } else if (node.type === "ellipse") {
            result = await sendCommandToFigma("create_ellipse", {
              x: node.x,
              y: node.y,
              width: node.width,
              height: node.height,
              name: node.name || "Ellipse",
              parentId: node.parentId,
              fillColor: node.fillColor,
              strokeColor: node.strokeColor,
              strokeWeight: node.strokeWeight,
            }, { channel });
          } else {
            throw new Error(`Unsupported node type: ${(node as { type: string }).type}`);
          }

          const typedResult = result as { id: string; name: string };
          created.push({ index: i, type: node.type, name: typedResult.name, id: typedResult.id });
        } catch (error) {
          errors.push({
            index: i,
            type: node.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const lines: string[] = [];
      if (created.length > 0) {
        lines.push(`Created ${created.length} node(s):`);
        for (const c of created) {
          lines.push(`  [${c.index}] ${c.type} "${c.name}" — ID: ${c.id}`);
        }
      }
      if (errors.length > 0) {
        lines.push(`Failed to create ${errors.length} node(s):`);
        for (const e of errors) {
          lines.push(`  [${e.index}] ${e.type} — ${e.error}`);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      };
    }
  );

  // ── Get All Components ────────────────────────────────────────────────────
  // Combines get_local_components + get_remote_components into a single call
  // so the LLM can discover the full component catalogue before placing instances.
  server.tool(
    "get_all_components",
    "List all components available in the Figma document — both local components defined in this file and remote library components currently used. Set summary=true for a compact one-line-per-component catalog (name, key, library only) ideal for component discovery in large files. Use the key with create_instance_with_properties to place instances.",
    {
      filter: z
        .string()
        .optional()
        .describe("Optional case-insensitive substring to filter component names (e.g. 'button', 'icon')"),
      includeRemote: z
        .boolean()
        .optional()
        .describe("Whether to include remote library components (default: true)"),
      summary: z
        .boolean()
        .default(false)
        .describe("When true, return a compact one-line-per-component catalog (name, key, source, library) without fonts or text slot details. Use for component discovery when you don't need detailed information."),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ filter, includeRemote = true, summary, channel }) => {
      try {
        // Fetch local components
        const localResult = await sendCommandToFigma("get_local_components", {}, { channel });
        const typedLocal = localResult as {
          count: number;
          components: Array<{ id: string; name: string; key: string | null }>;
        };

        // Optionally fetch remote components
        interface RemoteComponent {
          key: string;
          name: string;
          description: string;
          libraryName: string;
          componentId: string;
          editableTextNodes?: Array<{ name: string; fontFamily: string; fontStyle: string }>;
          fonts?: Array<{ family: string; style: string }>;
        }
        let remoteComponents: RemoteComponent[] = [];
        if (includeRemote) {
          try {
            const remoteResult = await sendCommandToFigma("get_remote_components", {}, { channel });
            const typedRemote = remoteResult as { components: RemoteComponent[] };
            remoteComponents = typedRemote.components ?? [];
          } catch {
            // Remote components are best-effort; local ones are always available
            remoteComponents = [];
          }
        }

        // Merge and optionally filter
        const lowerFilter = filter?.toLowerCase();

        const localEntries = typedLocal.components
          .filter((c) => !lowerFilter || c.name.toLowerCase().includes(lowerFilter))
          .map((c) => ({ source: "local" as const, name: c.name, key: c.key ?? "", id: c.id, libraryName: undefined as string | undefined }));

        const remoteEntries = remoteComponents
          .filter((c) => !lowerFilter || c.name.toLowerCase().includes(lowerFilter))
          .map((c) => ({
            source: "remote" as const,
            name: c.name,
            key: c.key,
            id: c.componentId,
            libraryName: c.libraryName || undefined,
            fonts: c.fonts || undefined,
            editableTextNodes: c.editableTextNodes || undefined,
          }));

        const all = [...localEntries, ...remoteEntries];

        if (all.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: filter
                  ? `No components found matching "${filter}".`
                  : "No components found in this document.",
              },
            ],
          };
        }

        const lines: string[] = [`Found ${all.length} component(s)${filter ? ` matching "${filter}"` : ""}:\n`];

        if (summary) {
          // Compact one-line-per-component format
          for (const c of all) {
            const lib = c.libraryName ? ` [${c.libraryName}]` : "";
            lines.push(`${c.name} | key: ${c.key || "(no key)"} | ${c.source}${lib}`);
          }
        } else {
          // Full multi-line format with fonts and text slots
          for (const c of all) {
            const lib = c.libraryName ? ` [${c.libraryName}]` : "";
            lines.push(`• ${c.name}${lib}`);
            lines.push(`  key: ${c.key || "(no key)"}  source: ${c.source}`);
            if ("fonts" in c && c.fonts && c.fonts.length > 0) {
              lines.push(`  fonts: ${c.fonts.map((f: { family: string; style: string }) => `${f.family} ${f.style}`).join(", ")}`);
            }
            if ("editableTextNodes" in c && c.editableTextNodes && c.editableTextNodes.length > 0) {
              lines.push(`  text slots: ${c.editableTextNodes.map((t: { name: string }) => t.name).join(", ")}`);
            }
          }
        }

        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing components: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Get Component Set Info ─────────────────────────────────────────────────
  // Discovers variant axes, property definitions, and individual variant keys
  // for a component set *before* instantiation — avoids throwaway-instance
  // round-trips.
  server.tool(
    "get_component_set_info",
    "Get variant axes, property definitions, and individual variant keys for a component set. Use this before create_instance_with_properties to discover the correct variant and property names. Accepts either a component set key or an individual component key.",
    {
      componentKey: z
        .string()
        .describe("Key of the component or component set (from get_all_components or design system search)"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ componentKey, channel }) => {
      try {
        const result = await sendCommandToFigma(
          "get_component_set_info",
          { componentKey },
          { channel }
        );

        return {
          content: [
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
              text: `Error getting component set info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Create Instance with Properties ──────────────────────────────────────
  // Combines create_component_instance + set_component_property + set_instance_variant
  // into a single call. This is the most common component workflow: place an
  // instance and immediately configure its inputs (text, boolean, variant).
  server.tool(
    "create_instance_with_properties",
    "Place a component instance in Figma and immediately configure its properties and/or variant in a single operation. Combines create_component_instance, set_component_property, and set_instance_variant. Use get_all_components to find component keys. Accepts both individual component keys and component set keys. For component sets, the default variant is instantiated. Use get_component_set_info first to discover variant axes and property names.",
    {
      componentKey: z
        .string()
        .describe("Key of the component to instantiate (from get_all_components)"),
      x: z.number().describe("X position (local coordinates, relative to parent)"),
      y: z.number().describe("Y position (local coordinates, relative to parent)"),
      parentId: z
        .string()
        .optional()
        .describe("Optional parent node ID to place the instance inside"),
      componentProperties: z
        .record(z.union([z.string(), z.boolean()]))
        .optional()
        .describe(
          "Component property overrides as key→value pairs (e.g. { \"Label#1234:0\": \"Sign up\", \"Show Icon#1234:1\": true }). Keys come from get_component_properties."
        ),
      variantProperties: z
        .record(z.string())
        .optional()
        .describe(
          "Variant properties to set as key→value pairs (e.g. { \"State\": \"Hover\", \"Size\": \"Large\" })"
        ),
      textOverrides: z
        .array(
          z.object({
            nodeName: z.string().describe("Name of the nested text node to update (case-insensitive match). Use names from create_component_instance response textNodes or get_all_components text slots."),
            text: z.string().describe("New text content for this node"),
          })
        )
        .optional()
        .describe("Text content overrides for nested text nodes within the instance (e.g. setting labels and placeholders on a text-field component)"),
      layoutSizingHorizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Horizontal layout sizing for this instance (FILL to stretch in an auto-layout parent)"),
      layoutSizingVertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Vertical layout sizing for this instance (HUG to shrink-wrap content)"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ componentKey, x, y, parentId, componentProperties, variantProperties, textOverrides, layoutSizingHorizontal, layoutSizingVertical, channel }) => {
      try {
        // Step 1: create the instance
        const instanceResult = await sendCommandToFigma("create_component_instance", {
          componentKey,
          x,
          y,
        }, { channel });
        const typedInstance = instanceResult as { id: string; name: string; [key: string]: unknown };
        const instanceId = typedInstance.id;

        // Step 2: move into parent if requested
        if (parentId) {
          await sendCommandToFigma("insert_child", {
            parentId,
            childId: instanceId,
          }, { channel });
        }

        const applied: string[] = [];

        // Step 3: apply component property overrides (text, boolean, instance swap)
        if (componentProperties && Object.keys(componentProperties).length > 0) {
          await sendCommandToFigma("set_component_property", {
            nodeId: instanceId,
            properties: componentProperties,
          }, { channel });
          applied.push(`componentProperties: ${JSON.stringify(componentProperties)}`);
        }

        // Step 4: apply variant properties
        if (variantProperties && Object.keys(variantProperties).length > 0) {
          await sendCommandToFigma("set_instance_variant", {
            nodeId: instanceId,
            properties: variantProperties,
          }, { channel });
          applied.push(`variantProperties: ${JSON.stringify(variantProperties)}`);
        }

        // Step 5: apply text overrides on nested text nodes
        if (textOverrides && textOverrides.length > 0) {
          const overrideResults: string[] = [];
          for (const override of textOverrides) {
            try {
              const findResult = await sendCommandToFigma("find_text_in_subtree", {
                nodeId: instanceId,
                name: override.nodeName,
              }, { channel }) as { found: boolean; nodeId: string | null };

              if (findResult.found && findResult.nodeId) {
                await sendCommandToFigma("set_text_content", {
                  nodeId: findResult.nodeId,
                  text: override.text,
                }, { channel });
                overrideResults.push(`"${override.nodeName}" → "${override.text}"`);
              }
            } catch {
              // Text override failures are non-fatal
            }
          }
          if (overrideResults.length > 0) {
            applied.push(`textOverrides: ${overrideResults.join(", ")}`);
          }
        }

        // Step 6: apply layout sizing
        if (layoutSizingHorizontal !== undefined || layoutSizingVertical !== undefined) {
          await sendCommandToFigma("set_node_properties", {
            nodeId: instanceId,
            layoutSizingHorizontal,
            layoutSizingVertical,
          }, { channel });
          const sizingParts: string[] = [];
          if (layoutSizingHorizontal) sizingParts.push(`H:${layoutSizingHorizontal}`);
          if (layoutSizingVertical) sizingParts.push(`V:${layoutSizingVertical}`);
          applied.push(`layoutSizing: ${sizingParts.join(", ")}`);
        }

        const propertySummary =
          applied.length > 0 ? `\nApplied: ${applied.join("; ")}` : "";

        return {
          content: [
            {
              type: "text",
              text: `Created instance "${typedInstance.name}" with ID: ${instanceId} at (${x}, ${y}).${propertySummary}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating instance with properties: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Bulk Update Text ──────────────────────────────────────────────────────
  // Updates text content on multiple nodes in a single call.
  // This is the primary "content editing" workflow for UX/content designers
  // who need to update copy across many nodes without rebuilding the design.
  server.tool(
    "bulk_update_text",
    "Update the text content of multiple text nodes in a single operation. Processes all updates and reports per-node success or failure without aborting the batch. Ideal for content design workflows where labels, headings, or copy need to be changed across a screen.",
    {
      updates: z
        .array(
          z.object({
            nodeId: z.string().describe("ID of the text node to update"),
            text: z.string().describe("New text content for this node"),
          })
        )
        .min(1)
        .describe("Array of text node updates to apply"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ updates, channel }) => {
      const succeeded: Array<{ index: number; nodeId: string; text: string }> = [];
      const failed: Array<{ index: number; nodeId: string; error: string }> = [];

      for (let i = 0; i < updates.length; i++) {
        const { nodeId, text } = updates[i];
        try {
          await sendCommandToFigma("set_text_content", { nodeId, text }, { channel });
          succeeded.push({ index: i, nodeId, text });
        } catch (error) {
          failed.push({
            index: i,
            nodeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const lines: string[] = [];
      if (succeeded.length > 0) {
        lines.push(`Updated ${succeeded.length} text node(s):`);
        for (const s of succeeded) {
          const preview = s.text.length > 40 ? s.text.slice(0, 40) + "…" : s.text;
          lines.push(`  [${s.index}] ${s.nodeId} → "${preview}"`);
        }
      }
      if (failed.length > 0) {
        lines.push(`Failed to update ${failed.length} node(s):`);
        for (const f of failed) {
          lines.push(`  [${f.index}] ${f.nodeId} — ${f.error}`);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      };
    }
  );

  // ── Swap Component Variants ───────────────────────────────────────────────
  // Changes variant properties on multiple component instances in a single call.
  // Designers frequently need to change states (Default → Hover → Disabled) or
  // sizes across a whole screen without individually selecting each instance.
  server.tool(
    "swap_component_variant",
    "Change variant properties (state, size, style, etc.) on multiple component instances in a single operation. Processes all swaps and reports per-node success or failure without aborting the batch. Ideal for toggling states like Default → Disabled, or changing sizes across a screen.",
    {
      updates: z
        .array(
          z.object({
            nodeId: z.string().describe("ID of the component instance to update"),
            variantProperties: z
              .record(z.string())
              .describe(
                "Variant properties to set as key→value pairs (e.g. { \"State\": \"Disabled\", \"Size\": \"Large\" })"
              ),
          })
        )
        .min(1)
        .describe("Array of variant swap operations to apply"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ updates, channel }) => {
      const succeeded: Array<{ index: number; nodeId: string; variantProperties: Record<string, string> }> = [];
      const failed: Array<{ index: number; nodeId: string; error: string }> = [];

      for (let i = 0; i < updates.length; i++) {
        const { nodeId, variantProperties } = updates[i];
        try {
          await sendCommandToFigma("set_instance_variant", {
            nodeId,
            properties: variantProperties,
          }, { channel });
          succeeded.push({ index: i, nodeId, variantProperties });
        } catch (error) {
          failed.push({
            index: i,
            nodeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const lines: string[] = [];
      if (succeeded.length > 0) {
        lines.push(`Updated variants on ${succeeded.length} instance(s):`);
        for (const s of succeeded) {
          lines.push(`  [${s.index}] ${s.nodeId} → ${JSON.stringify(s.variantProperties)}`);
        }
      }
      if (failed.length > 0) {
        lines.push(`Failed to update ${failed.length} instance(s):`);
        for (const f of failed) {
          lines.push(`  [${f.index}] ${f.nodeId} — ${f.error}`);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      };
    }
  );

  // ── Build Screen from Template ────────────────────────────────────────────
  // Creates a screen frame (artboard) and populates it with component instances
  // in one compound call. This is the "build a screen top-down" designer workflow:
  // drop a nav bar, hero, cards, and footer all at once from a design system.
  // Both local and remote library components are supported — pass the key from
  // get_all_components regardless of source.
  server.tool(
    "build_screen_from_template",
    "Create a screen frame (artboard) and populate it with component instances in a single operation. Both local and remote library components are supported — use keys from get_all_components. This is the primary 'build a screen' workflow for designers: define the artboard, then list the components to place inside it with their positions, variant states, and text overrides.",
    {
      screenName: z.string().describe("Name for the screen frame / artboard"),
      x: z.number().describe("X position of the screen frame on the canvas"),
      y: z.number().describe("Y position of the screen frame on the canvas"),
      width: z.number().describe("Width of the screen frame"),
      height: z.number().describe("Height of the screen frame"),
      fillColor: z
        .object({
          r: z.number().min(0).max(1),
          g: z.number().min(0).max(1),
          b: z.number().min(0).max(1),
          a: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe("Background fill color for the screen frame (default: white)"),
      layoutMode: z
        .enum(["HORIZONTAL", "VERTICAL", "NONE"])
        .optional()
        .describe("Auto-layout direction for the frame. Omit for free-form placement."),
      paddingTop: z.number().optional().describe("Top padding (requires layoutMode)"),
      paddingBottom: z.number().optional().describe("Bottom padding (requires layoutMode)"),
      paddingLeft: z.number().optional().describe("Left padding (requires layoutMode)"),
      paddingRight: z.number().optional().describe("Right padding (requires layoutMode)"),
      itemSpacing: z.number().optional().describe("Spacing between items (requires layoutMode)"),
      components: z
        .array(
          z.object({
            componentKey: z
              .string()
              .describe("Key of the component to place (from get_all_components, supports local and remote)"),
            x: z.number().describe("X position relative to the screen frame"),
            y: z.number().describe("Y position relative to the screen frame"),
            name: z.string().optional().describe("Optional name override for the instance"),
            componentProperties: z
              .record(z.union([z.string(), z.boolean()]))
              .optional()
              .describe("Component property overrides (e.g. text or boolean inputs)"),
            variantProperties: z
              .record(z.string())
              .optional()
              .describe("Variant properties to set (e.g. { \"State\": \"Hover\" })"),
            width: z.number().optional().describe("Resize instance to this width after placement"),
            height: z.number().optional().describe("Resize instance to this height after placement"),
            textOverrides: z
              .array(
                z.object({
                  nodeName: z.string().describe("Name of the nested text node to update (e.g. 'text-label', 'Placeholder Text'). Matched by recursive name search within the instance."),
                  text: z.string().describe("New text content for this node"),
                })
              )
              .optional()
              .describe("Text content overrides for nested text nodes within the instance (e.g. setting labels and placeholders on a text-field component)"),
            layoutSizingHorizontal: z
              .enum(["FIXED", "HUG", "FILL"])
              .optional()
              .describe("Horizontal layout sizing for this instance (FILL to stretch in the auto-layout screen frame)"),
            layoutSizingVertical: z
              .enum(["FIXED", "HUG", "FILL"])
              .optional()
              .describe("Vertical layout sizing for this instance"),
          })
        )
        .describe("List of components to place inside the screen frame"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ screenName, x, y, width, height, fillColor, layoutMode,
      paddingTop, paddingBottom, paddingLeft, paddingRight, itemSpacing,
      components, channel }) => {
      try {
        // Step 1: create the screen frame
        const frameResult = await sendCommandToFigma("create_frame", {
          x,
          y,
          width,
          height,
          name: screenName,
          fillColor: fillColor || { r: 1, g: 1, b: 1, a: 1 },
        }, { channel });
        const typedFrame = frameResult as { id: string; name: string };
        const frameId = typedFrame.id;

        // Step 2: optionally apply auto-layout to the frame
        if (layoutMode && layoutMode !== "NONE") {
          await sendCommandToFigma("set_auto_layout", {
            nodeId: frameId,
            layoutMode,
            paddingTop,
            paddingBottom,
            paddingLeft,
            paddingRight,
            itemSpacing,
          }, { channel });
        }

        // Step 3: place each component instance inside the frame
        const placed: Array<{ index: number; componentKey: string; name: string; id: string }> = [];
        const failed: Array<{ index: number; componentKey: string; error: string }> = [];

        for (let i = 0; i < components.length; i++) {
          const spec = components[i];
          try {
            // Create the instance directly inside the screen frame
            const instanceResult = await sendCommandToFigma("create_component_instance", {
              componentKey: spec.componentKey,
              x: spec.x,
              y: spec.y,
              parentId: frameId,
            }, { channel });
            const typedInstance = instanceResult as { id: string; name: string; width?: number; height?: number };
            const instanceId = typedInstance.id;

            // Apply component property overrides (text, boolean inputs)
            if (spec.componentProperties && Object.keys(spec.componentProperties).length > 0) {
              await sendCommandToFigma("set_component_property", {
                nodeId: instanceId,
                properties: spec.componentProperties,
              }, { channel });
            }

            // Apply variant properties (State, Size, etc.)
            if (spec.variantProperties && Object.keys(spec.variantProperties).length > 0) {
              await sendCommandToFigma("set_instance_variant", {
                nodeId: instanceId,
                properties: spec.variantProperties,
              }, { channel });
            }

            // Resize instance if width/height specified
            if (spec.width !== undefined || spec.height !== undefined) {
              const w = spec.width ?? typedInstance.width;
              const h = spec.height ?? typedInstance.height;
              if (w !== undefined && h !== undefined) {
                await sendCommandToFigma("resize_node", {
                  nodeId: instanceId,
                  width: w,
                  height: h,
                }, { channel });
              }
            }

            // Apply text overrides on nested text nodes within the instance
            if (spec.textOverrides && spec.textOverrides.length > 0) {
              for (const override of spec.textOverrides) {
                try {
                  const findResult = await sendCommandToFigma("find_text_in_subtree", {
                    nodeId: instanceId,
                    name: override.nodeName,
                  }, { channel }) as { found: boolean; nodeId: string | null };

                  if (findResult.found && findResult.nodeId) {
                    await sendCommandToFigma("set_text_content", {
                      nodeId: findResult.nodeId,
                      text: override.text,
                    }, { channel });
                  }
                } catch {
                  // Text override failures are non-fatal
                }
              }
            }

            // Apply layout sizing if specified
            if (spec.layoutSizingHorizontal !== undefined || spec.layoutSizingVertical !== undefined) {
              await sendCommandToFigma("set_node_properties", {
                nodeId: instanceId,
                layoutSizingHorizontal: spec.layoutSizingHorizontal,
                layoutSizingVertical: spec.layoutSizingVertical,
              }, { channel });
            }

            placed.push({
              index: i,
              componentKey: spec.componentKey,
              name: spec.name || typedInstance.name,
              id: instanceId,
            });
          } catch (error) {
            failed.push({
              index: i,
              componentKey: spec.componentKey,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const lines: string[] = [
          `Created screen "${typedFrame.name}" (ID: ${frameId}) at (${x}, ${y}) — ${width}×${height}`,
        ];
        if (layoutMode && layoutMode !== "NONE") {
          lines.push(`Auto-layout: ${layoutMode}`);
        }
        if (placed.length > 0) {
          lines.push(`\nPlaced ${placed.length} component(s):`);
          for (const p of placed) {
            lines.push(`  [${p.index}] "${p.name}" — ID: ${p.id}`);
          }
        }
        if (failed.length > 0) {
          lines.push(`\nFailed to place ${failed.length} component(s):`);
          for (const f of failed) {
            lines.push(`  [${f.index}] ${f.componentKey} — ${f.error}`);
          }
        }

        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error building screen from template: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Bulk Load Fonts ─────────────────────────────────────────────────
  server.tool(
    "bulk_load_fonts",
    "Load multiple font family+style combinations in a single operation. Call this once at session start to pre-load all needed fonts.",
    {
      fonts: z.array(z.object({
        family: z.string().describe("Font family name (e.g. 'Rund Text', 'Inter')"),
        style: z.string().optional().describe("Font style (default: 'Regular'). E.g. 'Bold', 'Medium', 'SemiBold'"),
      })).min(1).describe("Array of font family+style pairs to load"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ fonts, channel }) => {
      try {
        const result = await sendCommandToFigma("bulk_load_fonts", { fonts }, { channel });
        const typedResult = result as { total: number; succeeded: number; failed: number; results: any[] };
        const summary = typedResult.results
          .map((r: any, i: number) => `  [${i}] ${r.family} ${r.style || "Regular"} — ${r.success ? "OK" : `FAILED: ${r.error}`}`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Loaded ${typedResult.succeeded}/${typedResult.total} font(s):\n${summary}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error bulk loading fonts: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Bulk Apply Variables ────────────────────────────────────────────
  server.tool(
    "bulk_apply_variables",
    "Bind Figma variables to multiple nodes in a single operation. Each binding specifies a node, variable, and field (e.g. 'fills/0/color'). Ideal for applying design tokens across a frame. Accepts both local variable IDs and library variable keys. Library variables are automatically imported.",
    {
      bindings: z.array(z.object({
        nodeId: z.string().describe("ID of the node to bind the variable to"),
        variableId: z.string().describe("ID of the variable to bind"),
        field: z.string().describe("Property field path (e.g. 'fills/0/color', 'strokes/0/color', 'itemSpacing', 'paddingTop')"),
      })).min(1).describe("Array of variable bindings to apply"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ bindings, channel }) => {
      try {
        const result = await sendCommandToFigma("bulk_apply_variables", { bindings }, { channel });
        const typedResult = result as { total: number; succeeded: number; failed: number; results: any[] };
        const failures = typedResult.results.filter((r: any) => !r.success);
        let text = `Applied ${typedResult.succeeded}/${typedResult.total} variable binding(s).`;
        if (failures.length > 0) {
          text += `\nFailures:\n` + failures.map((r: any) => `  ${r.nodeId} — ${r.error}`).join("\n");
        }
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error bulk applying variables: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Bulk Add Reactions ──────────────────────────────────────────────
  server.tool(
    "bulk_add_reactions",
    "Add prototyping reactions to multiple nodes in a single operation. Supports NAVIGATE, BACK, CLOSE, and URL reactions. Ideal for wiring up an entire prototype flow at once.",
    {
      reactions: z.array(z.object({
        nodeId: z.string().describe("ID of the trigger node"),
        trigger: z.enum([
          "ON_CLICK", "ON_DRAG", "ON_HOVER", "ON_PRESS",
          "MOUSE_ENTER", "MOUSE_LEAVE", "MOUSE_UP", "MOUSE_DOWN", "AFTER_TIMEOUT",
        ]).describe("Trigger type"),
        triggerTimeout: z.number().min(0).optional().describe("Timeout in ms (only for AFTER_TIMEOUT)"),
        navigationType: z.enum(["NAVIGATE", "OVERLAY", "SWAP", "SCROLL_TO", "CHANGE_TO"]).optional()
          .describe("Navigation type (for NODE actions)"),
        destinationId: z.string().optional().describe("Destination node ID (for NODE actions)"),
        transition: z.object({
          type: z.enum(["DISSOLVE", "SMART_ANIMATE", "MOVE_IN", "MOVE_OUT", "PUSH", "SLIDE_IN", "SLIDE_OUT"]),
          duration: z.number().min(0).optional(),
          easing: z.enum(["LINEAR", "EASE_IN", "EASE_OUT", "EASE_IN_AND_OUT"]).optional(),
        }).optional().describe("Transition animation"),
        actionType: z.enum(["BACK", "CLOSE"]).optional().describe("For back/close reactions"),
        url: z.string().optional().describe("URL to open (for URL reactions)"),
      })).min(1).describe("Array of reactions to add"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ reactions, channel }) => {
      try {
        const result = await sendCommandToFigma("bulk_add_reactions", { reactions }, { channel });
        const typedResult = result as { total: number; succeeded: number; failed: number; results: any[] };
        const failures = typedResult.results.filter((r: any) => !r.success);
        let text = `Added ${typedResult.succeeded}/${typedResult.total} reaction(s).`;
        if (failures.length > 0) {
          text += `\nFailures:\n` + failures.map((r: any) => `  ${r.nodeId} — ${r.error}`).join("\n");
        }
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error bulk adding reactions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Replace Node with Instance ─────────────────────────────────────────
  // Replaces an existing node (e.g. a manually built frame) with a library
  // component instance in a single operation. This handles component import,
  // instance creation, position/size matching, parent re-insertion at the
  // same sibling index, and deletion of the old node — all server-side in
  // one round-trip. Follow-up variant and property overrides are applied
  // via separate commands if provided.
  server.tool(
    "replace_node_with_instance",
    "Replace an existing node with a component instance in a single operation. The new instance is placed at the same position and sibling index as the original node, optionally resized to match its dimensions. The original node is deleted. Use get_all_components to find component keys. Variant and component property overrides can be applied in the same call.",
    {
      targetNodeId: z
        .string()
        .describe("ID of the node to replace"),
      componentKey: z
        .string()
        .describe("Key of the component (or component set) to instantiate (from get_all_components)"),
      variantProperties: z
        .record(z.string())
        .optional()
        .describe(
          "Variant properties to set on the new instance (e.g. { \"State\": \"Hover\", \"Size\": \"Large\" })"
        ),
      componentProperties: z
        .record(z.union([z.string(), z.boolean()]))
        .optional()
        .describe(
          "Component property overrides as key→value pairs (e.g. { \"Label#1234:0\": \"Sign up\", \"Show Icon#1234:1\": true }). Keys come from get_component_properties."
        ),
      matchSize: z
        .boolean()
        .optional()
        .describe("Resize the new instance to match the target node's dimensions (default: true)"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ targetNodeId, componentKey, variantProperties, componentProperties, matchSize, channel }) => {
      try {
        // Step 1: Replace the node server-side (handles import, create, position, resize, reparent, delete)
        const result = await sendCommandToFigma("replace_node_with_instance", {
          targetNodeId,
          componentKey,
          matchSize: matchSize !== undefined ? matchSize : true,
        }, { channel });
        const typedResult = result as {
          id: string;
          name: string;
          x: number;
          y: number;
          width: number;
          height: number;
          componentId: string | null;
          replacedNodeId: string;
          parentId: string;
          siblingIndex: number;
        };
        const instanceId = typedResult.id;

        const applied: string[] = [];

        // Step 2: Apply variant properties if provided
        if (variantProperties && Object.keys(variantProperties).length > 0) {
          await sendCommandToFigma("set_instance_variant", {
            nodeId: instanceId,
            properties: variantProperties,
          }, { channel });
          applied.push(`variantProperties: ${JSON.stringify(variantProperties)}`);
        }

        // Step 3: Apply component property overrides if provided
        if (componentProperties && Object.keys(componentProperties).length > 0) {
          await sendCommandToFigma("set_component_property", {
            nodeId: instanceId,
            properties: componentProperties,
          }, { channel });
          applied.push(`componentProperties: ${JSON.stringify(componentProperties)}`);
        }

        const propertySummary =
          applied.length > 0 ? `\nApplied: ${applied.join("; ")}` : "";

        return {
          content: [
            {
              type: "text",
              text: `Replaced node ${typedResult.replacedNodeId} with instance "${typedResult.name}" (ID: ${instanceId}) at (${typedResult.x}, ${typedResult.y}), size ${typedResult.width}×${typedResult.height}. Parent: ${typedResult.parentId}, index: ${typedResult.siblingIndex}.${propertySummary}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error replacing node with instance: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Create Responsive Variants ──────────────────────────────────────────
  // Clones a frame at multiple target widths, proportionally rescaling all
  // children (text, strokes, effects, nested frames).  Useful for producing
  // responsive breakpoint previews from a single source frame.
  server.tool(
    "create_responsive_variants",
    "Clone a frame at multiple screen sizes, proportionally rescaling all children. Produces responsive breakpoint previews from a single source frame.",
    {
      sourceNodeId: z.string().describe("The ID of the source frame to duplicate"),
      variants: z
        .array(
          z.object({
            name: z.string().optional().describe("Optional name for the variant (e.g. 'Mobile 375px')"),
            width: z.number().positive().describe("Target width for this variant"),
            height: z.number().positive().optional().describe("Target height (defaults to proportional scaling from width)"),
            offsetX: z.number().optional().describe("Horizontal offset from the source frame"),
            offsetY: z.number().optional().describe("Vertical offset from the source frame"),
          })
        )
        .min(1)
        .describe("Array of variant definitions with target sizes"),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ sourceNodeId, variants, channel }) => {
      try {
        // Get source node info for dimensions and position
        const sourceInfo = (await sendCommandToFigma("get_node_info", { nodeId: sourceNodeId }, { channel })) as {
          id: string;
          name: string;
          width: number;
          height: number;
          x: number;
          y: number;
        };

        const sourceWidth = sourceInfo.width;
        const sourceHeight = sourceInfo.height;
        const results: Array<{ index: number; id: string; name: string; width: number; height: number; x: number; y: number }> = [];
        const errors: Array<{ index: number; error: string }> = [];

        // Track the rightmost edge for auto-spacing
        let nextX = sourceInfo.x + sourceWidth + 100;

        for (let i = 0; i < variants.length; i++) {
          const variant = variants[i];
          try {
            // 1. Clone the source node
            const cloneX = variant.offsetX !== undefined ? sourceInfo.x + variant.offsetX : nextX;
            const cloneY = variant.offsetY !== undefined ? sourceInfo.y + variant.offsetY : sourceInfo.y;

            const cloneResult = (await sendCommandToFigma("clone_node", {
              nodeId: sourceNodeId,
              x: cloneX,
              y: cloneY,
            }, { channel })) as { id: string; name: string; width: number };

            // 2. Rescale proportionally based on width ratio
            const scaleFactor = variant.width / sourceWidth;
            await sendCommandToFigma("rescale_node", {
              nodeId: cloneResult.id,
              scaleFactor,
            }, { channel });

            // 3. If explicit height differs from proportional, resize to exact dimensions
            const proportionalHeight = sourceHeight * scaleFactor;
            if (variant.height !== undefined && Math.abs(variant.height - proportionalHeight) > 0.5) {
              await sendCommandToFigma("resize_node", {
                nodeId: cloneResult.id,
                width: variant.width,
                height: variant.height,
              }, { channel });
            }

            // 4. Rename if requested
            const variantName = variant.name || `${sourceInfo.name} – ${variant.width}w`;
            await sendCommandToFigma("rename_node", {
              nodeId: cloneResult.id,
              name: variantName,
            }, { channel });

            // Get final dimensions
            const finalInfo = (await sendCommandToFigma("get_node_info", { nodeId: cloneResult.id }, { channel })) as {
              width: number;
              height: number;
              x: number;
              y: number;
            };

            results.push({
              index: i,
              id: cloneResult.id,
              name: variantName,
              width: finalInfo.width,
              height: finalInfo.height,
              x: finalInfo.x,
              y: finalInfo.y,
            });

            // Update nextX for auto-spacing
            nextX = finalInfo.x + finalInfo.width + 100;
          } catch (err) {
            errors.push({ index: i, error: err instanceof Error ? err.message : String(err) });
          }
        }

        const summary = [
          `Created ${results.length} responsive variant(s) from "${sourceInfo.name}" (${sourceWidth}×${sourceHeight}):`,
          ...results.map((r) => `  • "${r.name}" → ${r.width}×${r.height} at (${r.x}, ${r.y}) [${r.id}]`),
          ...(errors.length > 0
            ? [`Failed ${errors.length} variant(s):`, ...errors.map((e) => `  • index ${e.index}: ${e.error}`)]
            : []),
        ].join("\n");

        return {
          content: [{ type: "text", text: summary }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating responsive variants: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Get Node Tree ───────────────────────────────────────────────────────────
  // Returns a compact hierarchical tree of a Figma subtree.
  server.tool(
    "get_node_tree",
    "Get a compact hierarchical tree view of a Figma subtree. Returns structure, dimensions, layout mode, component usage, and text content for each node — without styling details (no fills, strokes, effects). Use this instead of get_node_info when you need to understand the layout and structure of a design. For visual context, pair with export_node_as_image.",
    {
      nodeId: z.string().describe("The root node ID to start the tree from"),
      maxDepth: z
        .number()
        .min(1)
        .max(10)
        .default(3)
        .describe("Maximum depth of the tree to traverse (default: 3). Higher values give more detail but require more round trips to Figma."),
      channel: z.string().optional().describe("Target channel to send the command to (uses active channel if omitted)"),
    },
    async ({ nodeId, maxDepth, channel }) => {
      try {
        const tree = await buildNodeTree(nodeId, maxDepth, channel);
        if (!tree) {
          return {
            content: [{ type: "text", text: "Node not found or is a VECTOR type (skipped)." }],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(tree, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error building node tree: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ── Generate Design Brief ───────────────────────────────────────────────────
  // Multi-channel orchestration tool that reads from multiple Figma files
  // and returns a condensed design brief with role-based extraction.
  server.tool(
    "generate_design_brief",
    "Generate a condensed multi-source design brief by reading from multiple joined Figma channels. Extracts compact structure from a reference design, component catalog from a library, design tokens from a foundations file, and document context from a target file. Each source requires a channel (from join_channel) and a role that determines what data is extracted. Use this for multi-file design workflows instead of manually reading each file.",
    {
      sources: z
        .array(
          z.object({
            channel: z.string().describe("Channel ID of the Figma file (must be joined via join_channel)"),
            role: z
              .enum(["reference", "library", "tokens", "target"])
              .describe("What to extract: 'reference' gets node tree structure, 'library' gets component catalog, 'tokens' gets design variables, 'target' gets document overview"),
            nodeId: z
              .string()
              .optional()
              .describe("Root node ID (required for 'reference' role, optional for 'target')"),
          })
        )
        .min(1)
        .describe("Array of sources to read from, each with a channel, role, and optional nodeId"),
    },
    async ({ sources }) => {
      try {
        // Validate all channels are joined
        const joined = getJoinedChannels();
        const unjoined = sources.filter((s) => !joined.has(s.channel));
        if (unjoined.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: `Error: The following channels are not joined: ${unjoined.map((s) => s.channel).join(", ")}. Use join_channel first.`,
              },
            ],
          };
        }

        // Validate reference sources have nodeId
        const missingNodeId = sources.filter((s) => s.role === "reference" && !s.nodeId);
        if (missingNodeId.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: `Error: 'reference' role requires a nodeId. Missing for channel(s): ${missingNodeId.map((s) => s.channel).join(", ")}`,
              },
            ],
          };
        }

        // Process each source in parallel
        const results = await Promise.allSettled(
          sources.map(async (source) => {
            const { channel, role, nodeId } = source;

            switch (role) {
              case "reference": {
                const tree = await buildNodeTree(nodeId!, 4, channel);
                return {
                  role,
                  channel,
                  content: `## Reference Design (${channel})\n\n\`\`\`json\n${JSON.stringify(tree, null, 2)}\n\`\`\``,
                };
              }

              case "library": {
                const localResult = await sendCommandToFigma("get_local_components", {}, { channel });
                const typedLocal = localResult as {
                  count: number;
                  components: Array<{ id: string; name: string; key: string | null }>;
                };

                let remoteComponents: Array<{ key: string; name: string; libraryName: string }> = [];
                try {
                  const remoteResult = await sendCommandToFigma("get_remote_components", {}, { channel });
                  const typedRemote = remoteResult as { components: Array<{ key: string; name: string; libraryName: string }> };
                  remoteComponents = typedRemote.components ?? [];
                } catch {
                  // Remote is best-effort
                }

                const lines: string[] = [];
                for (const c of typedLocal.components) {
                  lines.push(`${c.name} | key: ${c.key ?? "(no key)"} | local`);
                }
                for (const c of remoteComponents) {
                  const lib = c.libraryName ? ` [${c.libraryName}]` : "";
                  lines.push(`${c.name} | key: ${c.key} | remote${lib}`);
                }

                return {
                  role,
                  channel,
                  content: `## Component Library (${channel})\n\n${lines.length} component(s):\n${lines.join("\n")}`,
                };
              }

              case "tokens": {
                const vars = await sendCommandToFigma("get_variables", {}, { channel });
                return {
                  role,
                  channel,
                  content: `## Design Tokens (${channel})\n\n\`\`\`json\n${JSON.stringify(vars, null, 2)}\n\`\`\``,
                };
              }

              case "target": {
                const docInfo = await sendCommandToFigma("get_document_info", {}, { channel });
                let extra = "";
                if (nodeId) {
                  const tree = await buildNodeTree(nodeId, 2, channel);
                  extra = `\n\nTarget node tree:\n\`\`\`json\n${JSON.stringify(tree, null, 2)}\n\`\`\``;
                }
                return {
                  role,
                  channel,
                  content: `## Target Document (${channel})\n\n\`\`\`json\n${JSON.stringify(docInfo, null, 2)}\n\`\`\`${extra}`,
                };
              }
            }
          })
        );

        // Assemble the brief
        const sections: string[] = [`# Design Brief\n\nSources: ${sources.map((s) => `${s.role}(${s.channel})`).join(", ")}\n`];

        for (const result of results) {
          if (result.status === "fulfilled") {
            sections.push(result.value.content);
          } else {
            sections.push(`## Error\n\n${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
          }
        }

        return {
          content: [{ type: "text", text: sections.join("\n\n---\n\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating design brief: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
