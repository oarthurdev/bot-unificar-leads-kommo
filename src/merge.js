const cfg = require('./config');
const sel = require('./seletores');
const { abrirNavegador, garantirLogado } = require('./navegador');
const { log, lerJson, salvarJson, dormir } = require('./util');

/**
 * Unifica duplicatas pelo assistente nativo da Kommo:
 *   Funil → menu "..." → "Localizar duplicatas"
 *
 * Em cada tela do assistente:
 *   1. Lê os subgrupos de duplicatas (radios name="[prefixo]result_element[CAMPO]",
 *      opções na ordem das colunas; hidden name="id[]" = IDs dos leads na mesma ordem)
 *   2. Compara as datas do grupo DATE_CREATE e seleciona, em TODOS os campos,
 *      a coluna do lead criado MAIS RECENTEMENTE
 *   3. Clica "Unir esta duplicata" e espera a próxima tela
 *
 * FASE 2 (após o lote): o lead MAIS RECENTE fica onde está — não é tocado.
 * Apenas o(s) lead(s) ANTIGO(s) do grupo, se ainda existirem após a união,
 * são movidos para o funil PIPELINE_DESTINO (12347316, etapa "Deletar").
 * Se a união já removeu o antigo, não há nada a mover (registrado como absorvido).
 *
 * Progresso em data/estado.json (retomável). BATCH_SIZE = duplicatas por execução.
 */
async function merge() {
  const estado = lerJson(cfg.paths.estado, {
    totalUnificados: 0,
    pendentesMover: [], // [{ ids: [..], idNovo, nomes, quando }]
    movidos: [],
    falhas: [],
  });

  const { browser, page } = await abrirNavegador();
  try {
    // Retoma pendências de execuções anteriores antes de unir mais
    if (!cfg.dryRun && estado.pendentesMover.length > 0) {
      log(`Retomando: ${estado.pendentesMover.length} grupos aguardando tratamento pós-união...`);
      await moverPendentes(page, estado);
    }

    let abriu = await abrirAssistente(page);
    if (!abriu) {
      log('Assistente não abriu — pode não haver mais duplicatas. Encerrando.');
      return resumo(estado);
    }

    const limite = cfg.batchSize > 0 ? cfg.batchSize : Infinity;
    let processadas = 0;

    while (processadas < limite) {
      let tela = await lerTela(page);
      if (!tela) {
        // O assistente às vezes fecha após uma união — tenta reabrir e continuar
        abriu = await abrirAssistente(page);
        if (!abriu) { log('Sem mais duplicatas no assistente — lote encerrado.'); break; }
        tela = await lerTela(page);
        if (!tela) { log('Assistente reabriu sem telas — encerrando.'); break; }
      }

      const resumoTela = tela.subgrupos
        .map((s) => `[${s.nomes.join(' + ')}] → mantém #${s.idNovo} (${s.dataNova})`)
        .join(' | ');
      log(`Duplicata ${tela.atual} de ${tela.total} (${processadas + 1}/${limite === Infinity ? tela.total : limite} do lote): ${resumoTela}`);

      const clicados = await selecionarMaisRecentes(page, tela);
      log(`  ${clicados} campos apontados para o(s) lead(s) mais recente(s).`);

      if (cfg.dryRun) {
        await page.screenshot({ path: 'data/dry-run-selecao.png' }).catch(() => {});
        log('[DRY_RUN] Seleção feita e capturada em data/dry-run-selecao.png — NADA foi unido.');
        log('[DRY_RUN] O assistente não avança sem unir (o botão "Pular" marca como não-duplicata), então a simulação cobre 1 tela.');
        break;
      }

      const assinaturaAntes = tela.todosIds.join(',');
      await page.locator(sel.botaoUnir).first().click();

      for (const s of tela.subgrupos) {
        estado.pendentesMover.push({
          ids: s.ids,
          idNovo: s.idNovo,
          nomes: s.nomes,
          quando: new Date().toISOString(),
        });
        estado.totalUnificados++;
      }
      processadas++;
      salvarJson(cfg.paths.estado, estado);

      await esperarProximaTela(page, assinaturaAntes);
      await dormir(cfg.pausaEntreGruposMs);
    }

    // Fecha o assistente sem efeitos colaterais
    await page.locator(sel.botaoCancelar).first().click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await dormir(800);

    // FASE 2
    if (!cfg.dryRun && estado.pendentesMover.length > 0) {
      log(`FASE 2: tratando ${estado.pendentesMover.length} grupos unificados (antigo → funil ${cfg.pipelineDestino}; o mais recente fica)...`);
      await moverPendentes(page, estado);
    }
  } finally {
    salvarJson(cfg.paths.estado, estado);
    await browser.close();
  }
  resumo(estado);
}

