/**
 * Calibração fase 4 (somente leitura):
 *  A) No assistente de duplicatas: atributos dos elementos "Abrir detalhes"
 *     (js-open_card) para extrair os IDs dos leads de cada tela.
 *  B) Numa página de lead: estrutura do seletor de funil/etapa (para depois
 *     mover o lead unificado ao pipeline 12347316). Abre o dropdown, lista as
 *     opções e fecha com Escape — não altera nada.
 */
const cfg = require('../src/config');
const { abrirNavegador } = require('../src/navegador');

(async () => {
  const { browser, page } = await abrirNavegador({ headless: true, bloquearRecursos: true });
  try {
    // ---------- A) IDs no assistente ----------
    await page.goto(`${cfg.baseUrl}/leads/pipeline/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    await page.locator('.button-input-more button.button-input-with-menu').first().click();
    await page.waitForTimeout(800);
    await page.locator('.button-input__context-menu__item', { hasText: /localizar duplicatas/i }).first().click();
    await page.waitForSelector('.js-merge-start', { timeout: 60000 });
    await page.waitForTimeout(2500);

    const ids = await page.evaluate(() => {
      const out = { openCards: [], formAttrs: null, linhasLeads: [] };
      document.querySelectorAll('.js-open_card, .merge-form__link_open-card').forEach((e) => {
        const attrs = {};
        for (const a of e.attributes) attrs[a.name] = String(a.value).slice(0, 120);
        out.openCards.push({ tag: e.tagName, txt: (e.textContent || '').trim().slice(0, 30), attrs });
      });
      const form = document.querySelector('.js-merge-form');
      if (form) {
        const attrs = {};
        for (const a of form.attributes) attrs[a.name] = String(a.value).slice(0, 200);
        out.formAttrs = attrs;
        // inputs hidden com ids dos leads?
        form.querySelectorAll('input[type="hidden"]').forEach((h) => {
          out.linhasLeads.push({ name: h.name, value: String(h.value).slice(0, 80) });
        });
      }
      return out;
    });
    console.log('=== A) OPEN CARDS (Abrir detalhes) ===');
    console.log(JSON.stringify(ids.openCards, null, 1));
    console.log('=== A) FORM attrs ===');
    console.log(JSON.stringify(ids.formAttrs, null, 1));
    console.log('=== A) HIDDEN inputs do form ===');
    console.log(JSON.stringify(ids.linhasLeads.slice(0, 30), null, 1));

    await page.locator('button.button-cancel', { hasText: /cancelar/i }).first().click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1000);

    // ---------- B) Seletor de funil na página do lead ----------
    // Pega um lead qualquer do funil para inspecionar
    const leadId = await page.evaluate(() => {
      const a = document.querySelector('a[href*="/leads/detail/"]');
      const m = a ? a.href.match(/\/leads\/detail\/(\d+)/) : null;
      return m ? m[1] : null;
    });
    console.log('=== B) Lead para inspeção:', leadId, '===');
    if (!leadId) { console.log('Nenhum link de lead encontrado no funil.'); return; }

    await page.goto(`${cfg.baseUrl}/leads/detail/${leadId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const seletorFunil = await page.evaluate(() => {
      const out = { candidatos: [] };
      const sels = [
        '.pipeline-select', '[class*="pipeline-select"]', '[class*="lead-status"]',
        '[class*="pipeline_select"]', '.js-pipeline-select', '[data-id="pipeline"]',
      ];
      const vistos = new Set();
      for (const s of sels) {
        document.querySelectorAll(s).forEach((e) => {
          const cls = String(e.className).slice(0, 160);
          if (vistos.has(cls)) return;
          vistos.add(cls);
          out.candidatos.push({ sel: s, tag: e.tagName, cls, txt: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80), visivel: !!(e.offsetWidth || e.offsetHeight) });
        });
      }
      return out;
    });
    console.log('=== B) Candidatos a seletor de funil ===');
    console.log(JSON.stringify(seletorFunil.candidatos, null, 1));
    await page.screenshot({ path: 'data/inspecao-lead.png' });

    // Tenta abrir o dropdown do funil/etapa
    const gatilhos = ['.pipeline-select__title', '.js-pipeline-select', '.pipeline-select', '[class*="pipeline-select"]'];
    let abriu = false;
    for (const g of gatilhos) {
      const el = page.locator(g).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        await page.waitForTimeout(1200);
        const temPipes = await page.evaluate(() =>
          document.querySelectorAll('[class*="pipeline"] [class*="status"], [class*="pipeline-select__dropdown"], [class*="pipeline_select__dropdown"]').length
        );
        if (temPipes > 0) { abriu = true; console.log('Dropdown aberto via:', g); break; }
      }
    }

    if (abriu) {
      const drop = await page.evaluate(() => {
        const out = { pipelines: [], estruturas: [] };
        // elementos que citam pipelines (nomes) e estágios
        document.querySelectorAll('[class*="pipeline-select"], [class*="pipeline_select"]').forEach((e) => {
          const cls = String(e.className).slice(0, 140);
          if (!out.estruturas.includes(cls)) out.estruturas.push(cls);
        });
        // procura itens com data-id / data-pipeline-id
        document.querySelectorAll('[data-pipeline-id], [data-id]').forEach((e) => {
          const pid = e.getAttribute('data-pipeline-id') || '';
          const did = e.getAttribute('data-id') || '';
          const txt = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
          if ((pid || (did && /^\d{6,}$/.test(did))) && (e.offsetWidth || e.offsetHeight)) {
            out.pipelines.push({ tag: e.tagName, cls: String(e.className).slice(0, 120), dataPipelineId: pid, dataId: did, txt });
          }
        });
        return out;
      });
      console.log('=== B) Estruturas do dropdown ===');
      console.log(JSON.stringify(drop.estruturas.slice(0, 30), null, 1));
      console.log('=== B) Itens com data-id / data-pipeline-id ===');
      console.log(JSON.stringify(drop.pipelines.slice(0, 60), null, 1));
      await page.screenshot({ path: 'data/inspecao-dropdown-funil.png' });
      await page.keyboard.press('Escape');
    } else {
      console.log('Dropdown de funil NÃO abriu — ver data/inspecao-lead.png');
    }
  } finally {
    await browser.close();
  }
})();
