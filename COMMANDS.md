# Available commands

Complete reference of the tools available to interact with Figma.

## Session and connection tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `join_channel` | Connect to Figma | Establish communication with a Figma plugin instance |
| `list_sessions` | List active sessions | Discover running Figma plugin instances with their channel IDs |
| `auto_join_session` | Auto-connect | Automatically join if one session is active, list choices if multiple |
| `set_active_channel` | Switch channel | Change which joined channel receives commands |
| `list_channels` | Show channels | List all joined channels and which is active |
| `leave_channel` | Disconnect channel | Leave a previously joined channel |
| `get_connection_status` | Check status | Verify WebSocket connection and active channel before sending commands |

## Document and page tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `get_document_info` | Document analysis | Get project overview |
| `get_selection` | Current selection | What is currently selected |
| `get_node_info` | Element details | Inspect a specific component |
| `get_nodes_info` | Multiple elements info | Batch inspection |
| `scan_text_nodes` | Find all text nodes | Text audit and update |
| `get_styles` | Document styles | Color and text style audit |
| `get_local_components` | Project components | Design system audit |
| `get_remote_components` | Team libraries | Access shared components (supports filtering by library and name, allPages=true to scan entire document) |
| `get_available_libraries` | Available libraries | List team libraries and their variable collections |
| `export_node_as_image` | Export assets | Generate design assets (PNG, JPG, SVG, PDF) |
| `get_pages` | List pages | View all document pages |
| `create_page` | Create page | Add a new page to the document |
| `create_slide` | Create slide | Add a new slide in Figma Slides documents |
| `delete_page` | Delete page | Remove a specific page |
| `rename_page` | Rename page | Change a page's name |
| `set_current_page` | Switch page | Go to a specific page |
| `duplicate_page` | Duplicate page | Create a complete copy of a page and all its contents |

## Image tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `set_image_fill` | Apply image to node | Set product photos, avatars (URL or base64) |
| `set_image` | Set image from base64 | Apply base64-encoded image data directly (PNG, JPEG, GIF, WebP) |
| `get_image_from_node` | Extract image metadata | Audit images in design |
| `replace_image_fill` | Swap images | Update assets while preserving transform |
| `apply_image_transform` | Adjust image position/scale/rotation | Pan, zoom, rotate image inside node |
| `set_image_filters` | Apply color/light adjustments | Brightness, contrast, saturation, etc. |

**Known Limitations:**
- **URL images**: Must be whitelisted in `manifest.json` (`allowedDomains`). Use base64 (`sourceType: "base64"`) for no restrictions.
- **Data URIs not supported**: `data:image/...` format unsupported
- **Rotation**: 90 degree increments only (0, 90, 180, 270)

## SVG tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `set_svg` | Import SVG | Import SVG markup as a vector node (sanitized, max 500KB) |
| `get_svg` | Export SVG | Export a node as SVG markup string including all children |

## Creation tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `create_rectangle` | Basic shapes | Buttons, backgrounds |
| `create_frame` | Layout containers | Page sections, cards (supports fill and stroke color) |
| `create_text` | Text elements | Headings, labels (supports width, alignment, auto-resize) |
| `create_ellipse` | Circles/ovals | Profile pictures, icons |
| `create_polygon` | Polygon shapes | Custom geometric elements (configurable sides) |
| `create_star` | Stars | Decorative elements (configurable points and inner radius) |
| `clone_node` | Duplicate elements | Copy existing designs |
| `group_nodes` | Organize elements | Component grouping |
| `ungroup_nodes` | Separate groups | Decompose components |
| `insert_child` | Nest elements | Hierarchical structure |
| `flatten_node` | Vector operations | Boolean operations |
| `boolean_operation` | Combine shapes | Union, subtract, intersect, or exclude two or more nodes |