function resumo(estado) {
  log('================ RESUMO ================');
  log(`Duplicatas unificadas (total acumulado): ${estado.totalUnificados}`);
  log(`Grupos tratados na fase 2:               ${estado.movidos.length}`);
  log(`Grupos aguardando fase 2:                ${estado.pendentesMover.length}`);
  log(`Falhas registradas:                      ${estado.falhas.length}`);
  if (cfg.dryRun) log('DRY_RUN estava ativo: nada foi alterado. Defina DRY_RUN=false no .env para valer.');
  else log('Rode "npm run merge" novamente para o próximo lote.');
}

/** Abre funil → "..." → "Localizar duplicatas". Retorna true se o assistente carregou. */
async function abrirAssistente(page) {
  log('Abrindo o funil e o assistente "Localizar duplicatas"...');
  await page.goto(`${cfg.baseUrl}/leads/pipeline/`, { waitUntil: 'domcontentloaded' });
  await dormir(5000);
  await garantirLogado(page);

  let clicouMenu = false;
  for (const s of sel.botaoMenuMais) {
    const btn = page.locator(s).first();
    if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
      await btn.click();
      clicouMenu = true;
      break;
    }
  }
  if (!clicouMenu) throw new Error('botão "..." do funil não encontrado (sel.botaoMenuMais)');
  await dormir(800);

  const item = page.locator(sel.itemContextMenu, { hasText: sel.textoLocalizarDuplicatas }).first();
  if (await item.count() === 0) throw new Error('item "Localizar duplicatas" não encontrado no menu');
  await item.click();

  try {
    await page.waitForSelector(sel.botaoUnir, { timeout: 90000 });
  } catch (_) {
    return false; // sem duplicatas, o assistente pode nem abrir
  }
  await dormir(2500);
  return true;
}

/**
 * Lê a tela atual do assistente. Retorna:
 * { atual, total, todosIds, subgrupos: [{ prefixo, idxNovo, dataNova, ids, idNovo, nomes }] }
 * ou null se o assistente não está mais visível.
 */
async function lerTela(page) {
  const temForm = await page.locator(sel.formAssistente).first().isVisible().catch(() => false);
  if (!temForm) return null;

  return await page.evaluate((s) => {
    const form = document.querySelector(s.formAssistente);
    if (!form) return null;

    // contador "1 de 993"
    let atual = null, total = null;
    const h2 = document.querySelector(s.tituloAssistente);
    const m = h2 ? (h2.textContent || '').match(/(\d+)\s*de\s*(\d+)/) : null;
    if (m) { atual = parseInt(m[1], 10); total = parseInt(m[2], 10); }

    // ids dos leads na ordem do DOM
    const todosIds = Array.from(form.querySelectorAll('input[type="hidden"][name="id[]"]')).map((i) => i.value);

    // radios agrupados por name, na ordem do DOM
    const grupos = {};
    form.querySelectorAll('input[type="radio"]').forEach((r) => {
      (grupos[r.name] = grupos[r.name] || []).push(r.value);
    });

    // subgrupos = grupos DATE_CREATE (na ordem), prefixo = tudo antes de "result_element"
    const subgrupos = [];
    let cursorIds = 0;
    for (const [name, valores] of Object.entries(grupos)) {
      if (!/result_element\[DATE_CREATE\]$/.test(name)) continue;
      const prefixo = name.slice(0, name.indexOf('result_element'));
      let idxNovo = 0;
      valores.forEach((v, i) => { if (v > valores[idxNovo]) idxNovo = i; }); // datas ISO comparam como string
      const ids = todosIds.slice(cursorIds, cursorIds + valores.length);
      cursorIds += valores.length;
      const nomes = grupos[`${prefixo}result_element[NAME]`] || [];
      subgrupos.push({
        prefixo,
        idxNovo,
        dataNova: valores[idxNovo],
        datas: valores,
        ids,
        idNovo: ids[idxNovo] || null,
        nomes,
      });
    }
    if (!subgrupos.length) return null;
    return { atual, total, todosIds, subgrupos };
  }, { formAssistente: sel.formAssistente, tituloAssistente: sel.tituloAssistente });
}

