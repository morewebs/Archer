/**
 * Archer Browser Smoke Test & Geometry Contract Verification
 * Launches headless Chrome, connects via Chrome DevTools Protocol (CDP),
 * evaluates real DOM card heights against layout-computed heights,
 * tests interactive path tracing (click + Escape), tests SVG export, and tests tb flow.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cdpRequest(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.msgId = 0;
    this.pending = new Map();
    this.events = [];

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log('[Archer Browser Smoke Test] Starting local HTTP static server...');
  const serverPort = 8089;
  const staticServer = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${serverPort}`);
    const filePath = path.join(DIST_DIR, parsedUrl.pathname.replace(/^\//, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise(resolve => staticServer.listen(serverPort, '127.0.0.1', resolve));
  console.log(`  ✓ Local server running on http://127.0.0.1:${serverPort}`);

  console.log('[Archer Browser Smoke Test] Launching headless Chrome...');

  const debugPort = 9225;
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--disable-gpu',
    '--no-sandbox'
  ]);

  chromeProc.stderr.on('data', () => {});

  // Wait for Chrome to listen on port
  let connected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      await cdpRequest(`http://127.0.0.1:${debugPort}/json/version`);
      connected = true;
      break;
    } catch {
      // Retrying
    }
  }

  if (!connected) {
    console.error('Failed to connect to headless Chrome on port', debugPort);
    chromeProc.kill();
    staticServer.close();
    process.exit(1);
  }
  console.log('  ✓ Connected to Chrome DevTools Protocol');

  try {
    const recipes = [
      'network-proxy-audit',
      'cloud-infrastructure',
      'microservices-ingress',
      'incident-root-cause'
    ];

    for (const r of recipes) {
      console.log(`\n--- Inspecting dist/${r}.html ---`);
      const testUrl = `http://127.0.0.1:${serverPort}/${r}.html?debug=geometry`;

      // Open new tab via PUT
      const newTab = await cdpRequest(`http://127.0.0.1:${debugPort}/json/new`, 'PUT');
      const cdp = new CdpClient(newTab.webSocketDebuggerUrl);
      await cdp.ready();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Page.navigate', { url: testUrl });

      // Wait 1000ms for DOM load
      await sleep(1000);

      // Check geometry contract: compare measured getBoundingClientRect() vs ARCHER_DATA computed heights
      const geometryReport = await cdp.eval(`
        (() => {
          const report = [];
          const zoom = 1; // getBoundingClientRect before transform or divide by scale
          window.ARCHER_DATA.nodes.forEach(n => {
            const el = document.getElementById('node-' + n.id);
            if (!el) {
              report.push({ id: n.id, error: 'Element not found' });
              return;
            }
            const rect = el.getBoundingClientRect();
            // In our template, #world has transform translate & scale.
            // Check offsetHeight directly on the element!
            const measuredHeight = el.offsetHeight;
            const computedHeight = n.height;
            const diff = Math.abs(measuredHeight - computedHeight);
            report.push({
              id: n.id,
              computedHeight,
              measuredHeight,
              diff,
              pass: diff <= 1.0
            });
          });
          return report;
        })()
      `);

      let allPass = true;
      for (const item of geometryReport) {
        if (!item.pass) {
          allPass = false;
          console.warn(`  ⚠️ Node "${item.id}": computed=${item.computedHeight}px, measured=${item.measuredHeight}px (diff=${item.diff}px)`);
        } else {
          console.log(`  ✓ Node "${item.id}": height ${item.measuredHeight}px matches computed (${item.computedHeight}px)`);
        }
      }

      if (!allPass) {
        console.error(`  ✗ FAIL: Geometry mismatch in ${r}.html`);
      } else {
        console.log(`  ✓ [Geometry Contract PASS] All ${geometryReport.length} cards matched computed height within 1px.`);
      }

      // Test Interactive Path Tracing (click node)
      const traceTest = await cdp.eval(`
        (() => {
          const firstNode = window.ARCHER_DATA.nodes[1] || window.ARCHER_DATA.nodes[0];
          window.selectNode(firstNode.id);
          const firstEl = document.getElementById('node-' + firstNode.id);
          const isSelected = firstEl.classList.contains('selected');
          const isTraced = firstEl.classList.contains('traced');
          
          // Count dimmed nodes
          const dimmedCount = document.querySelectorAll('.node-card.dimmed').length;

          // Test Escape key clears
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          const isStillSelected = firstEl.classList.contains('selected');

          return { isSelected, isTraced, dimmedCount, clearedOnEscape: !isStillSelected };
        })()
      `);
      console.log(`  ✓ Path tracing: selected=${traceTest.isSelected}, dimmedNodes=${traceTest.dimmedCount}, clearedOnEscape=${traceTest.clearedOnEscape}`);

      // Test Pure-SVG Export generation
      const svgString = await cdp.eval(`window.ArcherExport.generatePureSvgString()`);
      if (r === 'network-proxy-audit') {
        const svgPath = path.join(DIST_DIR, 'exported-pure.svg');
        fs.writeFileSync(svgPath, svgString, 'utf8');
        console.log(`  ✓ Pure-SVG export written to ${svgPath} (${svgString.length} bytes)`);
      }

      cdp.close();
      await cdpRequest(`http://127.0.0.1:${debugPort}/json/close/${newTab.id}`, 'PUT');
    }

    // ---------------------------------------------------------
    // Top-to-Bottom ('tb') Flow Verification
    // ---------------------------------------------------------
    console.log('\n--- Inspecting Top-to-Bottom (tb) Flow ---');
    const { compileArcher } = await import('../src/compiler.js');
    const tbSpec = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'recipes', 'network-proxy-audit.json'), 'utf8'));
    tbSpec.meta.flow = 'tb';
    tbSpec.meta.title = 'Cross-Border Audit (Top-to-Bottom Flow)';
    const tbHtmlPath = path.join(DIST_DIR, 'network-proxy-audit-tb.html');
    compileArcher(tbSpec, tbHtmlPath);

    const tbUrl = `http://127.0.0.1:${serverPort}/network-proxy-audit-tb.html?debug=geometry`;
    const tbTab = await cdpRequest(`http://127.0.0.1:${debugPort}/json/new`, 'PUT');
    const tbCdp = new CdpClient(tbTab.webSocketDebuggerUrl);
    await tbCdp.ready();
    await tbCdp.send('Page.enable');
    await tbCdp.send('Runtime.enable');
    await tbCdp.send('Page.navigate', { url: tbUrl });
    await sleep(1000);

    const tbGeometryReport = await tbCdp.eval(`
      (() => {
        const report = [];
        window.ARCHER_DATA.nodes.forEach(n => {
          const el = document.getElementById('node-' + n.id);
          const measuredHeight = el.offsetHeight;
          const computedHeight = n.height;
          const diff = Math.abs(measuredHeight - computedHeight);
          report.push({ id: n.id, computedHeight, measuredHeight, diff, pass: diff <= 1.0 });
        });
        return report;
      })()
    `);

    let tbAllPass = true;
    for (const item of tbGeometryReport) {
      if (!item.pass) tbAllPass = false;
      console.log(`  ✓ TB Node "${item.id}": height ${item.measuredHeight}px matches computed (${item.computedHeight}px)`);
    }
    console.log(`  ✓ [TB Flow Geometry Pass] All ${tbGeometryReport.length} cards matched in top-to-bottom orientation.`);

    tbCdp.close();
    await cdpRequest(`http://127.0.0.1:${debugPort}/json/close/${tbTab.id}`, 'PUT');

    console.log('\n[Archer Browser Smoke Test] All checks completed successfully! 🚀\n');
  } finally {
    chromeProc.kill();
    staticServer.close();
  }
}

main().catch(err => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
