---
name: archer
description: Create interactive, telemetry-rich architecture mindmaps, network audit topologies, cloud infrastructure diagrams, and incident root-cause maps as standalone, zero-dependency HTML artifacts. Supports Left-to-Right and Top-to-Bottom flows, boundary grouping (VPCs/clusters), interactive BFS path tracing, animated cable flow pulses, and pure-SVG/PNG export. Use when the user asks to visualize system architecture, network proxy chains, infrastructure bottlenecks, request lifecycles, or cloud topologies.
license: MIT
metadata:
  version: "1.0.0"
  author: Archer Core Team
---

# Archer

Create self-contained, interactive architecture mindmaps and system topology diagrams from typed JSON specifications. Every diagram compiles into a standalone, zero-dependency HTML artifact with built-in SVG bezier cables, interactive BFS path tracing, and Figma/Miro pan & zoom controls.

## Fast Authoring Path for Agents

1. **Scaffold or Write JSON**:
   Start from one of the 4 built-in enterprise recipes or write a fresh JSON specification adhering to `schemas/archer.schema.json`.
   To scaffold:
   ```bash
   node bin/archer.mjs recipe <recipe-name> -o <candidate.json>
   ```
   Available recipes: `network-proxy-audit`, `cloud-infrastructure`, `microservices-ingress`, `incident-root-cause`.

2. **Minimal 3-Node "Hello World" Specification**:
   Every optional field has a truthful default:
   - `meta.flow`: `"lr"` (default) or `"tb"`
   - `meta.theme`: `"dark"`
   - `meta.animated`: `true`
   - `node.status`: `"ok"` (options: `"ok"`, `"warn"`, `"err"`, `"unknown"`)
   - `node.stage`: auto-computed via longest-path DAG if omitted
   - `node.lane`: auto-packed in array order (`0, 1, 2...`) if omitted
   - `node.hasInput` / `node.hasOutput`: `true`

   ```json
   {
     "meta": {
       "title": "Minimal 3-Node Flow",
       "subtitle": "Ingress to Database Pipeline",
       "flow": "lr"
     },
     "boundaries": [
       { "id": "b-internal", "title": "Internal Network", "category": "VPC", "color": "#3b82f6" }
     ],
     "nodes": [
       {
         "id": "client",
         "title": "Client App",
         "category": "INGRESS",
         "icon": "client",
         "stage": 0,
         "lane": 0,
         "metrics": "HTTPS / 443",
         "submetrics": "TLS 1.3"
       },
       {
         "id": "gateway",
         "title": "API Gateway",
         "category": "GATEWAY",
         "icon": "gateway",
         "boundary": "b-internal",
         "stage": 1,
         "lane": 0,
         "status": "ok",
         "statusText": "healthy",
         "metrics": "12.4k RPS",
         "submetrics": "P95 4ms"
       },
       {
         "id": "db",
         "title": "Primary DB",
         "category": "STORAGE",
         "icon": "database",
         "boundary": "b-internal",
         "stage": 2,
         "lane": 0,
         "status": "ok",
         "metrics": "Multi-AZ",
         "submetrics": "Active"
       }
     ],
     "edges": [
       { "from": "client", "to": "gateway", "label": "HTTPS Traffic", "color": "#38bdf8" },
       { "from": "gateway", "to": "db", "label": "SQL Queries", "color": "#34d399" }
     ]
   }
   ```

3. **Validate the Candidate**:
   Run the validator after authoring or editing:
   ```bash
   node bin/archer.mjs validate <candidate.json> --json
   ```
   - Exit code `0`: Valid specification.
   - Exit code `1`: Validation failed. Inspect the returned JSON `errors` array, repair the diagnosed fields, and rerun.

4. **Compile & Deliver Standalone HTML**:
   Once validation passes, compile the final artifact:
   ```bash
   node bin/archer.mjs build <candidate.json> -o <output.html>
   ```

---

## Authoring Invariants & Geometry Contract

- **Authoritative Node Envelope**:
  - `CARD_WIDTH = 310px`.
  - Deterministic card height formula:
    - Base envelope: `88px` (`card-header` 34px + `card-subtitle` 20px + `card-footer` 34px).
    - Optional alert strip: `+38px`.
    - Key-value detail rows: `+22px` per row.
    - Total Height: `88 + (hasAlert ? 38 : 0) + (details.length * 22)`.
  - Line Clamping: Title, subtitle, and detail values are strictly clamped to single lines with ellipsis. Never rely on CSS height expansion.

- **Unified Axis Terminology**:
  - Use `stage` for the primary axis along flow (0, 1, 2...).
  - Use `lane` for the cross-axis (0, 1, 2...).
  - Do NOT use direction-dependent aliases (`column`/`row`); flipping `meta.flow` between `"lr"` and `"tb"` retains consistent stage/lane semantics.

- **Boundary Membership**:
  - `nodes[].boundary` is the sole canonical source of truth.
  - `boundaries[]` provides display metadata (`title`, `category`, `color`, `icon`).
  - Never specify duplicate boundaries or assign a node to a non-existent boundary ID.

- **Three Edge Classes & Routing**:
  1. **Forward** (`target.stage > source.stage`): Standard cubic Bezier curve, solid line.
  2. **Lateral** (`target.stage === source.stage`): Offset arc routed through the inter-lane gap, solid line (avoids back-edge styling).
  3. **Back** (`target.stage < source.stage`): Arched track routed over/under nodes, dashed line.
  - Cycles are permitted; the validator warns and the layout routes cycle-closing links as arched back-edges.

- **Performance Bounding**:
  - Target scale: Smooth 60fps pan/zoom up to ≤200 nodes and ≤400 edges. Keep topology diagrams focused and avoid overwhelming density.

- **Icon Glyphs**:
  - Built-in vector icons: `client`, `server`, `database`, `gateway`, `shield`, `cloud`, `queue`, `globe`, `alert`, `check`, `cpu`, `terminal`, `network`, `lock`.
  - Emoji or custom characters can also be passed directly in the `icon` field.