/**
 * Em cada subgrupo, marca em TODOS os grupos de radio a opção da coluna do
 * lead mais recente (mesmo índice do grupo DATE_CREATE). Checkboxes (tags,
 * e-mails, telefones) ficam como estão — a união preserva tudo.
 */
async function selecionarMaisRecentes(page, tela) {
  return await page.evaluate((args) => {
    const form = document.querySelector(args.formSel);
    if (!form) return 0;

    const grupos = {};
    form.querySelectorAll('input[type="radio"]').forEach((r) => {
      (grupos[r.name] = grupos[r.name] || []).push(r);
    });

    let clicados = 0;
    for (const sub of args.subgrupos) {
      for (const [name, radios] of Object.entries(grupos)) {
        if (!name.startsWith(sub.prefixo + 'result_element')) continue;
        if (sub.prefixo === '' && name.startsWith('[')) continue; // evita capturar subgrupos prefixados
        const alvo = radios[sub.idxNovo];
        if (alvo && !alvo.checked) {
          alvo.click(); // dispara os handlers da Kommo (inclui sync do PIPELINE_ID oculto)
          clicados++;
        }
      }
    }
    return clicados;
  }, { formSel: sel.formAssistente, subgrupos: tela.subgrupos });
}

/**
 * Espera a próxima tela do assistente após "Unir esta duplicata".
 * O form some por alguns segundos durante o processamento, então só conclui
 * que o assistente FECHOU depois de várias checagens seguidas sem form.
 * Retorna true se avançou; false se o assistente fechou (o loop reabre).
 */
async function esperarProximaTela(page, assinaturaAntes) {
  const prazo = Date.now() + 60000;
  let semFormSeguidas = 0;

  while (Date.now() < prazo) {
    await dormir(1500);
    const ids = await page.evaluate((formSel) => {
      const form = document.querySelector(formSel);
      if (!form) return null;
      return Array.from(form.querySelectorAll('input[type="hidden"][name="id[]"]')).map((i) => i.value).join(',');
    }, sel.formAssistente);

    if (ids && ids !== assinaturaAntes) return true;   // próxima tela carregou
    if (ids === null || ids === '') {
      semFormSeguidas++;
      if (semFormSeguidas >= 5) return false;          // ~8s sem form → assistente fechou
    } else {
      semFormSeguidas = 0;                             // form ainda com a tela antiga (processando)
    }
  }
  throw new Error('tempo esgotado aguardando o assistente avançar após "Unir esta duplicata"');
}

