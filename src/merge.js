const cfg = require('./config');
const sel = require('./seletores');
const { abrirNavegador, primeiro, garantirLogado } = require('./navegador');
const { log, lerJson, salvarJson, normalizarNome, dormir } = require('./util');

/**
 * Unifica os grupos de data/duplicados.json em lotes, pela interface web:
 *   1. Busca o nome do lead na lista
 *   2. Marca os checkboxes das linhas duplicadas (até MAX_LEADS_POR_UNIFICACAO por vez)
 *   3. Clica em "Unificar/Mesclar" e, no modal, prioriza os valores do lead MAIS RECENTE
 *   4. Confirma e repete até sobrar 1 lead com aquele nome
 *
 * Progresso fica em data/estado.json — pode interromper (Ctrl+C) e rodar de novo
 * que ele continua de onde parou. BATCH_SIZE controla quantos grupos por execução.
 */
async function merge() {
  const duplicados = lerJson(cfg.paths.duplicados, null);
  if (!duplicados || !duplicados.length) {
    throw new Error('data/duplicados.json vazio ou inexistente. Rode antes: npm run scan');
  }

  const estado = lerJson(cfg.paths.estado, { concluidos: {}, falhas: {} });
  const pendentes = duplicados.filter((g) => !estado.concluidos[g.chave]);
  if (!pendentes.length) {
    log('Nada a fazer — todos os grupos já foram unificados. (Apague data/estado.json para reiniciar.)');
    return;
  }

  const lote = cfg.batchSize > 0 ? pendentes.slice(0, cfg.batchSize) : pendentes;
  log(`Grupos pendentes: ${pendentes.length} | Neste lote: ${lote.length} | DRY_RUN=${cfg.dryRun}`);

  const { browser, page } = await abrirNavegador();
  let feitos = 0;
  let falhas = 0;

  try {
    await page.goto(cfg.listUrl, { waitUntil: 'domcontentloaded' });
    await garantirLogado(page);

    for (const grupo of lote) {
      try {
        const restantes = await unificarGrupo(page, grupo);
        if (cfg.dryRun) {
          log(`[DRY_RUN] Grupo "${grupo.nome}" (${grupo.total} leads) — simulação ok, nada confirmado.`);
        } else if (restantes <= 1) {
          estado.concluidos[grupo.chave] = {
            nome: grupo.nome,
            leadsUnificados: grupo.total,
            quando: new Date().toISOString(),
          };
          delete estado.falhas[grupo.chave];
          feitos++;
          log(`OK (${feitos}/${lote.length}): "${grupo.nome}" — ${grupo.total} leads unificados em 1.`);
        } else {
          throw new Error(`ainda restam ${restantes} leads com esse nome após as tentativas`);
        }
      } catch (e) {
        falhas++;
        estado.falhas[grupo.chave] = { nome: grupo.nome, erro: e.message, quando: new Date().toISOString() };
        log(`FALHA no grupo "${grupo.nome}": ${e.message}`);
        // Recarrega a lista para limpar qualquer estado de seleção/modal travado
        await page.goto(cfg.listUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      salvarJson(cfg.paths.estado, estado);
      await dormir(cfg.pausaEntreGruposMs);
    }
  } finally {
    salvarJson(cfg.paths.estado, estado);
    await browser.close();
  }

  const restantesTotal = duplicados.filter((g) => !estado.concluidos[g.chave]).length;
  log('================ RESUMO DO LOTE ================');
  log(`Unificados: ${feitos} | Falhas: ${falhas} | Grupos ainda pendentes: ${restantesTotal}`);
  if (restantesTotal > 0 && !cfg.dryRun) log('Rode "npm run merge" novamente para o próximo lote.');
  if (cfg.dryRun) log('DRY_RUN estava ativo: nada foi alterado. Defina DRY_RUN=false no .env para valer.');
}

/**
 * Unifica um grupo até sobrar 1 lead. Retorna quantas linhas ainda existem
 * com o nome do grupo ao final.
 */
async function unificarGrupo(page, grupo) {
  const maxRodadas = Math.ceil(grupo.total / (cfg.maxPorUnificacao - 1)) + 3;

  for (let rodada = 0; rodada < maxRodadas; rodada++) {
    const linhas = await buscarLinhasDoGrupo(page, grupo);
    if (linhas.length <= 1) return linhas.length;

    // Seleciona até MAX por vez, garantindo que o MAIS RECENTE (maior id) esteja incluso
    const ordenadas = [...linhas].sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));
    const selecionar = ordenadas.slice(0, cfg.maxPorUnificacao);
    const idMaisRecente = ordenadas[0].id;

    log(`  "${grupo.nome}": rodada ${rodada + 1} — selecionando ${selecionar.length} de ${linhas.length} leads (mais recente: #${idMaisRecente})`);

    for (const l of selecionar) {
      await marcarCheckbox(page, l.id);
    }

    await clicarUnificar(page);
    const confirmado = await tratarModal(page, idMaisRecente);

    if (cfg.dryRun) {
      // Em simulação, fecha o modal sem confirmar e encerra o grupo
      await page.keyboard.press('Escape').catch(() => {});
      await dormir(400);
      return linhas.length;
    }
    if (!confirmado) throw new Error('não foi possível confirmar o modal de unificação');

    await dormir(1000); // dá tempo da lista atualizar após a unificação
  }

  const finais = await buscarLinhasDoGrupo(page, grupo);
  return finais.length;
}

