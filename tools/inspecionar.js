/**
 * Ferramenta de calibração: abre /leads/list/ com a sessão salva e imprime
 * a estrutura real do DOM (linhas, nomes, checkboxes, busca) para ajustar
 * src/seletores.js. Não altera nada na conta.
 */
const cfg = require('../src/config');
const { abrirNavegador } = require('../src/navegador');

(async () => {
  const { browser, page } = await abrirNavegador({ headless: true, bloquearRecursos: true });
  try {
    await page.goto(cfg.listUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    console.log('URL atual:', page.url());
    console.log('Título:', await page.title());

    const info = await page.evaluate(() => {
      const out = { contagens: {}, amostras: {} };

      const candidatos = {
        linhas: [
          '.list__body-right__wrapper .js-list-row',
          'tr.list-row[data-id]',
          '.list__row[data-id]',
          'tr[data-id]',
          '[data-id].js-list-row',
          '.js-list-row',
          'table tr',
        ],
        nomes: [
          '.list__body-right__row__link',
          'a[href*="/leads/detail/"]',
          '.js-navigate-link',
        ],
        checkboxes: [
          'input[type="checkbox"]',
          '.control--checkbox',
          '.js-item-checkbox',
          '[class*="checkbox"]',
        ],
        busca: [
          'input.js-search-input',
          '#search_input',
          'input[type="search"]',
          'input[placeholder]',
        ],
      };

      for (const [grupo, sels] of Object.entries(candidatos)) {
        out.contagens[grupo] = {};
        for (const s of sels) {
          try { out.contagens[grupo][s] = document.querySelectorAll(s).length; }
          catch (e) { out.contagens[grupo][s] = 'ERRO'; }
        }
      }

      // Amostra: primeiro link de detalhe de lead e seus ancestrais
      const link = document.querySelector('a[href*="/leads/detail/"]');
      if (link) {
        out.amostras.linkNome = link.outerHTML.slice(0, 500);
        let anc = link.parentElement;
        const cadeia = [];
        for (let i = 0; i < 6 && anc; i++) {
          cadeia.push(`<${anc.tagName.toLowerCase()} class="${anc.className}" data-id="${anc.getAttribute('data-id') || ''}">`);
          anc = anc.parentElement;
        }
        out.amostras.ancestraisDoLink = cadeia;
      }

      // Amostra: primeira linha com data-id
      const linha = document.querySelector('[data-id].js-list-row, tr[data-id], .list__row[data-id]');
      if (linha) out.amostras.linhaCompleta = linha.outerHTML.slice(0, 3000);

      // Inputs visíveis (para achar a busca)
      out.amostras.inputs = Array.from(document.querySelectorAll('input'))
        .slice(0, 20)
        .map((i) => ({
          type: i.type, id: i.id, cls: i.className.slice(0, 120),
          placeholder: i.placeholder, visivel: !!(i.offsetWidth || i.offsetHeight),
        }));

      // Elementos de busca clicáveis (a Kommo às vezes usa um botão que expande o input)
      out.amostras.botoesBusca = Array.from(document.querySelectorAll('[class*="search"]'))
        .slice(0, 15)
        .map((e) => `<${e.tagName.toLowerCase()} class="${String(e.className).slice(0, 140)}">`);

      return out;
    });

    console.log(JSON.stringify(info, null, 2));

    await page.screenshot({ path: 'data/inspecao-lista.png', fullPage: false });
    console.log('Screenshot salvo em data/inspecao-lista.png');
  } finally {
    await browser.close();
  }
})();
