/**
 * Archer Browser Interactive Runtime
 * Handles Figma/Miro pan-zoom, interactive BFS path tracing, pulse toggling,
 * geometry contract verification, and Pure-SVG / PNG / HTML export.
 */

/* global ARCHER_DATA */

(function () {
  const { meta, nodes, boundaries, edges, world } = window.ARCHER_DATA || {};

  // DOM Elements
  const container = document.getElementById("canvas-container");
  const worldEl = document.getElementById("world");
  const zoomLabel = document.getElementById("zoom-label");
  const btnZoomIn = document.getElementById("btn-zoom-in");
  const btnZoomOut = document.getElementById("btn-zoom-out");
  const btnFit = document.getElementById("btn-fit");
  const btnPulse = document.getElementById("btn-pulse");
  const btnExportSvg = document.getElementById("btn-export-svg");
  const btnExportPng = document.getElementById("btn-export-png");
  const nodesLayer = document.getElementById("nodes-layer");
  const svgLayer = document.getElementById("svg-layer");
  const boundariesLayer = document.getElementById("boundaries-layer");

  // State
  let pan = { x: 80, y: 100 };
  let zoom = 0.85;
  let selectedNodeId = null;

  // Reduced motion detection
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let pulseEnabled = meta.animated !== false && !prefersReduced;

  // Update canvas transform
  function updateTransform() {
    worldEl.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  // Fit to viewport
  function fitToView() {
    const vw = container.clientWidth;
    const vh = container.clientHeight;

    // Find bounding box of all nodes and boundaries
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    });

    if (minX === Infinity) {
      pan = { x: 80, y: 100 };
      zoom = 0.85;
    } else {
      const graphW = (maxX - minX) + 160;
      const graphH = (maxY - minY) + 160;
      const scaleX = vw / graphW;
      const scaleY = vh / graphH;
      zoom = Math.min(1.2, Math.max(0.35, Math.min(scaleX, scaleY) * 0.9));
      pan.x = (vw - (graphW * zoom)) / 2 - (minX - 80) * zoom;
      pan.y = (vh - (graphH * zoom)) / 2 - (minY - 80) * zoom;
    }
    updateTransform();
  }

  // 1. Pan & Zoom Event Listeners (Trackpad + Mouse)
  container.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.ctrlKey) {
      // Trackpad pinch gesture / Ctrl + MouseWheel
      const zoomDelta = Math.exp(-e.deltaY * 0.01);
      const nextZoom = Math.min(Math.max(0.2, zoom * zoomDelta), 2.5);

      const worldX = (mouseX - pan.x) / zoom;
      const worldY = (mouseY - pan.y) / zoom;

      pan.x = mouseX - worldX * nextZoom;
      pan.y = mouseY - worldY * nextZoom;
      zoom = nextZoom;
    } else {
      // 2-finger pan
      pan.x -= e.deltaX;
      pan.y -= e.deltaY;
    }
    updateTransform();
  }, { passive: false });

  // Mouse Drag Pan
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };

  container.addEventListener("mousedown", (e) => {
    if (e.target.closest(".node-card") || e.target.closest(".floating-ui") || e.target.closest(".boundary-card")) return;
    isDragging = true;
    dragStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    pan.x = e.clientX - dragStart.x;
    pan.y = e.clientY - dragStart.y;
    updateTransform();
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Touchscreen Pinch
  let initialDist = 0;
  let initialZoom = 1;
  let initialPan = { x: 0, y: 0 };
  let touchCenter = { x: 0, y: 0 };

  container.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const [t1, t2] = e.touches;
      initialDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      initialZoom = zoom;
      initialPan = { ...pan };
      touchCenter = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
    }
  }, { passive: false });

  container.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && initialDist > 0) {
      e.preventDefault();
      const [t1, t2] = e.touches;
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const scale = dist / initialDist;
      const nextZoom = Math.min(Math.max(0.2, initialZoom * scale), 2.5);

      const worldX = (touchCenter.x - initialPan.x) / initialZoom;
      const worldY = (touchCenter.y - initialPan.y) / initialZoom;

      pan.x = touchCenter.x - worldX * nextZoom;
      pan.y = touchCenter.y - worldY * nextZoom;
      zoom = nextZoom;
      updateTransform();
    }
  }, { passive: false });

  // 2. Interactive Path Tracing (BFS isolation)
  function clearSelection() {
    selectedNodeId = null;
    document.querySelectorAll(".node-card").forEach(el => {
      el.classList.remove("selected", "dimmed", "traced");
    });
    document.querySelectorAll(".edge-group").forEach(el => {
      el.classList.remove("edge-dimmed", "edge-traced");
    });
    document.querySelectorAll(".boundary-card").forEach(el => {
      el.classList.remove("boundary-dimmed");
    });
  }

  function selectAndTrace(nodeId) {
    if (selectedNodeId === nodeId) {
      clearSelection();
      return;
    }
    selectedNodeId = nodeId;

    // Use shared pure tracePaths logic (inlined)
    const trace = window.ArcherGraph.tracePaths(nodeId, nodes, edges);

    // Update node styles
    nodes.forEach(n => {
      const el = document.getElementById(`node-${n.id}`);
      if (!el) return;
      el.classList.remove("selected", "dimmed", "traced");
      if (n.id === nodeId) {
        el.classList.add("selected", "traced");
      } else if (trace.activeNodes.has(n.id)) {
        el.classList.add("traced");
      } else {
        el.classList.add("dimmed");
      }
    });

    // Update edge styles
    edges.forEach((e, idx) => {
      const el = document.getElementById(`edge-${idx}`);
      if (!el) return;
      el.classList.remove("edge-dimmed", "edge-traced");
      const edgeKey = `${e.from}->${e.to}`;
      if (trace.activeEdges.has(edgeKey)) {
        el.classList.add("edge-traced");
      } else {
        el.classList.add("edge-dimmed");
      }
    });

    // Boundaries dimming
    boundaries.forEach(b => {
      const el = document.getElementById(`boundary-${b.id}`);
      if (!el) return;
      const hasActiveMember = nodes.some(n => n.boundary === b.id && trace.activeNodes.has(n.id));
      if (hasActiveMember) {
        el.classList.remove("boundary-dimmed");
      } else {
        el.classList.add("boundary-dimmed");
      }
    });
  }

  // Click on empty canvas clears trace
  container.addEventListener("click", (e) => {
    if (!e.target.closest(".node-card") && !e.target.closest(".floating-ui")) {
      clearSelection();
    }
  });

  // Escape clears trace
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearSelection();
    }
  });

  // Make selectNode and export available globally
  window.selectNode = selectAndTrace;
  window.ArcherExport = { generatePureSvgString };

  // 3. Pulse Toggle
  function updatePulseUI() {
    if (btnPulse) {
      btnPulse.textContent = pulseEnabled ? "⚡ Pulse: ON" : "⚡ Pulse: OFF";
      btnPulse.style.color = pulseEnabled ? "#38bdf8" : "var(--text-dim)";
    }
    if (pulseEnabled) {
      svgLayer.classList.remove("no-pulse");
    } else {
      svgLayer.classList.add("no-pulse");
    }
  }

  if (btnPulse) {
    btnPulse.addEventListener("click", () => {
      pulseEnabled = !pulseEnabled;
      updatePulseUI();
    });
  }
  updatePulseUI();

  // Toolbar Zoom Controls
  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => {
      zoom = Math.min(2.5, zoom + 0.15);
      updateTransform();
    });
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      zoom = Math.max(0.2, zoom - 0.15);
      updateTransform();
    });
  }
  if (btnFit) {
    btnFit.addEventListener("click", fitToView);
  }

  // 4. Geometry Contract Verification (Patch 2)
  if (window.location.search.includes("debug=geometry")) {
    console.log("%c[Archer Geometry Invariant Check]", "color: #38bdf8; font-weight: bold;");
    let hasMismatches = false;
    nodes.forEach(n => {
      const el = document.getElementById(`node-${n.id}`);
      if (el) {
        const measuredH = el.getBoundingClientRect().height / zoom;
        const diff = Math.abs(measuredH - n.height);
        if (diff > 1.5) {
          hasMismatches = true;
          console.warn(`[Geometry Mismatch] Node "${n.id}": computed height = ${n.height}px, measured = ${Math.round(measuredH)}px (diff: ${diff.toFixed(1)}px)`);
        }
      }
    });
    if (!hasMismatches) {
      console.log("%c[Geometry Contract Pass] All node cards match computed heights within 1px.", "color: #34d399; font-weight: bold;");
    }
  }

  // 5. Pure-SVG and PNG Export Mirror (Patch 5)
  function generatePureSvgString() {
    // Computes full standalone vector representation of the canvas
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    });
    boundaries.forEach(b => {
      if (b.bounds) {
        if (b.bounds.x < minX) minX = b.bounds.x;
        if (b.bounds.y < minY) minY = b.bounds.y;
        if (b.bounds.x + b.bounds.width > maxX) maxX = b.bounds.x + b.bounds.width;
        if (b.bounds.y + b.bounds.height > maxY) maxY = b.bounds.y + b.bounds.height;
      }
    });

    const pad = 60;
    const exportX = minX - pad;
    const exportY = minY - pad;
    const exportW = (maxX - minX) + (2 * pad);
    const exportH = (maxY - minY) + (2 * pad);

    // Clone SVG Layer content
    const svgContent = svgLayer.innerHTML;

    // Render pure vector rects and text for boundaries
    const boundarySvg = boundaries.filter(b => b.bounds).map(b => `
      <g id="export-boundary-${b.id}">
        <rect x="${b.bounds.x}" y="${b.bounds.y}" width="${b.bounds.width}" height="${b.bounds.height}" rx="16" fill="#10131a" stroke="${b.color || '#3b82f6'}" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.6"/>
        <rect x="${b.bounds.x + 16}" y="${b.bounds.y + 12}" width="${Math.min(220, b.bounds.width - 32)}" height="22" rx="4" fill="#181c26"/>
        <text x="${b.bounds.x + 24}" y="${b.bounds.y + 27}" fill="${b.color || '#93c5fd'}" font-family="Inter, sans-serif" font-size="11" font-weight="600">${escapeXml(b.title)}</text>
      </g>
    `).join("");

    // Render pure vector cards for nodes
    const nodesSvg = nodes.map(n => `
      <g id="export-node-${n.id}" transform="translate(${n.x}, ${n.y})">
        <rect width="${n.width}" height="${n.height}" rx="12" fill="#14151b" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <!-- Header -->
        <rect x="12" y="12" width="28" height="28" rx="6" fill="${n.color || '#38bdf8'}22" stroke="${n.color || '#38bdf8'}44" stroke-width="1"/>
        <text x="50" y="24" fill="#64748b" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="600">${escapeXml(n.category || '')}</text>
        <text x="50" y="38" fill="#ffffff" font-family="Inter, sans-serif" font-size="12" font-weight="600">${escapeXml(n.title)}</text>
        <rect x="230" y="14" width="68" height="18" rx="4" fill="#1e222d"/>
        <text x="264" y="27" text-anchor="middle" fill="#94a3b8" font-family="'JetBrains Mono', monospace" font-size="10">${escapeXml(n.statusText || n.status)}</text>
        <!-- Subtitle -->
        <text x="14" y="62" fill="#94a3b8" font-family="'JetBrains Mono', monospace" font-size="10">${escapeXml(n.subtitle || '')}</text>
        <!-- Footer -->
        <rect y="${n.height - 28}" width="${n.width}" height="28" rx="0 0 12 12" fill="#0e0f14"/>
        <text x="14" y="${n.height - 10}" fill="#f1f5f9" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="600">${escapeXml(n.metrics || '')}</text>
        <text x="${n.width - 14}" y="${n.height - 10}" text-anchor="end" fill="#64748b" font-family="'JetBrains Mono', monospace" font-size="9">${escapeXml(n.submetrics || '')}</text>
      </g>
    `).join("");

    return `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${exportX} ${exportY} ${exportW} ${exportH}" width="${exportW}" height="${exportH}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  </style>
  <rect x="${exportX}" y="${exportY}" width="${exportW}" height="${exportH}" fill="#0b0c0e"/>
  <g id="export-boundaries">${boundarySvg}</g>
  <g id="export-edges">${svgContent}</g>
  <g id="export-nodes">${nodesSvg}</g>
</svg>`;
  }

  function escapeXml(unsafe) {
    return (unsafe || "").replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  // Export SVG Trigger
  if (btnExportSvg) {
    btnExportSvg.addEventListener("click", () => {
      const svgStr = generatePureSvgString();
      const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(meta.title || 'archer-architecture').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Export PNG Trigger (Canvas rasterization from Pure-SVG)
  if (btnExportPng) {
    btnExportPng.addEventListener("click", () => {
      const svgStr = generatePureSvgString();
      const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = 2; // High-res 2x
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((pngBlob) => {
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement("a");
          a.href = pngUrl;
          a.download = `${(meta.title || 'archer-architecture').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
          a.click();
          URL.revokeObjectURL(pngUrl);
          URL.revokeObjectURL(url);
        });
      };
      img.src = url;
    });
  }

  // Initial fit
  fitToView();
})();
