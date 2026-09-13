/**
 * Archer Compiler
 * Validates specifications, computes deterministic layout, and compiles the
 * complete self-contained HTML artifact with zero runtime external dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec } from './validator.js';
import { computeLayout } from './layout.js';
import { renderIcon } from './icons.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Strips ES module export keywords for direct script inlining
 */
function stripExports(code) {
  return code
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+/g, '')
    .replace(/import\s+.*?from\s+['"].*?['"];?/g, '');
}

/**
 * Compiles an Archer specification into standalone HTML
 * @param {object} spec Specification JSON
 * @param {string} [outputPath] Optional target file path
 * @returns {string} Compiled HTML string
 */
export function compileArcher(spec, outputPath) {
  // 1. Validation
  const validation = validateSpec(spec);
  if (!validation.valid) {
    const err = new Error(`Specification validation failed:\n - ${validation.errors.join('\n - ')}`);
    err.diagnostics = validation;
    throw err;
  }

  // 2. Deterministic Layout Computation
  const layout = computeLayout(spec);

  // 3. Load Template and Inlined Sources
  const templatePath = path.join(__dirname, 'template.html');
  const graphJsPath = path.join(__dirname, 'graph.js');
  const runtimeJsPath = path.join(__dirname, 'runtime.js');

  const template = fs.readFileSync(templatePath, 'utf8');
  const graphJs = stripExports(fs.readFileSync(graphJsPath, 'utf8'));
  const runtimeJs = fs.readFileSync(runtimeJsPath, 'utf8');

  // 4. Render Boundaries Layer
  const boundariesHtml = layout.boundaries.filter(b => b.bounds !== null).map(b => {
    const bounds = b.bounds;
    const accent = b.color || '#3b82f6';
    const iconHtml = b.icon ? renderIcon(b.icon) : '';
    return `
      <div 
        id="boundary-${b.id}" 
        class="boundary-card font-mono" 
        style="transform: translate(${bounds.x}px, ${bounds.y}px); width: ${bounds.width}px; height: ${bounds.height}px; border-color: ${accent}55;"
      >
        <div class="boundary-header" style="color: ${accent}; border-color: ${accent}44;">
          ${iconHtml ? `<span style="display:flex;align-items:center;">${iconHtml}</span>` : ''}
          <span>${escapeHtml(b.title)}</span>
          ${b.category ? `<span style="color: var(--text-dim); font-size: 9px;">[${escapeHtml(b.category)}]</span>` : ''}
        </div>
      </div>
    `;
  }).join('\n');

  // 5. Render Edges SVG Layer
  const edgesHtml = layout.edges.filter(e => e.valid).map((e, idx) => {
    const strokeColor = e.color || (e.status === 'err' ? '#fb7185' : e.status === 'warn' ? '#fbbf24' : '#60a5fa');
    const isPulsing = e.animated !== false && layout.meta.animated;
    const pulseClass = isPulsing ? 'cable-pulsing' : '';
    const isDashed = Boolean(e.dashed);

    return `
      <g id="edge-${idx}" class="edge-group">
        <!-- Shadow base line -->
        <path d="${e.pathData}" fill="none" stroke="#050608" stroke-width="7" stroke-linecap="round"></path>
        <!-- Track line -->
        <path d="${e.pathData}" fill="none" stroke="#1e222d" stroke-width="4" stroke-linecap="round"></path>
        <!-- Visible cable -->
        <path 
          d="${e.pathData}" 
          class="edge-cable ${pulseClass}" 
          fill="none" 
          stroke="${strokeColor}" 
          stroke-width="2.5" 
          ${isDashed ? 'stroke-dasharray="6 5"' : ''} 
          stroke-linecap="round"
        ></path>
        <!-- Edge label pill -->
        ${e.label ? `
          <foreignObject x="${Math.round(e.midX - 120)}" y="${Math.round(e.midY - 13)}" width="240" height="26">
            <div style="display: flex; justify-content: center; pointer-events: none;">
              <span class="font-mono" style="background: #14161f; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.14); padding: 2px 8px; border-radius: 4px; font-size: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.6); white-space: nowrap;">
                ${escapeHtml(e.label)}
              </span>
            </div>
          </foreignObject>
        ` : ''}
      </g>
    `;
  }).join('\n');

  // 6. Render Nodes Layer
  const nodesHtml = layout.nodes.map(n => {
    const accent = n.color || '#38bdf8';
    const statusText = n.statusText || n.status || 'ok';
    const iconHtml = renderIcon(n.icon);

    return `
      <div 
        id="node-${n.id}" 
        class="node-card" 
        style="transform: translate(${n.x}px, ${n.y}px);"
        onclick="window.selectNode('${n.id}')"
      >
        <!-- Ports -->
        ${n.hasInput ? '<div class="port port-in"></div>' : ''}
        ${n.hasOutput ? '<div class="port port-out"></div>' : ''}

        <!-- Card Header -->
        <div class="card-header">
          <div class="card-brand">
            <div class="card-icon" style="background: ${accent}1c; border: 1px solid ${accent}44; color: ${accent};">
              ${iconHtml}
            </div>
            <div class="card-titles font-mono">
              <div class="card-category">${escapeHtml(n.category || '')}</div>
              <div class="card-title" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</div>
            </div>
          </div>
          <span class="status-badge status-${n.status} font-mono">${escapeHtml(statusText)}</span>
        </div>

        <!-- Subtitle -->
        <div class="card-subtitle font-mono" title="${escapeHtml(n.subtitle || '')}">${escapeHtml(n.subtitle || '')}</div>

        <!-- Optional Alert Strip -->
        ${n.alert ? `
          <div class="card-alert font-mono" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5;">
            ${(n.alert.startsWith('💥') || n.alert.startsWith('⚠️') || n.alert.startsWith('🚨') || n.alert.startsWith('🔥')) ? '' : '<span>⚠️</span>'}
            <span>${escapeHtml(n.alert)}</span>
          </div>
        ` : ''}

        <!-- Detail Rows -->
        ${n.details && n.details.length > 0 ? `
          <div class="card-details font-mono">
            ${n.details.map(d => `
              <div class="detail-row">
                <span class="detail-key">${escapeHtml(d.k)}:</span>
                <span class="detail-val" title="${escapeHtml(d.v)}">${escapeHtml(d.v)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Footer Strip -->
        <div class="card-footer font-mono">
          <span class="metric">${escapeHtml(n.metrics || '')}</span>
          <span class="submetric">${escapeHtml(n.submetrics || '')}</span>
        </div>
      </div>
    `;
  }).join('\n');

  // Subtitle HTML
  const subtitleHtml = layout.meta.subtitle
    ? `<div class="ribbon-subtitle font-mono">${escapeHtml(layout.meta.subtitle)}</div>`
    : '';

  // Safe serialized dataset
  const serializedData = JSON.stringify(layout);

  // 7. Inject Everything into Template Shell
  let outputHtml = template
    .replace(/<!-- ARCHER_META_STAMP -->/g, '<meta name="generator" content="archer@1.0.0" />')
    .replace(/<!-- ARCHER_TITLE -->/g, escapeHtml(layout.meta.title || 'Archer Mindmap'))
    .replace(/<!-- ARCHER_FLOW -->/g, (layout.meta.flow || 'lr').toUpperCase())
    .replace(/<!-- ARCHER_SUBTITLE_HTML -->/g, subtitleHtml)
    .replace(/<!-- ARCHER_WORLD_WIDTH -->/g, String(layout.world.width))
    .replace(/<!-- ARCHER_WORLD_HEIGHT -->/g, String(layout.world.height))
    .replace(/<!-- ARCHER_BOUNDARIES_HTML -->/g, boundariesHtml)
    .replace(/<!-- ARCHER_EDGES_HTML -->/g, edgesHtml)
    .replace(/<!-- ARCHER_NODES_HTML -->/g, nodesHtml)
    .replace(/<!-- ARCHER_DATA_JSON -->/g, serializedData)
    .replace(/<!-- ARCHER_GRAPH_JS -->/g, graphJs)
    .replace(/<!-- ARCHER_RUNTIME_JS -->/g, runtimeJs);

  // 8. Output to file if requested
  if (outputPath) {
    const resolvedPath = path.resolve(outputPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, outputHtml, 'utf8');
  }

  return outputHtml;
}