## Modification tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `set_fill_color` | Element colors | Apply brand colors |
| `set_stroke_color` | Border colors | Outline styles |
| `set_selection_colors` | Bulk recolor | Recursively recolor icons and child groups |
| `set_gradient` | Gradient fills | Linear, radial, angular, or diamond gradients |
| `move_node` | Positioning | Layout adjustments |
| `resize_node` | Size changes | Responsive scaling |
| `rotate_node` | Rotation | Rotate nodes by angle (supports relative rotation) |
| `rename_node` | Rename node | Organize layers and components |
| `delete_node` | Delete elements | Clean up designs |
| `set_corner_radius` | Rounded corners | Modern UI styles (supports per-corner control) |
| `set_auto_layout` | Flexbox-like layout | Component spacing, alignment, wrapping |
| `set_effects` | Shadows/blurs | Drop shadow, inner shadow, layer blur, background blur |
| `set_effect_style_id` | Apply effect styles | Consistent shadows from styles |
| `set_node_properties` | Visibility/lock/opacity | Toggle visibility, lock state, opacity, layout sizing |
| `reorder_node` | Z-order / layer order | Move to front/back or by index within parent |
| `convert_to_frame` | Convert to frame | Turn groups or shapes into auto-layout-capable frames |

## Grid and guide tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `set_grid` | Apply layout grids | Columns, rows, and grid patterns on frames |
| `get_grid` | Read layout grids | Inspect existing grid configuration |
| `set_guide` | Set page guides | Add horizontal and vertical guides |
| `get_guide` | Read page guides | Inspect existing guide positions |

## Annotation tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `set_annotation` | Add annotation | Label nodes with design notes (requires enableProposedApi) |
| `get_annotation` | Read annotations | Inspect annotation labels on nodes |

## Text tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `set_text_content` | Update text | Copy changes |
| `set_multiple_text_contents` | Batch update | Multi-element editing with chunked processing |
| `set_text_align` | H/V alignment | Align text or fix RTL languages |
| `set_font_name` | Typography | Apply brand font (family + style) |
| `set_font_size` | Text size | Create hierarchy |
| `set_font_weight` | Text weight | Bold/light variations |
| `set_text_style_id` | Apply text style | Use corporate typography |
| `set_letter_spacing` | Character spacing | Typography fine-tuning (pixels or percent) |
| `set_line_height` | Vertical spacing | Text readability (pixels, percent, or auto) |
| `set_paragraph_spacing` | Paragraph spacing | Content structure |
| `set_text_case` | Case transformation | UPPERCASE/lowercase/Title |
| `set_text_decoration` | Text styles | Underline/strikethrough |
| `get_styled_text_segments` | Text analysis | Rich text inspection by style property |
| `load_font_async` | Font loading | Custom font access |
| `fix_fonts` | Batch fix fonts | Fix misnamed fonts from auto-capture across a subtree |

## Component tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `create_component_instance` | Use components | Place component instances by key |
| `create_component_from_node` | Create component | Convert existing node into a reusable component |
| `create_component_set` | Create variants | Combine multiple components into a component set |
| `add_component_property` | Add property | Add text, boolean, instance swap, or variant properties |
| `get_component_properties` | Read properties | Inspect property definitions or current instance values |
| `set_component_property` | Set property values | Override text, boolean, or swap properties on instances |
| `link_component_property` | Link to text node | Bind a component property to a child text node |
| `set_instance_variant` | Change variant | Switch variant properties without recreating the instance |

## Variable tools (design tokens)

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `get_variables` | List variables | Get all variable collections, modes, and values |
| `set_variable` | Create/update variable | Define COLOR, FLOAT, STRING, or BOOLEAN variables |
| `apply_variable_to_node` | Bind variable | Bind a variable to a node property field |
| `delete_variable` | Delete variable | Remove a variable by ID |
| `delete_variable_collection` | Delete collection | Remove an entire collection and all its variables |
| `switch_variable_mode` | Switch mode | Change which mode's values are used on a node |