/** FASE 2: para cada grupo unido, move o(s) lead(s) ANTIGO(s) remanescentes. */
async function moverPendentes(page, estado) {
  const fila = [...estado.pendentesMover];
  for (const item of fila) {
    try {
      const detalhes = await tratarGrupoAposUniao(page, item);
      estado.movidos.push({ ...item, detalhes, quando: new Date().toISOString() });
      estado.pendentesMover = estado.pendentesMover.filter((p) => p !== item);
      log(`  Grupo "${item.nomes.join(' + ')}": ${detalhes.map((d) => `#${d.leadId} ${d.acao}`).join('; ')}`);
    } catch (e) {
      log(`  FALHA no grupo [${item.ids.join(',')}]: ${e.message} (re-tentado na próxima execução)`);
      estado.falhas.push({ ...item, erro: e.message, quando: new Date().toISOString() });
    }
    salvarJson(cfg.paths.estado, estado);
    await dormir(400);
  }
}

/**
 * Regras pós-união:
 *  - O lead MAIS RECENTE (idNovo) NUNCA é tocado.
 *  - Se idNovo não existe mais (a união manteve outro ID), NADA é movido —
 *    o grupo é marcado para conferência manual, por segurança.
 *  - Cada lead antigo que ainda existir é movido para o funil destino;
 *    os que a união já removeu são registrados como absorvidos.
 */
async function tratarGrupoAposUniao(page, item) {
  const detalhes = [];

  const novoExiste = await leadExiste(page, item.idNovo);
  if (!novoExiste) {
    detalhes.push({ leadId: item.idNovo, acao: 'NÃO encontrado — união manteve outro ID; nada movido (conferir manualmente)' });
    return detalhes;
  }
  detalhes.push({ leadId: item.idNovo, acao: 'mais recente, mantido onde está' });

  const antigos = item.ids.filter((i) => i && i !== item.idNovo);
  for (const leadId of antigos) {
    const existe = await leadExiste(page, leadId);
    if (!existe) {
      detalhes.push({ leadId, acao: 'absorvido pela união (não existe mais)' });
      continue;
    }
    await moverParaFunilDestino(page, leadId); // a página já está no card do lead
    detalhes.push({ leadId, acao: `movido para o funil ${cfg.pipelineDestino}` });
  }
  return detalhes;
}

/** Abre o card do lead e verifica se ele existe (aguarda o widget de funil). */
async function leadExiste(page, leadId) {
  await page.goto(`${cfg.baseUrl}/leads/detail/${leadId}`, { waitUntil: 'domcontentloaded' });
  const prazo = Date.now() + 9000;
  while (Date.now() < prazo) {
    if (!page.url().includes(`/leads/detail/${leadId}`)) return false; // redirecionado = não existe
    const temWidget = await page.locator(sel.seletorFunilCard).first().isVisible().catch(() => false);
    if (temWidget) return true;
    await dormir(700);
  }
  return false;
}

/** Move o lead aberto no card para o funil destino (etapa "Deletar" por padrão). */
async function moverParaFunilDestino(page, leadId) {
  const atual = await page.evaluate((s) =>
    document.querySelector(s)?.getAttribute('data-pipeline-id'), sel.funilAtualAttr);
  if (String(atual) === String(cfg.pipelineDestino)) return; // já está lá

  const selLabel = cfg.statusDestino
    ? `label.pipeline-select__dropdown__item__label[for^="pipeline_${cfg.pipelineDestino}_${cfg.statusDestino}_"]`
    : `label.pipeline-select__dropdown__item__label[for^="pipeline_${cfg.pipelineDestino}_"]:not([for*="_142_"]):not([for*="_143_"])`;

  // Abre o dropdown (com re-tentativas) e clica na etapa destino
  let clicou = false;
  for (let tentativa = 0; tentativa < 3 && !clicou; tentativa++) {
    await page.locator(sel.seletorFunilCard).first().click();
    await page.waitForSelector('.pipeline-select-showed', { timeout: 5000 }).catch(() => {});
    await dormir(800);

    const label = page.locator(selLabel).first();
    if (await label.count() === 0) {
      throw new Error(`etapa do funil ${cfg.pipelineDestino} não encontrada no dropdown do card do lead #${leadId}`);
    }
    if (await label.isVisible().catch(() => false)) {
      await label.scrollIntoViewIfNeeded().catch(() => {});
      await label.click();
      clicou = true;
    } else {
      // Fallback: clique via JS (o handler da Kommo escuta o evento de qualquer forma)
      try {
        await label.evaluate((el) => el.click());
        clicou = true;
      } catch (_) {
        await page.keyboard.press('Escape').catch(() => {});
        await dormir(600);
      }
    }
  }
  if (!clicou) throw new Error(`não consegui clicar na etapa destino no card do lead #${leadId}`);
  await dormir(1800);

  // Alguns layouts pedem confirmação com "Salvar"
  const salvar = page.locator('button, .button-input', { hasText: /^salvar$/i }).first();
  if (await salvar.isVisible().catch(() => false)) {
    await salvar.click();
    await dormir(1500);
  }

  const depois = await page.evaluate((s) =>
    document.querySelector(s)?.getAttribute('data-pipeline-id'), sel.funilAtualAttr);
  if (String(depois) !== String(cfg.pipelineDestino)) {
    throw new Error(`funil do lead #${leadId} não mudou (atual: ${depois})`);
  }
}

module.exports = { merge };
