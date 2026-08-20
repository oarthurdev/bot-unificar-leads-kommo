/**
 * Teste SOMENTE-LEITURA da fase 2: para cada grupo pendente em estado.json,
 * verifica quais IDs ainda existem e imprime o que a fase 2 fará — sem mover nada.
 */
const cfg = require('../src/config');
const sel = require('../src/seletores');
const { abrirNavegador } = require('../src/navegador');
const { lerJson, dormir } = require('../src/util');

async function leadExiste(page, leadId) {
  await page.goto(`${cfg.baseUrl}/leads/detail/${leadId}`, { waitUntil: 'domcontentloaded' });
  const prazo = Date.now() + 9000;
  while (Date.now() < prazo) {
    if (!page.url().includes(`/leads/detail/${leadId}`)) return false;
    const temWidget = await page.locator(sel.seletorFunilCard).first().isVisible().catch(() => false);
    if (temWidget) return true;
    await dormir(500);
  }
  return false;
}

(async () => {
  const estado = lerJson(cfg.paths.estado, { pendentesMover: [] });
  if (!estado.pendentesMover.length) { console.log('Nenhum grupo pendente.'); return; }

  const { browser, page } = await abrirNavegador();
  try {
    for (const item of estado.pendentesMover) {
      console.log(`\nGrupo "${item.nomes.join(' + ')}" — ids: ${item.ids.join(', ')} (mais recente: #${item.idNovo})`);
      const novoExiste = await leadExiste(page, item.idNovo);
      console.log(`  #${item.idNovo} (mais recente): ${novoExiste ? 'EXISTE → fica onde está' : 'NÃO existe → grupo iria para conferência manual'}`);
      for (const id of item.ids.filter((i) => i !== item.idNovo)) {
        const existe = await leadExiste(page, id);
        console.log(`  #${id} (antigo): ${existe ? `EXISTE → seria movido para o funil ${cfg.pipelineDestino}` : 'não existe → absorvido pela união'}`);
      }
    }
  } finally {
    await browser.close();
  }
})();
