/**
 * Calibração fase 5 (somente leitura): abre um lead, clica no seletor de
 * funil/etapa e faz dump completo do dropdown: blocos de pipeline, captions,
 * inputs de status (value = id da etapa) e onde aparece o pipeline 12347316.
 * Fecha com Escape — não altera nada.
 */
const cfg = require('../src/config');
const { abrirNavegador } = require('../src/navegador');

const PIPELINE_ALVO = '12347316';

(async () => {
  const { browser, page } = await abrirNavegador({ headless: true, bloquearRecursos: true });
  try {
    await page.goto(`${cfg.baseUrl}/leads/pipeline/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const leadId = await page.evaluate(() => {
      const a = document.querySelector('a[href*="/leads/detail/"]');
      const m = a ? a.href.match(/\/leads\/detail\/(\d+)/) : null;
      return m ? m[1] : null;
    });
    console.log('Lead inspecionado:', leadId);

    await page.goto(`${cfg.baseUrl}/leads/detail/${leadId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    await page.locator('.pipeline-select-view').first().click();
    await page.waitForTimeout(1500);

    const dump = await page.evaluate((alvo) => {
      const out = { blocos: [], alvoEncontrado: [], overlay: null };
      const cont = document.querySelector('.pipeline-select-wrapper__inner__container') ||
                   document.querySelector('.pipeline-select-wrapper__inner') || document;

      cont.querySelectorAll('.pipeline-select').forEach((b) => {
        const attrs = {};
        for (const a of b.attributes) attrs[a.name] = String(a.value).slice(0, 100);
        const caption = b.querySelector('.pipeline-select__caption');
        const capAttrs = {};
        if (caption) for (const a of caption.attributes) capAttrs[a.name] = String(a.value).slice(0, 100);
        const itens = Array.from(b.querySelectorAll('li.pipeline-select__dropdown__item')).slice(0, 12).map((li) => {
          const inp = li.querySelector('input');
          const liAttrs = {};
          for (const a of li.attributes) liAttrs[a.name] = String(a.value).slice(0, 80);
          return {
            txt: (li.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
            inputName: inp ? inp.name : null,
            inputValue: inp ? inp.value : null,
            inputId: inp ? inp.id : null,
            liAttrs,
          };
        });
        out.blocos.push({
          attrs,
          captionTxt: caption ? (caption.textContent || '').trim().slice(0, 50) : null,
          capAttrs,
          totalItens: b.querySelectorAll('li').length,
          itens: itens.slice(0, 6),
        });
      });

      // Onde aparece o id do pipeline alvo?
      document.querySelectorAll('*').forEach((e) => {
        for (const a of e.attributes || []) {
          if (String(a.value).includes(alvo)) {
            out.alvoEncontrado.push({
              tag: e.tagName, cls: String(e.className).slice(0, 120),
              attr: a.name, valor: String(a.value).slice(0, 120),
              txt: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50),
            });
          }
        }
      });
      out.alvoEncontrado = out.alvoEncontrado.slice(0, 15);

      const ov = document.querySelector('.pipeline-select-overlay');
      out.overlay = ov ? String(ov.className) : null;
      return out;
    }, PIPELINE_ALVO);

    console.log('=== BLOCOS .pipeline-select no dropdown ===');
    console.log(JSON.stringify(dump.blocos, null, 1));
    console.log(`=== ONDE APARECE ${PIPELINE_ALVO} ===`);
    console.log(JSON.stringify(dump.alvoEncontrado, null, 1));
    console.log('Overlay:', dump.overlay);

    await page.screenshot({ path: 'data/inspecao-dropdown2.png' });
    await page.keyboard.press('Escape');
  } finally {
    await browser.close();
  }
})();
