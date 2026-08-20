/**
 * Calibração fase 3: abre o assistente "Localizar duplicatas" e faz um dump
 * ESTRUTURADO do modal: radios (name/value = id do lead), checkboxes, links
 * "Abrir detalhes", toggles "Unir". Fecha com Cancelar — NÃO une nada.
 */
const cfg = require('../src/config');
const { abrirNavegador } = require('../src/navegador');

(async () => {
  const { browser, page } = await abrirNavegador({ headless: true, bloquearRecursos: true });
  try {
    await page.goto(`${cfg.baseUrl}/leads/pipeline/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    await page.locator('.button-input-more button.button-input-with-menu').first().click();
    await page.waitForTimeout(800);
    await page.locator('.button-input__context-menu__item', { hasText: /localizar duplicatas/i }).first().click();
    console.log('Aguardando assistente...');
    await page.waitForSelector('.js-merge-start', { timeout: 60000 });
    await page.waitForTimeout(3000);

    const dump = await page.evaluate(() => {
      const out = {};
      const h2 = Array.from(document.querySelectorAll('h2')).find((e) => /localizar e unir/i.test(e.textContent));
      out.titulo = h2 ? h2.textContent.trim() : null;

      // Sobe até o container do modal
      let modal = h2;
      while (modal && modal.parentElement) {
        modal = modal.parentElement;
        if (/(^|\s)modal(\s|$)/.test(modal.className) || modal.querySelector('.js-merge-start')) break;
      }
      out.modalClasse = modal ? String(modal.className).slice(0, 200) : null;
      const escopo = modal || document;

      // Radios: agrupados por name
      out.radios = {};
      escopo.querySelectorAll('input[type="radio"]').forEach((r) => {
        const nome = r.name || '(sem nome)';
        if (!out.radios[nome]) out.radios[nome] = [];
        const label = r.closest('label');
        out.radios[nome].push({
          value: r.value,
          checked: r.checked,
          cls: String(r.className).slice(0, 80),
          labelTxt: label ? (label.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) : '',
        });
      });

      // Checkboxes dentro do modal (tags, emails, telefones, toggles)
      out.checkboxes = [];
      escopo.querySelectorAll('input[type="checkbox"]').forEach((c) => {
        const label = c.closest('label');
        out.checkboxes.push({
          name: c.name, value: c.value, checked: c.checked,
          cls: String(c.className).slice(0, 80),
          labelTxt: label ? (label.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50) : '',
        });
      });
      out.checkboxes = out.checkboxes.slice(0, 40);

      // Links "Abrir detalhes" (id dos leads)
      out.abrirDetalhes = [];
      escopo.querySelectorAll('a').forEach((a) => {
        if (/abrir detalhes/i.test(a.textContent || '') || /\/leads\/detail\//.test(a.href || '')) {
          out.abrirDetalhes.push({ href: a.getAttribute('href'), cls: String(a.className).slice(0, 100), txt: (a.textContent || '').trim().slice(0, 40) });
        }
      });

      // Estrutura de colunas/subgrupos
      out.estrutura = [];
      escopo.querySelectorAll('[class*="doubles"], [class*="merge"]').forEach((e) => {
        const cls = String(e.className);
        if (!out.estrutura.some((x) => x === cls) && cls.length < 160) out.estrutura.push(cls);
      });
      out.estrutura = out.estrutura.slice(0, 40);

      return out;
    });

    console.log('Título:', dump.titulo);
    console.log('Classe do modal:', dump.modalClasse);
    console.log('=== RADIOS (por name) ===');
    console.log(JSON.stringify(dump.radios, null, 1));
    console.log('=== CHECKBOXES (primeiros 40) ===');
    console.log(JSON.stringify(dump.checkboxes, null, 1));
    console.log('=== ABRIR DETALHES / LINKS DE LEAD ===');
    console.log(JSON.stringify(dump.abrirDetalhes, null, 1));
    console.log('=== CLASSES doubles/merge ===');
    console.log(JSON.stringify(dump.estrutura, null, 1));

    await page.screenshot({ path: 'data/inspecao-modal2.png' });
    await page.locator('button.button-cancel', { hasText: /cancelar/i }).first().click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    console.log('Fechado sem unir.');
  } finally {
    await browser.close();
  }
})();
