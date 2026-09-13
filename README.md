# Archer 🏹

> **Enterprise Architecture Mindmap & System Topology Compiler**
> Zero-dependency Node.js framework for AI agents and engineers to design, validate, and compile interactive, telemetry-rich architecture mindmaps into standalone, offline-safe HTML artifacts.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node: >=18](https://img.shields.io/badge/Node-%3E%3D18-green.svg)
![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen.svg)

---

## Highlights

- **Zero External Dependencies**: Pure standard Node.js libraries (`node:fs`, `node:path`, `node:child_process`). Instant execution and 100% portable.
- **Authoritative Node-Side Geometry**: Deterministic envelope calculation (`CARD_WIDTH = 310px`, formula-computed card heights, exact port fan-out spreading). The compiler and the browser renderer never disagree.
- **Interactive BFS Path Tracing**: Clicking any node isolates and illuminates its entire upstream (ancestor) and downstream (descendant) critical paths while dimming unrelated nodes and cables. Press `Escape` or click empty canvas to clear.
- **Figma & Miro Standard Navigation**: Smooth trackpad pinch-to-zoom (`ctrl + wheel`), 2-finger pan, mouse drag, touchscreen pinch, and one-click `Fit to View`.
- **Three-Class Edge Routing**: Automatic classification of edges into **Forward** (cubic Bezier), **Lateral** (same-stage inter-lane arcs), and **Back** (overhead arched dashed tracks) with full cycle tolerance.
- **Pure-SVG & High-Res PNG Export**: Deterministic geometry allows generating a pure-vector SVG mirror, eliminating `foreignObject` Safari rendering bugs and guaranteeing crisp PNG export.
- **Enterprise Container Boundaries**: First-class boundary frames (VPCs, regions, Kubernetes clusters, security DMZs) that enclose member nodes with badges and subtle theme tints.
- **Offline-Safe Typography**: Google Fonts (`Inter` + `JetBrains Mono`) with system font fallbacks (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Cascadia Code`, `Consolas`).

---

## Installation & Quickstart

```bash
# Clone or navigate to the repository
cd Archer

# Run the test suite
node tests/test-archer.mjs

# List built-in enterprise recipes
node bin/archer.mjs list-recipes

# Scaffold a candidate specification from a recipe
node bin/archer.mjs recipe network-proxy-audit -o my-audit.json

# Validate specification syntax, integrity, and cycles
node bin/archer.mjs validate my-audit.json

# Compile into standalone HTML
node bin/archer.mjs build my-audit.json -o dist/my-audit.html
```

---

## CLI Reference

```
Usage:
  archer validate <spec.json> [--json]
  archer build <spec.json> [-o <output.html>]
  archer recipe <name> [-o <output.json>]
  archer list-recipes
  archer --help
```

### Exit Codes & CI Integration
- `0`: Valid specification / successful build.
- `1`: Validation error / file not found / invalid syntax.
- `--json`: Outputs machine-readable diagnostic receipts:
  ```json
  {
    "valid": true,
    "errors": [],
    "warnings": [],
    "stats": {
      "nodeCount": 4,
      "edgeCount": 3,
      "boundaryCount": 3,
      "cycleCount": 0
    }
  }
  ```

---

## Specification Schema

```json
{
  "meta": {
    "title": "My System Topology",
    "subtitle": "Request lifecycle & dataflow",
    "flow": "lr",
    "theme": "dark",
    "animated": true
  },
  "boundaries": [
    {
      "id": "b-cloud",
      "title": "AWS VPC us-east-1",
      "category": "CLOUD VPC",
      "color": "#3b82f6",
      "icon": "cloud"
    }
  ],
  "nodes": [
    {
      "id": "ingress-gw",
      "title": "API Gateway",
      "subtitle": "api.domain.com:443",
      "category": "GATEWAY",
      "icon": "gateway",
      "color": "#38bdf8",
      "status": "ok",
      "statusText": "healthy",
      "metrics": "14.2k RPS",
      "submetrics": "12ms P95",
      "alert": null,
      "boundary": "b-cloud",
      "stage": 0,
      "lane": 0,
      "details": [
        { "k": "Protocol", "v": "HTTP/2 & gRPC" },
        { "k": "TLS", "v": "TLS 1.3" }
      ]
    }
  ],
  "edges": [
    {
      "from": "ingress-gw",
      "to": "order-svc",
      "label": "gRPC /orders/checkout",
      "color": "#60a5fa",
      "status": "ok"
    }
  ]
}
```

---

## Built-in Enterprise Recipes

1. **`network-proxy-audit`**: Multi-hop proxy chain (HAProxy, AmneziaWG userspace tunnel relay, remote VPS exit POP) highlighting MTU splits and CPU context-switching bottlenecks.
2. **`cloud-infrastructure`**: Multi-tier AWS VPC architecture (Cloudflare WAF, ALB, EKS microservices, Aurora PostgreSQL, Redis cache) wrapped in boundary subnets.
3. **`microservices-ingress`**: Async event streaming pipeline (API Gateway, Order Service, lateral Inventory Service lock, Apache Kafka, Payment Worker, and WebSocket feedback loop).
4. **`incident-root-cause`**: Outage post-mortem diagram displaying database connection pool exhaustion, cascading 504 Gateway Timeouts, and thread deadlocks.

---

## Architecture Principles

1. **Deterministic Geometry**: `layout.js` computes node envelopes, port offsets, and boundary boxes before compilation. Browser CSS uses line clamping to guarantee matching heights.
2. **Canonical Boundary Truth**: `nodes[].boundary` is the sole source of truth for container assignment; `boundaries[]` defines metadata only.
3. **Cycle Tolerant**: DFS back-edge detection identifies cycles, issues diagnostics, and routes feedback links as arched dashed tracks without breaking forward layout staging.
4. **Offline-Safe**: All scripts, SVGs, and runtime engines are inlined directly into a single HTML file with no external asset requirements.

---

## License

MIT © Archer Core Team