## Prototyping tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `get_reactions` | Read interactions | Get all prototyping reactions on a node |
| `add_reaction` | Add interaction | Create navigation links between frames (click, hover, drag, etc.) |
| `add_back_reaction` | Back/close action | Add navigate-back or close-overlay interactions |
| `add_url_reaction` | Open URL action | Add interactions that open external URLs |
| `remove_reactions` | Remove interactions | Remove all or specific reactions from a node |
| `get_flow_starting_points` | Read flows | Get all prototype flow starting points on current page |
| `set_flow_starting_point` | Set/remove flow start | Mark a top-level frame as a flow starting point |
| `set_prototype_device` | Device settings | Set prototype device frame (iPhone, Android, iPad, etc.) |
| `set_prototype_start_node` | Start node | Set the starting node for prototype presentation |

## FigJam tools

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `get_figjam_elements` | Read board contents | Inspect stickies, connectors, shapes, sections, stamps |
| `create_sticky` | Create sticky note | Add ideas, comments, or labels (10 color options) |
| `set_sticky_text` | Update sticky text | Edit existing sticky content |
| `create_shape_with_text` | Create labeled shape | Flowchart nodes, process boxes, decision diamonds |
| `create_connector` | Draw connector arrow | Link stickies or shapes (elbowed, straight, or curved) |
| `create_section` | Create section region | Group and organise content areas on the board |

## Compound tools (batch operations)

Compound tools combine multiple operations into a single call to reduce round-trips.

| Command | Purpose | Usage example |
|---------|---------|---------------|
| `create_frame_with_autolayout` | Frame + auto-layout | Create a frame with auto-layout in one step |
| `set_node_appearance` | Multi-property styling | Set fill, stroke, corner radius, and opacity at once |
| `bulk_create_nodes` | Batch create | Create multiple rectangles, frames, text, and ellipses in one call |
| `bulk_update_text` | Batch text update | Update text on multiple nodes with per-node error reporting |
| `get_all_components` | Full component catalog | List all local and remote components (supports filtering) |
| `create_instance_with_properties` | Place + configure | Create an instance and set properties/variants in one step |
| `swap_component_variant` | Batch variant swap | Change variant properties on multiple instances at once |
| `build_screen_from_template` | Build screen | Create an artboard and populate it with component instances |

## Understanding coordinate systems

Figma uses two coordinate systems:

- **Global coordinates** (`absoluteBoundingBox`): Position relative to canvas origin (0,0)
- **Local coordinates** (`localPosition`): Position relative to parent node

**When to use which:**
- `get_node_info` returns both `absoluteBoundingBox` (global) and `localPosition` (local)
- `move_node` expects local coordinates (same as create operations)
- To move a node to its current position, use `localPosition.x` and `localPosition.y`

**Example:**
```
Frame at (100, 50)
  -- Rectangle
     - absoluteBoundingBox: {x: 150, y: 80}  <- Global position
     - localPosition: {x: 50, y: 30}         <- Use for move_node
```

## Effective prompt examples

```
Good: "Create a dashboard with side navigation, a header with user 
profile, and a main area with metric cards"

Good: "Redesign this button component with hover states and 
better contrast ratios"

Good: "Analyze the accessibility of this screen and fix the 
contrast issues"

Good: "List all components, then build a login screen using
the Button and Input components from the design system"

Good: "Set up prototype interactions: clicking the login button
navigates to the dashboard with a smart animate transition"

Avoid: "Make it pretty" (too vague)

Avoid: "Improve the design" (no specific criteria)
```

## Usage tips

1. **Be specific:** The more detailed the instruction, the better the result
2. **Use references:** "Like the button in the previous section" helps maintain consistency
3. **Break down complex tasks:** It's better to make several small changes than one very large one
4. **Check selection:** Make sure the correct element is selected before requesting modifications
5. **Use compound tools:** For multi-step workflows, prefer compound tools like `build_screen_from_template` or `bulk_create_nodes` to reduce round-trips
6. **Discover components first:** Use `get_all_components` before placing instances to find the right component keys
