/** Lista os funis (pipelines) da conta — somente leitura. */
const cfg = require('../src/config');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: cfg.paths.storageState });
  try {
    const r = await context.request.get(`${cfg.baseUrl}/api/v4/leads/pipelines`, {
      headers: { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' },
    });
    const j = await r.json();
    for (const p of j._embedded.pipelines) {
      console.log(`${p.id}  ${p.name}${p.is_main ? '  (principal)' : ''}  — etapas: ${p._embedded.statuses.map((s) => s.name).join(', ')}`);
    }
  } finally {
    await browser.close();
  }
})();
