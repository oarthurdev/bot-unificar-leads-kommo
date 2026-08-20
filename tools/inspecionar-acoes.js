/**
 * Calibração fase 2: marca 2 checkboxes na lista, captura a barra de ações,
 * clica APENAS no botão de unificar (se o texto bater) e captura o modal.
 * Fecha com Escape — NÃO confirma nada.
 */
const cfg = require('../src/config');
const { abrirNavegador } = require('../src/navegador');

(async () => {
  const { browser, page } = await abrirNavegador({ headless: true, bloquearRecursos: true });
  try {
    await page.goto(cfg.listUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // Marca os 2 primeiros checkboxes de linha
    const ids = await page.evaluate(() => {
      const linhas = Array.from(document.querySelectorAll('.js-list-row[data-id]')).slice(0, 2);
      return linhas.map((l) => l.getAttribute('data-id'));
    });
    console.log('Selecionando leads:', ids);

    for (const id of ids) {
      const label = page.locator(`.js-list-row[data-id="${id}"] label.control-checkbox`).first();
      await label.click({ force: true });
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1200);

    // Captura tudo que parece barra de ações / botões que surgiram
    const barra = await page.evaluate(() => {
      const out = { candidatos: [], botoesVisiveis: [] };
      const sels = [
        '.list-actions', '[class*="list-actions"]', '[class*="actions-panel"]',
        '[class*="selected-actions"]', '.js-list-multiactions', '[class*="multiaction"]',
        '[id*="actions"]',
      ];
      for (const s of sels) {
        document.querySelectorAll(s).forEach((el) => {
          if (el.offsetWidth || el.offsetHeight) {
            out.candidatos.push({ sel: s, tag: el.tagName, cls: String(el.className).slice(0, 160), html: el.outerHTML.slice(0, 1200) });
          }
        });
      }
      document.querySelectorAll('button, .button-input, [class*="button"]').forEach((b) => {
        const txt = (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if ((b.offsetWidth || b.offsetHeight) && txt && txt.length < 60) {
          out.botoesVisiveis.push({ tag: b.tagName, cls: String(b.className).slice(0, 140), txt });
        }
      });
      return out;
    });
    console.log('=== BARRA DE AÇÕES ===');
    console.log(JSON.stringify(barra.candidatos, null, 2).slice(0, 4000));
    console.log('=== BOTÕES VISÍVEIS ===');
    const unicos = [...new Map(barra.botoesVisiveis.map((b) => [b.txt + b.cls, b])).values()];
    console.log(JSON.stringify(unicos.slice(0, 40), null, 2));

    await page.screenshot({ path: 'data/inspecao-acoes.png' });

    // Tenta clicar SOMENTE no botão de unificar (por texto)
    const botaoUnificar = page.locator('button, .button-input, [class*="button"]', {
      hasText: /unificar|mesclar|merge|combinar/i,
    }).first();

    if (await botaoUnificar.count() > 0 && await botaoUnificar.isVisible().catch(() => false)) {
      const info = await botaoUnificar.evaluate((el) => ({ tag: el.tagName, cls: el.className, txt: el.textContent.trim() }));
      console.log('Clicando no botão de unificar:', JSON.stringify(info));
      await botaoUnificar.click();
      await page.waitForTimeout(2500);

      const modal = await page.evaluate(() => {
        const out = { modais: [] };
        document.querySelectorAll('.modal, [class*="modal"], [class*="merge"]').forEach((m) => {
          if ((m.offsetWidth || m.offsetHeight) && m.outerHTML.length > 300) {
            out.modais.push({ tag: m.tagName, cls: String(m.className).slice(0, 160), html: m.outerHTML.slice(0, 6000) });
          }
        });
        return out;
      });
      console.log('=== MODAL DE UNIFICAÇÃO ===');
      for (const m of modal.modais.slice(0, 3)) {
        console.log(`--- <${m.tag} class="${m.cls}"> ---`);
        console.log(m.html);
      }
      await page.screenshot({ path: 'data/inspecao-modal.png' });

      console.log('Fechando modal com Escape (nada confirmado).');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    } else {
      console.log('AVISO: botão de unificar não apareceu por texto — verifique data/inspecao-acoes.png e a lista de botões acima.');
    }
  } finally {
    await browser.close();
  }
})();
