import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCompoundTools } from '../../src/talk_to_figma_mcp/tools/compound-tools';

jest.mock('../../src/talk_to_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: jest.fn().mockResolvedValue({ name: 'MockNode', id: 'mock-id-1' }),
}));

describe('compound tools', () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  const handlers: Record<string, { handler: (...args: any[]) => any; schema: z.ZodObject<any> }> = {};

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    mockSendCommand = require('../../src/talk_to_figma_mcp/utils/websocket').sendCommandToFigma;
    mockSendCommand.mockClear();
    mockSendCommand.mockResolvedValue({ name: 'MockNode', id: 'mock-id-1' });

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, 'tool').mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, , schema, handler] = args;
        handlers[name] = { handler, schema: z.object(schema) };
      }
      return (originalTool as any)(...args);
    });

    registerCompoundTools(server);
  });

  async function callTool(name: string, args: any) {
    const { handler, schema } = handlers[name];
    const validatedArgs = schema.parse(args);
    return handler(validatedArgs, { meta: {} });
  }

  // ── create_frame_with_autolayout ─────────────────────────────────────────

  describe('create_frame_with_autolayout tool', () => {
    const baseArgs = {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      layoutMode: 'HORIZONTAL',
    };

    it('calls create_frame then set_auto_layout in order', async () => {
      await callTool('create_frame_with_autolayout', baseArgs);

      expect(mockSendCommand).toHaveBeenCalledTimes(2);
      expect(mockSendCommand.mock.calls[0][0]).toBe('create_frame');
      expect(mockSendCommand.mock.calls[1][0]).toBe('set_auto_layout');
    });

    it('passes frame parameters to create_frame', async () => {
      await callTool('create_frame_with_autolayout', {
        ...baseArgs,
        name: 'Card',
        parentId: 'parent-1',
        fillColor: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
      });

      const [, framePayload] = mockSendCommand.mock.calls[0];
      expect(framePayload).toMatchObject({
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        name: 'Card',
        parentId: 'parent-1',
        fillColor: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
      });
    });

    it('passes the created frame ID to set_auto_layout as nodeId', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Card', id: 'frame-abc' });

      await callTool('create_frame_with_autolayout', {
        ...baseArgs,
        paddingTop: 16,
        itemSpacing: 8,
        primaryAxisAlignItems: 'CENTER',
      });

      const [, layoutPayload] = mockSendCommand.mock.calls[1];
      expect(layoutPayload.nodeId).toBe('frame-abc');
      expect(layoutPayload.layoutMode).toBe('HORIZONTAL');
      expect(layoutPayload.paddingTop).toBe(16);
      expect(layoutPayload.itemSpacing).toBe(8);
      expect(layoutPayload.primaryAxisAlignItems).toBe('CENTER');
    });

    it('defaults frame name to "Frame" when omitted', async () => {
      await callTool('create_frame_with_autolayout', baseArgs);

      const [, framePayload] = mockSendCommand.mock.calls[0];
      expect(framePayload.name).toBe('Frame');
    });

    it('defaults fillColor to white when omitted', async () => {
      await callTool('create_frame_with_autolayout', baseArgs);

      const [, framePayload] = mockSendCommand.mock.calls[0];
      expect(framePayload.fillColor).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    });

    it('returns a success message containing the frame name and ID', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Hero', id: 'frame-xyz' });
      mockSendCommand.mockResolvedValueOnce({ name: 'Hero' });

      const result = await callTool('create_frame_with_autolayout', {
        ...baseArgs,
        name: 'Hero',
        layoutMode: 'VERTICAL',
      });

      expect(result.content[0].text).toContain('Hero');
      expect(result.content[0].text).toContain('frame-xyz');
      expect(result.content[0].text).toContain('VERTICAL');
    });

    it('returns an error message when create_frame fails', async () => {
      mockSendCommand.mockRejectedValueOnce(new Error('Node not found'));

      const result = await callTool('create_frame_with_autolayout', baseArgs);

      expect(result.content[0].text).toContain('Error creating frame with auto-layout');
      expect(result.content[0].text).toContain('Node not found');
    });

    it('rejects missing layoutMode', async () => {
      const { schema } = handlers['create_frame_with_autolayout'];
      expect(() => schema.parse({ x: 0, y: 0, width: 100, height: 100 })).toThrow();
    });

    it('accepts all optional auto-layout parameters', async () => {
      await callTool('create_frame_with_autolayout', {
        ...baseArgs,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 16,
        paddingRight: 16,
        itemSpacing: 12,
        primaryAxisAlignItems: 'SPACE_BETWEEN',
        counterAxisAlignItems: 'CENTER',
        layoutWrap: 'WRAP',
        strokesIncludedInLayout: true,
      });

      const [, layoutPayload] = mockSendCommand.mock.calls[1];
      expect(layoutPayload.paddingTop).toBe(8);
      expect(layoutPayload.paddingBottom).toBe(8);
      expect(layoutPayload.paddingLeft).toBe(16);
      expect(layoutPayload.paddingRight).toBe(16);
      expect(layoutPayload.itemSpacing).toBe(12);
      expect(layoutPayload.primaryAxisAlignItems).toBe('SPACE_BETWEEN');
      expect(layoutPayload.counterAxisAlignItems).toBe('CENTER');
      expect(layoutPayload.layoutWrap).toBe('WRAP');
      expect(layoutPayload.strokesIncludedInLayout).toBe(true);
    });
  });

  // ── set_node_appearance ──────────────────────────────────────────────────

  describe('set_node_appearance tool', () => {
    it('applies fillColor when provided', async () => {
      await callTool('set_node_appearance', {
        nodeId: 'node-1',
        fillColor: { r: 0.2, g: 0.4, b: 0.6, a: 1 },
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand.mock.calls[0][0]).toBe('set_fill_color');
      expect(mockSendCommand.mock.calls[0][1]).toMatchObject({
        nodeId: 'node-1',
        color: { r: 0.2, g: 0.4, b: 0.6, a: 1 },
      });
    });

    it('applies strokeColor when provided', async () => {
      await callTool('set_node_appearance', {
        nodeId: 'node-1',
        strokeColor: { r: 0, g: 0, b: 0, a: 1 },
        strokeWeight: 2,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand.mock.calls[0][0]).toBe('set_stroke_color');
      expect(mockSendCommand.mock.calls[0][1]).toMatchObject({
        nodeId: 'node-1',
        color: { r: 0, g: 0, b: 0, a: 1 },
        strokeWeight: 2,
      });
    });

    it('applies cornerRadius when provided', async () => {
      await callTool('set_node_appearance', {
        nodeId: 'node-1',
        cornerRadius: 8,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand.mock.calls[0][0]).toBe('set_corner_radius');
      expect(mockSendCommand.mock.calls[0][1]).toMatchObject({
        nodeId: 'node-1',
        radius: 8,
        corners: [true, true, true, true],
      });
    });

    it('applies opacity when provided', async () => {
      await callTool('set_node_appearance', {
        nodeId: 'node-1',
        opacity: 0.5,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand.mock.calls[0][0]).toBe('set_node_properties');
      expect(mockSendCommand.mock.calls[0][1]).toMatchObject({
        nodeId: 'node-1',
        opacity: 0.5,
      });
    });

    it('applies all provided properties in sequence', async () => {
      await callTool('set_node_appearance', {
        nodeId: 'node-1',
        fillColor: { r: 1, g: 0, b: 0, a: 1 },
        strokeColor: { r: 0, g: 0, b: 0 },
        strokeWeight: 1,
        cornerRadius: 4,
        opacity: 0.8,
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(4);
      expect(mockSendCommand.mock.calls[0][0]).toBe('set_fill_color');
      expect(mockSendCommand.mock.calls[1][0]).toBe('set_stroke_color');
      expect(mockSendCommand.mock.calls[2][0]).toBe('set_corner_radius');
      expect(mockSendCommand.mock.calls[3][0]).toBe('set_node_properties');
    });

    it('defaults stroke alpha to 1 when not specified', async () => {
      await callTool('set_node_appearance', {
        nodeId: 'node-1',
        strokeColor: { r: 0, g: 0, b: 0 },
      });

      const [, strokePayload] = mockSendCommand.mock.calls[0];
      expect(strokePayload.color.a).toBe(1);
    });

    it('defaults strokeWeight to 1 when strokeColor is provided without weight', async () => {
      await callTool('set_node_appearance', {
        nodeId: 'node-1',
        strokeColor: { r: 0, g: 0, b: 0, a: 1 },
      });

      const [, strokePayload] = mockSendCommand.mock.calls[0];
      expect(strokePayload.strokeWeight).toBe(1);
    });

    it('returns a descriptive message listing applied changes', async () => {
      const result = await callTool('set_node_appearance', {
        nodeId: 'node-1',
        fillColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
        cornerRadius: 6,
      });

      expect(result.content[0].text).toContain('node-1');
      expect(result.content[0].text).toContain('fill');
      expect(result.content[0].text).toContain('cornerRadius');
    });

    it('returns a warning when no properties are provided', async () => {
      const result = await callTool('set_node_appearance', { nodeId: 'node-1' });

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('No appearance properties');
    });

    it('returns an error message when a sub-command fails', async () => {
      mockSendCommand.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await callTool('set_node_appearance', {
        nodeId: 'node-1',
        fillColor: { r: 1, g: 0, b: 0 },
      });

      expect(result.content[0].text).toContain('Error setting node appearance');
      expect(result.content[0].text).toContain('Permission denied');
    });

    it('rejects opacity > 1', async () => {
      const { schema } = handlers['set_node_appearance'];
      expect(() => schema.parse({ nodeId: 'n', opacity: 1.5 })).toThrow();
    });

    it('rejects opacity < 0', async () => {
      const { schema } = handlers['set_node_appearance'];
      expect(() => schema.parse({ nodeId: 'n', opacity: -0.1 })).toThrow();
    });

    it('accepts opacity 0 (fully transparent)', async () => {
      await callTool('set_node_appearance', { nodeId: 'node-1', opacity: 0 });

      const [, opacityPayload] = mockSendCommand.mock.calls[0];
      expect(opacityPayload.opacity).toBe(0);
    });
  });

  // ── bulk_create_nodes ────────────────────────────────────────────────────

  describe('bulk_create_nodes tool', () => {
    it('creates a single rectangle', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Rectangle', id: 'rect-1' });

      const result = await callTool('bulk_create_nodes', {
        nodes: [{ type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }],
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand.mock.calls[0][0]).toBe('create_rectangle');
      expect(result.content[0].text).toContain('rect-1');
    });

    it('creates a single frame', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Frame', id: 'frame-1' });

      await callTool('bulk_create_nodes', {
        nodes: [{ type: 'frame', x: 0, y: 0, width: 200, height: 100 }],
      });

      expect(mockSendCommand.mock.calls[0][0]).toBe('create_frame');
    });

    it('creates a single text node', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Hello', id: 'text-1' });

      await callTool('bulk_create_nodes', {
        nodes: [{ type: 'text', x: 10, y: 20, text: 'Hello' }],
      });

      expect(mockSendCommand.mock.calls[0][0]).toBe('create_text');
      expect(mockSendCommand.mock.calls[0][1]).toMatchObject({
        text: 'Hello',
        x: 10,
        y: 20,
      });
    });

    it('creates a single ellipse', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Circle', id: 'ellipse-1' });

      await callTool('bulk_create_nodes', {
        nodes: [{ type: 'ellipse', x: 0, y: 0, width: 80, height: 80, name: 'Circle' }],
      });

      expect(mockSendCommand.mock.calls[0][0]).toBe('create_ellipse');
    });

    it('creates multiple nodes sequentially', async () => {
      mockSendCommand
        .mockResolvedValueOnce({ name: 'Rect', id: 'r-1' })
        .mockResolvedValueOnce({ name: 'Label', id: 't-1' });

      const result = await callTool('bulk_create_nodes', {
        nodes: [
          { type: 'rectangle', x: 0, y: 0, width: 100, height: 40 },
          { type: 'text', x: 10, y: 10, text: 'Label' },
        ],
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(2);
      expect(result.content[0].text).toContain('2 node(s)');
      expect(result.content[0].text).toContain('r-1');
      expect(result.content[0].text).toContain('t-1');
    });

    it('reports partial success when one node fails', async () => {
      mockSendCommand
        .mockResolvedValueOnce({ name: 'Rect', id: 'r-1' })
        .mockRejectedValueOnce(new Error('Font not loaded'));

      const result = await callTool('bulk_create_nodes', {
        nodes: [
          { type: 'rectangle', x: 0, y: 0, width: 100, height: 40 },
          { type: 'text', x: 0, y: 50, text: 'Hi' },
        ],
      });

      expect(result.content[0].text).toContain('Created 1');
      expect(result.content[0].text).toContain('Failed to create 1');
      expect(result.content[0].text).toContain('Font not loaded');
    });

    it('forwards parentId to each create command', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Rect', id: 'r-1' });

      await callTool('bulk_create_nodes', {
        nodes: [
          { type: 'rectangle', x: 0, y: 0, width: 50, height: 50, parentId: 'container-id' },
        ],
      });

      expect(mockSendCommand.mock.calls[0][1].parentId).toBe('container-id');
    });

    it('forwards fillColor and strokeColor for shapes', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Rect', id: 'r-1' });

      await callTool('bulk_create_nodes', {
        nodes: [
          {
            type: 'rectangle',
            x: 0,
            y: 0,
            width: 100,
            height: 50,
            fillColor: { r: 1, g: 0, b: 0, a: 1 },
            strokeColor: { r: 0, g: 0, b: 0, a: 1 },
            strokeWeight: 2,
          },
        ],
      });

      expect(mockSendCommand.mock.calls[0][1].fillColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
      expect(mockSendCommand.mock.calls[0][1].strokeColor).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(mockSendCommand.mock.calls[0][1].strokeWeight).toBe(2);
    });

    it('defaults text fontSize to 14 and fontWeight to 400', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Text', id: 'text-1' });

      await callTool('bulk_create_nodes', {
        nodes: [{ type: 'text', x: 0, y: 0, text: 'Hi' }],
      });

      const [, payload] = mockSendCommand.mock.calls[0];
      expect(payload.fontSize).toBe(14);
      expect(payload.fontWeight).toBe(400);
    });

    it('defaults frame fillColor to white', async () => {
      mockSendCommand.mockResolvedValueOnce({ name: 'Frame', id: 'f-1' });

      await callTool('bulk_create_nodes', {
        nodes: [{ type: 'frame', x: 0, y: 0, width: 200, height: 100 }],
      });

      const [, payload] = mockSendCommand.mock.calls[0];
      expect(payload.fillColor).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    });

    it('rejects an empty nodes array', async () => {
      const { schema } = handlers['bulk_create_nodes'];
      expect(() => schema.parse({ nodes: [] })).toThrow();
    });

    it('rejects an unknown node type', async () => {
      const { schema } = handlers['bulk_create_nodes'];
      expect(() =>
        schema.parse({ nodes: [{ type: 'triangle', x: 0, y: 0, width: 50, height: 50 }] })
      ).toThrow();
    });

    it('includes node index in output for traceability', async () => {
      mockSendCommand
        .mockResolvedValueOnce({ name: 'R1', id: 'r-1' })
        .mockResolvedValueOnce({ name: 'R2', id: 'r-2' });

      const result = await callTool('bulk_create_nodes', {
        nodes: [
          { type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
          { type: 'rectangle', x: 60, y: 0, width: 50, height: 50 },
        ],
      });

      expect(result.content[0].text).toContain('[0]');
      expect(result.content[0].text).toContain('[1]');
    });
  });
});