/** Busca o nome do grupo e retorna as linhas visíveis cujo nome bate exatamente. */
async function buscarLinhasDoGrupo(page, grupo) {
  const busca = await primeiro(page, sel.campoBusca);
  if (!busca) throw new Error('campo de busca não encontrado (ajuste sel.campoBusca em src/seletores.js)');

  await busca.click();
  await busca.fill('');
  await busca.fill(grupo.nome);
  await busca.press('Enter');
  await dormir(1500); // aguarda a lista filtrar

  const linhas = await page.evaluate((s) => {
    const acharLinhas = () => {
      for (const c of s.linhaLead) {
        const els = document.querySelectorAll(c);
        if (els.length) return Array.from(els);
      }
      return [];
    };
    return acharLinhas().map((el) => {
      let id = el.getAttribute('data-id');
      let nome = '';
      for (const c of s.nomeLead) {
        const n = el.querySelector(c);
        if (n) {
          nome = (n.textContent || '').trim();
          if (!id && n.href) {
            const m = String(n.href).match(/\/leads\/detail\/(\d+)/);
            if (m) id = m[1];
          }
          if (nome) break;
        }
      }
      return { id, nome };
    }).filter((l) => l.id && l.nome);
  }, { linhaLead: sel.linhaLead, nomeLead: sel.nomeLead });

  // Só linhas cujo nome normalizado bate EXATAMENTE com a chave do grupo
  return linhas.filter((l) => normalizarNome(l.nome) === grupo.chave);
}

/** Marca o checkbox da linha com o data-id informado. */
async function marcarCheckbox(page, id) {
  for (const linhaSel of sel.linhaLead) {
    const linha = page.locator(`${linhaSel}[data-id="${id}"]`).first();
    if (await linha.count() === 0) continue;

    await linha.hover().catch(() => {});
    for (const cbSel of sel.checkboxLinha) {
      const cb = linha.locator(cbSel).first();
      if (await cb.count() > 0) {
        try {
          if (!(await cb.isChecked().catch(() => false))) {
            await cb.click({ force: true });
          }
          return;
        } catch (_) { /* tenta o próximo candidato */ }
      }
    }
    // Fallback: clica na área esquerda da linha (onde fica o checkbox na Kommo)
    const box = await linha.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 14, box.y + box.height / 2);
      return;
    }
  }
  throw new Error(`não consegui marcar o checkbox do lead #${id}`);
}

/** Clica no botão de unificar (direto, dentro de "..." ou por texto). */
async function clicarUnificar(page) {
  await dormir(400); // barra de ações leva um instante para aparecer

  // 1) Botão direto por seletor
  let botao = await primeiro(page, sel.botaoUnificar);
  if (botao && await botao.isVisible().catch(() => false)) {
    await botao.click();
    return;
  }

  // 2) Por texto na barra de ações
  const barra = await primeiro(page, sel.barraAcoes);
  if (barra) {
    const porTexto = barra.locator('button, .button-input, [class*="button"]', { hasText: sel.textosUnificar }).first();
    if (await porTexto.count() > 0) { await porTexto.click(); return; }
  }

  // 3) Dentro do menu "..."
  const mais = await primeiro(page, sel.botaoMais);
  if (mais && await mais.isVisible().catch(() => false)) {
    await mais.click();
    await dormir(300);
    const item = page.locator('li, .button-input__context-menu__item, [class*="menu"] *', { hasText: sel.textosUnificar }).first();
    if (await item.count() > 0) { await item.click(); return; }
  }

  // 4) Último recurso: qualquer elemento clicável visível com o texto
  const qualquer = page.locator(':is(button, a, div, span)', { hasText: sel.textosUnificar }).first();
  if (await qualquer.count() > 0 && await qualquer.isVisible().catch(() => false)) {
    await qualquer.click();
    return;
  }

  throw new Error('botão de unificar não encontrado após selecionar as linhas (ajuste src/seletores.js)');
}

/**
 * No modal de unificação, tenta priorizar os valores do lead MAIS RECENTE
 * (elementos marcados com o id dele) e confirma. Retorna true se confirmou.
 */
async function tratarModal(page, idMaisRecente) {
  const modal = await primeiro(page, sel.modalUnificacao);
  const escopo = modal || page;
  await dormir(600);

  // Prioriza valores do lead mais recente onde o modal permitir escolher
  try {
    const opcoes = escopo.locator(
      `[data-id="${idMaisRecente}"], [data-lead-id="${idMaisRecente}"], input[value="${idMaisRecente}"]`
    );
    const n = await opcoes.count();
    for (let i = 0; i < Math.min(n, 60); i++) {
      await opcoes.nth(i).click({ force: true, timeout: 1500 }).catch(() => {});
    }
    if (n > 0) log(`  modal: ${n} campos apontados para o lead mais recente #${idMaisRecente}`);
  } catch (_) { /* se o modal não expõe escolha por lead, segue com os padrões */ }

  if (cfg.dryRun) return true;

  // Confirma: primeiro por seletor conhecido, depois por texto
  let confirmar = await primeiro(escopo, sel.botaoConfirmarModal);
  if (!confirmar || !(await confirmar.isVisible().catch(() => false))) {
    confirmar = escopo.locator('button, .button-input, [type="submit"]', { hasText: sel.textosUnificar }).first();
    if (await confirmar.count() === 0) {
      confirmar = escopo.locator('button, .button-input, [type="submit"]', { hasText: /salvar|save|confirmar|ok/i }).first();
    }
  }
  if (!confirmar || await confirmar.count() === 0) return false;

  await confirmar.click();

  // Espera o modal sumir (unificação processada)
  if (modal) {
    await modal.waitFor({ state: 'hidden', timeout: cfg.timeoutMs }).catch(() => {});
  }
  return true;
}

module.exports = { merge };
