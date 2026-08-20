/**
 * Calibração: abre o funil, clica no menu "..." → "Localizar duplicatas",
 * captura o DOM do assistente de unificação (colunas, datas, botões) e
 * fecha com Cancelar/Escape. NÃO une nada.
 */
const cfg = require('../src/config');
const { abrirNavegador } = require('../src/navegador');

(async () => {
  const { browser, page } = await abrirNavegador({ headless: true, bloquearRecursos: true });
  try {
    await page.goto(`${cfg.baseUrl}/leads/pipeline/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    console.log('URL:', page.url());

    // 1) Botões do topo (para achar o "...")
    const topo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, .button-input, [class*="button"]'))
        .filter((b) => b.offsetWidth || b.offsetHeight)
        .slice(0, 30)
        .map((b) => ({
          tag: b.tagName,
          cls: String(b.className).slice(0, 120),
          id: b.id,
          txt: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        }));
    });
    console.log('=== BOTÕES VISÍVEIS (topo) ===');
    console.log(JSON.stringify(topo, null, 1));

    // O item "Localizar duplicatas" já existe no DOM? (menu oculto)
    const itemMenu = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*')).filter(
        (e) => /localizar duplicatas/i.test(e.textContent || '') && e.children.length === 0
      );
      return els.slice(0, 5).map((e) => ({
        tag: e.tagName, cls: String(e.className).slice(0, 140),
        paiCls: String(e.parentElement?.className || '').slice(0, 140),
        visivel: !!(e.offsetWidth || e.offsetHeight),
      }));
    });
    console.log('=== ITEM "Localizar duplicatas" no DOM ===');
    console.log(JSON.stringify(itemMenu, null, 1));

    // 2) Abre o menu "..." — candidatos comuns (o wrapper certo é .button-input-more)
    const candidatosMenu = [
      '.button-input-more button.button-input-with-menu',
      '.list-top-nav__button-more button',
      '.list-top-nav__button-more',
      '.button-input-more',
      '.button-input_more', '.js-btn-more', '[data-id="more"]',
    ];
    let abriu = false;
    for (const c of candidatosMenu) {
      const btn = page.locator(c).first();
      if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
        console.log('Clicando candidato de menu:', c);
        await btn.click().catch(() => {});
        await page.waitForTimeout(800);
        const vis = await page.locator('text=/Localizar duplicatas/i').first().isVisible().catch(() => false);
        if (vis) { abriu = true; console.log('Menu aberto com:', c); break; }
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
    // Fallback: botão cujo texto é "..." ou "⋯"
    if (!abriu) {
      const btns = page.locator('button, .button-input, [class*="button"]');
      const n = await btns.count();
      for (let i = 0; i < Math.min(n, 40); i++) {
        const b = btns.nth(i);
        const txt = ((await b.textContent().catch(() => '')) || '').trim();
        if (/^(\.{3}|⋯|…)$/.test(txt) && await b.isVisible().catch(() => false)) {
          console.log('Clicando botão com texto reticências, idx', i);
          await b.click().catch(() => {});
          await page.waitForTimeout(800);
          if (await page.locator('text=/Localizar duplicatas/i').first().isVisible().catch(() => false)) {
            abriu = true; break;
          }
        }
      }
    }
    await page.screenshot({ path: 'data/inspecao-menu.png' });
    if (!abriu) { console.log('MENU NÃO ABRIU — veja data/inspecao-menu.png'); return; }

    // 3) Clica em "Localizar duplicatas" (item do context-menu) e espera o assistente
    const item = page.locator('.button-input__context-menu__item', { hasText: /localizar duplicatas/i }).first();
    if (await item.count() > 0) await item.click();
    else await page.locator('text=/Localizar duplicatas/i').first().click();
    console.log('Aguardando assistente de duplicatas (pode demorar)...');
    await page.waitForTimeout(12000);
    await page.screenshot({ path: 'data/inspecao-wizard.png', fullPage: false });

    // 4) Captura estrutura do assistente
    const wizard = await page.evaluate(() => {
      const out = { titulo: null, botoes: [], links: [], modalCls: null, htmlResumo: null, datas: [] };
      // título "Localizar e unir duplicatas — 1 de 993"
      const tituloEl = Array.from(document.querySelectorAll('*')).find(
        (e) => /localizar e unir duplicatas/i.test(e.textContent || '') && e.children.length <= 2 && (e.textContent || '').length < 120
      );
      if (tituloEl) {
        out.titulo = { tag: tituloEl.tagName, cls: String(tituloEl.className).slice(0, 140), txt: tituloEl.textContent.trim() };
        let m = tituloEl.closest('[class*="modal"], [class*="merge"], [class*="duplicat"], [class*="doubles"]');
        if (m) {
          out.modalCls = { tag: m.tagName, cls: String(m.className).slice(0, 200) };
          out.htmlResumo = m.outerHTML.slice(0, 9000);
        }
      }
      document.querySelectorAll('button, .button-input').forEach((b) => {
        const txt = (b.textContent || '').trim().replace(/\s+/g, ' ');
        if ((b.offsetWidth || b.offsetHeight) && txt && txt.length < 50) {
          out.botoes.push({ tag: b.tagName, cls: String(b.className).slice(0, 140), txt });
        }
      });
      document.querySelectorAll('a, span, div').forEach((e) => {
        const txt = (e.textContent || '').trim();
        if (/^(selecionar tudo|abrir detalhes|cancelar tudo)$/i.test(txt) && e.children.length === 0) {
          out.links.push({ tag: e.tagName, cls: String(e.className).slice(0, 140), txt, href: e.href || '' });
        }
      });
      // datas de criação visíveis (formato 2024-06-25 13:49:35)
      Array.from(document.querySelectorAll('*')).forEach((e) => {
        const txt = (e.textContent || '').trim();
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(txt) && e.children.length === 0) {
          out.datas.push({ tag: e.tagName, cls: String(e.className).slice(0, 140), txt });
        }
      });
      return out;
    });
    console.log('=== ASSISTENTE ===');
    console.log('Título:', JSON.stringify(wizard.titulo));
    console.log('Modal:', JSON.stringify(wizard.modalCls));
    console.log('Datas encontradas:', JSON.stringify(wizard.datas, null, 1));
    console.log('Links (Selecionar tudo / Abrir detalhes):', JSON.stringify(wizard.links, null, 1));
    const botoesUnicos = [...new Map(wizard.botoes.map((b) => [b.txt + b.cls, b])).values()];
    console.log('Botões:', JSON.stringify(botoesUnicos.slice(0, 25), null, 1));
    console.log('=== HTML DO MODAL (resumo) ===');
    console.log(wizard.htmlResumo || '(não capturado)');

    // 5) Fecha SEM unir
    const cancelar = page.locator('button, .button-input, a, span', { hasText: /^cancelar$/i }).first();
    if (await cancelar.count() > 0) await cancelar.click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    console.log('Assistente fechado sem unir nada.');
  } finally {
    await browser.close();
  }
})();
