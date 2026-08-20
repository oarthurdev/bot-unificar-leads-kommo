/**
 * Captura as requisições AJAX que o assistente "Localizar duplicatas" dispara:
 *  - ao carregar a próxima duplicata
 *  - ao clicar "Unir esta duplicata" (1 união REAL é executada, com a mesma
 *    regra do bot: mantém o lead mais recente)
 * Salva tudo em data/rede-uniao.json para construir o modo turbo.
 */
const fs = require('fs');
const cfg = require('../src/config');
const sel = require('../src/seletores');
const { abrirNavegador } = require('../src/navegador');
const { dormir } = require('../src/util');
const { abrirAssistente, lerTela, selecionarMaisRecentes, esperarProximaTela } = require('../src/merge');

(async () => {
  const { browser, page } = await abrirNavegador();
  const capturas = [];

  page.on('request', (req) => {
    const url = req.url();
    if (/merge|double|dupl/i.test(url) && !/\.(js|css|png|svg|woff)/.test(url)) {
      capturas.push({
        tipo: 'request',
        metodo: req.method(),
        url,
        postData: req.postData() ? String(req.postData()).slice(0, 8000) : null,
        headers: req.headers(),
      });
    }
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (/merge|double|dupl/i.test(url) && !/\.(js|css|png|svg|woff)/.test(url)) {
      let corpo = null;
      try { corpo = (await res.text()).slice(0, 8000); } catch (_) {}
      capturas.push({ tipo: 'response', status: res.status(), url, corpo });
    }
  });

  try {
    const abriu = await abrirAssistente(page);
    if (!abriu) { console.log('Assistente não abriu.'); return; }

    const tela = await lerTela(page);
    if (!tela) { console.log('Sem tela.'); return; }
    console.log(`Unindo (real) a duplicata ${tela.atual} de ${tela.total} para capturar a rede...`);

    await selecionarMaisRecentes(page, tela);
    const assinatura = tela.todosIds.join(',');
    await page.locator(sel.botaoUnir).first().click();
    await esperarProximaTela(page, assinatura).catch(() => {});
    await dormir(1500);

    await page.locator(sel.botaoCancelar).first().click().catch(() => {});
  } finally {
    fs.writeFileSync('data/rede-uniao.json', JSON.stringify(capturas, null, 2), 'utf8');
    console.log(`\n${capturas.length} eventos de rede capturados → data/rede-uniao.json`);
    for (const c of capturas) {
      console.log(`[${c.tipo}] ${c.metodo || c.status} ${c.url.slice(0, 120)}${c.postData ? ' (com POST data)' : ''}`);
    }
    await browser.close();
  }
})();
