const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const sel = require('./seletores');
const { abrirNavegador, garantirLogado, salvarSessao } = require('./navegador');
const { log, lerJson, salvarJson, dormir } = require('./util');
const { moverPendentes, abrirAssistente } = require('./merge');

const ARQUIVO_SKIP = path.join(cfg.paths.dataDir, 'skip-request.json');

/**
 * MODO TURBO: reproduz as requisições AJAX que o próprio assistente
 * "Localizar duplicatas" dispara (capturadas em data/rede-uniao.json),
 * sem esperar a interface redesenhar cada tela:
 *
 *   GET  /ajax/v4/doubles/leads        → próximo grupo de duplicatas
 *   POST /ajax/merge/leads/info/       → campos/valores dos leads
 *   POST /ajax/merge/contacts/info/    → campos/valores dos contatos
 *   POST /ajax/merge/leads/save        → executa a união (202 = na fila)
 *
 * Regra idêntica ao modo normal: vence o lead criado MAIS RECENTEMENTE
 * (result_element[ID] = vencedor; campos preferem o valor do vencedor;
 * tags/e-mails/telefones são unidos). ~1-2s por união em vez de ~8s.
 *
 * FASE 2 acelerada: existência verificada por requisição (~0,2s por lead);
 * a UI só é usada no caso raro de um lead antigo sobreviver e precisar
 * ser movido para o funil destino.
 */
async function turbo() {
  const estado = lerJson(cfg.paths.estado, {
    totalUnificados: 0,
    pendentesMover: [],
    movidos: [],
    falhas: [],
    pulados: [],
  });
  if (!estado.pulados) estado.pulados = [];

  const { browser, context, page } = await abrirNavegador();
  const api = context.request;
  const H = {
    'x-requested-with': 'XMLHttpRequest',
    accept: 'application/json, text/javascript, */*; q=0.01',
    referer: `${cfg.baseUrl}/leads/pipeline/`,
  };
  const HPOST = { ...H, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  try {
    // Estabelece a sessão no app (e valida o login)
    await page.goto(`${cfg.baseUrl}/leads/pipeline/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await dormir(1500);
    await garantirLogado(page);

    const limite = cfg.batchSize > 0 ? cfg.batchSize : Infinity;
    let processadas = 0;
    let total = null;
    let ultimoUuid = null;
    let repeticoes = 0;
    const inicio = Date.now();

    while (processadas < limite) {
      // 1) Próximo grupo de duplicatas
      const rd = await api.get(`${cfg.baseUrl}/ajax/v4/doubles/leads${total === null ? '?with=count' : ''}`, { headers: H });
      if (rd.status() === 401 || rd.status() === 403) {
        throw new Error('sessão expirou (HTTP 401) — rode "npm run login" e depois "npm run turbo" novamente');
      }
      if (!rd.ok()) throw new Error(`doubles/leads retornou HTTP ${rd.status()}`);
      const jd = await rd.json().catch(() => null);
      if (total === null) total = jd?.total ?? 0;
      const double = jd?.double;
      if (!double || !Array.isArray(double.leads) || double.leads.length < 2) {
        log('Não há mais duplicatas na fila — concluído!');
        break;
      }

      const uuid = (double.group_uuids || []).join(',');
      if (uuid && uuid === ultimoUuid) {
        // servidor ainda processando a união anterior — aguarda e tenta de novo
        repeticoes++;
        if (repeticoes >= 8) throw new Error('o mesmo grupo voltou 8 vezes — o servidor não está processando as uniões; aguarde alguns minutos e rode novamente');
        await dormir(2000);
        continue;
      }
      repeticoes = 0;
      ultimoUuid = uuid;

      // 2) Detalhes dos leads e contatos do grupo
      const fLeads = new URLSearchParams();
      double.leads.forEach((id) => fLeads.append('id[]', String(id)));
      (double.group_uuids || []).forEach((u) => fLeads.append('group_uuids[]', u));
      const ri = await api.post(`${cfg.baseUrl}/ajax/merge/leads/info/`, { headers: HPOST, data: fLeads.toString() });
      const leadsInfo = (await ri.json().catch(() => null))?.response;
      if (!leadsInfo) throw new Error(`merge/leads/info falhou (HTTP ${ri.status()})`);

      let contatosInfo = null;
      if (Array.isArray(double.contacts) && double.contacts.length) {
        const fCont = new URLSearchParams();
        double.contacts.forEach((id) => fCont.append('id[]', String(id)));
        const rc = await api.post(`${cfg.baseUrl}/ajax/merge/contacts/info/`, { headers: HPOST, data: fCont.toString() });
        contatosInfo = (await rc.json().catch(() => null))?.response || null;
      }

      // 3) Aplica as regras por funil
      const decisao = decidirGrupo(double, leadsInfo);
      const rotulo = decisao.nomes.filter(Boolean).join(' + ') || decisao.ids.join(' + ');

      if (decisao.acao === 'pular') {
        log(`Pulando grupo [${rotulo}]: ${decisao.motivo} (restam ~${Math.max(0, total - processadas)})`);
        if (cfg.dryRun) {
          log('[DRY_RUN] O grupo seria pulado (marcado como "não duplicata" na Kommo). Nada foi feito.');
          break;
        }
        await pularGrupo(api, HPOST, page, double);
        estado.pulados.push({ ids: decisao.ids, nomes: decisao.nomes, motivo: decisao.motivo, quando: new Date().toISOString() });
        salvarJson(cfg.paths.estado, estado);
        continue;
      }

      // 4) Monta o payload com a regra "mais recente vence"
      const { params, idNovo, ids, nomes } = montarPayload(double, leadsInfo, contatosInfo);
      if (decisao.acao === 'unir-vendas') {
        // resultado vai para o funil de vendas, na etapa do lead que já está lá
        params.set('result_element[STATUS]', decisao.statusVendas);
        params.set('result_element[PIPELINE_ID]', cfg.pipelineVendas);
      }
      log(`União ${processadas + 1}${limite === Infinity ? '' : `/${limite}`} (restam ~${Math.max(0, total - processadas)}): [${nomes.filter(Boolean).join(' + ') || ids.join(' + ')}] → mantém #${idNovo}${decisao.acao === 'unir-vendas' ? ` NO FUNIL DE VENDAS (etapa do lead #${decisao.idVendas})` : ''}`);

      if (cfg.dryRun) {
        log('[DRY_RUN] Payload montado e validado — NADA foi enviado. Amostra:');
        log('  ' + decodeURIComponent(params.toString()).slice(0, 400) + '...');
        break;
      }

      // 4) Executa a união
      let sr = await api.post(`${cfg.baseUrl}/ajax/merge/leads/save`, { headers: HPOST, data: params.toString() });
      if (sr.status() !== 202 && sr.status() !== 200) {
        log(`  save retornou HTTP ${sr.status()} — re-tentando em 2s...`);
        await dormir(2000);
        sr = await api.post(`${cfg.baseUrl}/ajax/merge/leads/save`, { headers: HPOST, data: params.toString() });
        if (sr.status() !== 202 && sr.status() !== 200) {
          const corpo = (await sr.text().catch(() => '')).slice(0, 300);
          estado.falhas.push({ ids, idNovo, nomes, erro: `save HTTP ${sr.status()}: ${corpo}`, quando: new Date().toISOString() });
          salvarJson(cfg.paths.estado, estado);
          throw new Error(`união recusada pelo servidor (HTTP ${sr.status()}). Interrompido por segurança — veja data/estado.json`);
        }
      }

      estado.pendentesMover.push({ ids, idNovo, nomes, quando: new Date().toISOString() });
      estado.totalUnificados++;
      processadas++;
      salvarJson(cfg.paths.estado, estado);

      if (processadas % 25 === 0) {
        const mediaSeg = (Date.now() - inicio) / 1000 / processadas;
        const restantes = Math.max(0, total - processadas);
        log(`  >>> ${processadas} uniões (${mediaSeg.toFixed(1)}s/união) — restam ~${restantes} (~${Math.round((restantes * mediaSeg) / 60)} min)`);
      }
    }

    // FASE 2 (SKIP_FASE2=true adia para a próxima execução)
    if (process.env.SKIP_FASE2 === 'true') {
      log('FASE 2 adiada (SKIP_FASE2=true) — será retomada na próxima execução.');
    } else if (!cfg.dryRun && estado.pendentesMover.length > 0) {
      log(`FASE 2 (turbo): verificando ${estado.pendentesMover.length} grupos...`);
      await dormir(5000); // dá fôlego para a fila de uniões do servidor processar
      await fase2Turbo(api, H, context, page, estado);
    }
  } finally {
    salvarJson(cfg.paths.estado, estado);
    await salvarSessao(context); // mantém a sessão renovada para a próxima execução
    await browser.close();
  }

  log('================ RESUMO ================');
  log(`Duplicatas unificadas (total acumulado): ${estado.totalUnificados}`);
  log(`Grupos pulados pelas regras de funil:    ${estado.pulados.length}`);
  log(`Grupos tratados na fase 2:               ${estado.movidos.length}`);
  log(`Grupos aguardando fase 2:                ${estado.pendentesMover.length}`);
  log(`Falhas registradas:                      ${estado.falhas.length}`);
  if (cfg.dryRun) log('DRY_RUN estava ativo: nada foi alterado.');
}

/**
 * Regras por funil:
 *  - todos no funil de VENDAS            → pular
 *  - 2+ no funil de vendas (mas não todos) → pular (ambíguo, não mexe)
 *  - algum lead no SDR                   → pular (SDR fica onde está)
 *  - exatamente 1 no funil de vendas     → unir PARA o funil de vendas
 *  - nenhum no funil de vendas           → unir normal (mais recente vence)
 */
function decidirGrupo(double, leadsInfo) {
  const ids = (leadsInfo.elements || double.leads).map(String);
  const nomes = ids.map((id) => leadsInfo.compare_values?.NAME?.[id]?.values?.[0]?.label || '');
  const pipelineDe = (id) => String(leadsInfo.compare_values?.PIPELINE_ID?.[id]?.values?.[0]?.value || '');
  const statusDe = (id) => String(leadsInfo.compare_values?.STATUS?.[id]?.values?.[0]?.value || '');

  const emVendas = ids.filter((id) => pipelineDe(id) === String(cfg.pipelineVendas));
  const emSDR = ids.filter((id) => pipelineDe(id) === String(cfg.pipelineSDR));

  if (emVendas.length === ids.length) {
    return { acao: 'pular', motivo: 'todos os leads já estão no funil de vendas', ids, nomes };
  }
  if (emSDR.length > 0) {
    return { acao: 'pular', motivo: `lead(s) no funil SDR (${emSDR.map((i) => '#' + i).join(', ')}) — ficam onde estão`, ids, nomes };
  }
  if (emVendas.length === 1) {
    return { acao: 'unir-vendas', idVendas: emVendas[0], statusVendas: statusDe(emVendas[0]), ids, nomes };
  }
  if (emVendas.length > 1) {
    return { acao: 'pular', motivo: `${emVendas.length} leads no funil de vendas e outros fora — ambíguo, não mexer`, ids, nomes };
  }
  return { acao: 'unir', ids, nomes };
}

/**
 * Pula o grupo atual (equivale ao botão "Pular esta duplicata" — a Kommo marca
 * o grupo como "não duplicata" e a fila avança). Na primeira vez, captura a
 * requisição real clicando no botão pela interface; depois replica direto.
 */
async function pularGrupo(api, HPOST, page, double) {
  let template = fs.existsSync(ARQUIVO_SKIP) ? lerJson(ARQUIVO_SKIP, null) : null;

  if (template) {
    const { url, data, ehJson } = montarSkipReplay(template, double);
    const headers = ehJson
      ? { ...HPOST, 'content-type': 'application/json' }
      : HPOST;
    const r = template.metodo === 'GET'
      ? await api.get(url, { headers })
      : await api.post(url, { headers, data });
    if (r.status() >= 400) throw new Error(`skip replicado falhou (HTTP ${r.status()})`);
    await dormir(400);
    return;
  }

  // Primeira vez: captura via interface
  log('  (primeira pulada: capturando a requisição do botão "Pular esta duplicata"...)');
  const capturadas = [];
  const ouvinte = (req) => {
    if (req.method() !== 'GET' && /doubl|merge|skip|ignore/i.test(req.url())) {
      capturadas.push({ metodo: req.method(), url: req.url(), postData: req.postData() || '' });
    }
  };
  page.on('request', ouvinte);
  try {
    const abriu = await abrirAssistente(page);
    if (!abriu) throw new Error('assistente não abriu para capturar o botão Pular');
    await page.locator(sel.botaoPular).first().click();
    await dormir(4000);
    await page.locator(sel.botaoCancelar).first().click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  } finally {
    page.off('request', ouvinte);
  }

  const skipReq = capturadas.find((c) => !/\/merge\/(leads|contacts)\/info|\/merge\/leads\/save/.test(c.url));
  if (!skipReq) throw new Error(`não capturei a requisição de pular (vistas: ${capturadas.map((c) => c.url).join(' | ') || 'nenhuma'})`);
  fs.writeFileSync(ARQUIVO_SKIP, JSON.stringify(skipReq, null, 2), 'utf8');
  log(`  requisição de pular capturada: ${skipReq.metodo} ${skipReq.url.slice(0, 100)}`);
  // O clique na interface já pulou o grupo atual — nada mais a fazer.
}

/** Reconstrói a requisição de pular para o grupo atual (substitui uuids/ids). */
function montarSkipReplay(template, double) {
  const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const uuids = double.group_uuids || [];
  let url = template.url;
  if (RE_UUID.test(url) && uuids.length) url = url.replace(RE_UUID, uuids[0]);

  let data = template.postData || '';
  const ehJson = /^\s*[{[]/.test(data);
  if (ehJson) {
    // corpo JSON: troca uuids e listas de ids pelo grupo atual
    let iUuid = 0;
    data = data.replace(RE_UUID, () => uuids[Math.min(iUuid++, Math.max(0, uuids.length - 1))] || '');
    try {
      const obj = JSON.parse(data);
      const trocarIds = (o) => {
        for (const k of Object.keys(o)) {
          if (Array.isArray(o[k]) && o[k].every((x) => /^\d+$/.test(String(x)))) {
            if (/lead/i.test(k) || k === 'id' || k === 'ids' || k === 'elements') o[k] = double.leads;
            else if (/contact/i.test(k)) o[k] = double.contacts || o[k];
          } else if (o[k] && typeof o[k] === 'object') trocarIds(o[k]);
        }
      };
      trocarIds(obj);
      data = JSON.stringify(obj);
    } catch (_) { /* mantém a substituição só de uuids */ }
    return { url, data, ehJson };
  }
  if (data) {
    const antigos = new URLSearchParams(data);
    const novos = new URLSearchParams();
    let iUuid = 0;
    for (const [k, v] of antigos) {
      if (RE_UUID.test(String(v))) {
        RE_UUID.lastIndex = 0;
        novos.append(k, uuids[Math.min(iUuid++, uuids.length - 1)] || v);
      } else if (k === 'id[]' || /\[leads\]\[\]$/.test(k)) {
        // ids dos leads do grupo atual
        continue; // adicionados abaixo, uma vez só
      } else {
        novos.append(k, v);
      }
      RE_UUID.lastIndex = 0;
    }
    if ([...new URLSearchParams(template.postData)].some(([k]) => k === 'id[]')) {
      double.leads.forEach((id) => novos.append('id[]', String(id)));
    }
    data = novos.toString();
  }
  return { url, data, ehJson: false };
}

/** Monta o form-data do save escolhendo o lead/contato mais recente como vencedor. */
function montarPayload(double, leadsInfo, contatosInfo) {
  const p = new URLSearchParams();

  const idsLead = (leadsInfo.elements || double.leads).map(String);
  const vencedorLead = escolherMaisRecente(idsLead, leadsInfo.compare_values);
  idsLead.forEach((id) => p.append('id[]', id));
  preencherCampos(p, 'result_element', leadsInfo, idsLead, vencedorLead, ['CONTACTS']);
  p.append('result_element[ID]', vencedorLead);

  if (contatosInfo) {
    const idsCont = (contatosInfo.elements || double.contacts).map(String);
    const vencedorCont = escolherMaisRecente(idsCont, contatosInfo.compare_values);
    const pre = 'double[duplicate-contact-group]';
    idsCont.forEach((id) => p.append(`${pre}[id][]`, id));
    preencherCampos(p, `${pre}[result_element]`, contatosInfo, idsCont, vencedorCont, ['LEADS']);
    p.append(`${pre}[result_element][ID]`, vencedorCont);
    (double.group_uuids || []).forEach((u) => p.append(`${pre}[group_uuids][]`, u));
  }

  const nomes = idsLead.map((id) => leadsInfo.compare_values?.NAME?.[id]?.values?.[0]?.label || '');
  return { params: p, idNovo: vencedorLead, ids: idsLead, nomes };
}

/** Mais recente = maior DATE_CREATE; empate = maior ID. */
function escolherMaisRecente(ids, compareValues) {
  const dataDe = (id) => compareValues?.DATE_CREATE?.[id]?.values?.[0]?.value || '';
  return [...ids].sort((a, b) => {
    const da = dataDe(a), db = dataDe(b);
    if (da !== db) return da < db ? -1 : 1;
    return Number(a) - Number(b);
  }).pop();
}

/**
 * Para cada campo: valor do vencedor; se o vencedor não tem o campo, usa o
 * marcado como selected (padrão da Kommo) ou o primeiro disponível.
 * Campos de múltipla escolha (checked: tags, e-mails, telefones) = união de todos.
 */
function preencherCampos(p, prefixo, info, ids, vencedor, ignorar) {
  for (const campo of Object.keys(info.compare_fields || {})) {
    if (ignorar.includes(campo)) continue;
    const porEl = info.compare_values?.[campo] || {};

    const chaveBase = campo.startsWith('cfv_')
      ? `${prefixo}[cfv][${campo.slice(4)}]`
      : `${prefixo}[${campo}]`;

    // múltipla escolha?
    let multi = campo === 'TAGS';
    const todas = [];
    for (const id of ids) {
      for (const v of porEl[id]?.values || []) {
        if ('checked' in v) multi = true;
        todas.push(v);
      }
    }

    if (multi) {
      const vistos = new Set();
      for (const v of todas) {
        const val = decodeHtml(String(v.value));
        if (!vistos.has(val)) { vistos.add(val); p.append(`${chaveBase}[]`, val); }
      }
    } else {
      let val = porEl[vencedor]?.values?.[0]?.value;
      if (val === undefined || val === null || val === '') {
        const escolhido = todas.find((v) => v.selected) || todas[0];
        val = escolhido ? escolhido.value : undefined;
      }
      if (val !== undefined && val !== null) p.append(chaveBase, decodeHtml(String(val)));
    }
  }
}

function decodeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * FASE 2 turbo: existência via /api/v4/leads/{id} (sessão web autoriza).
 * Grupos onde tudo foi absorvido são resolvidos sem abrir a UI; os raros
 * casos com lead antigo sobrevivente vão para a rotina de UI (moverPendentes).
 */
async function fase2Turbo(api, H, context, page, estado) {
  let apiOk = true;

  const existeLead = async (id) => {
    const r = await api.get(`${cfg.baseUrl}/api/v4/leads/${id}`, { headers: H }).catch(() => null);
    if (!r) return null;
    if (r.status() === 200) return true;
    if (r.status() === 404 || r.status() === 204) return false;
    if (r.status() === 401 || r.status() === 403) { apiOk = false; return null; }
    return null;
  };

  const fila = [...estado.pendentesMover];
  let resolvidosRapido = 0;

  for (const item of fila) {
    if (!apiOk) break;
    const novoExiste = await existeLead(item.idNovo);
    if (novoExiste !== true) continue; // deixa para a rotina de UI decidir

    const antigos = item.ids.filter((i) => i !== item.idNovo);
    const checagens = await Promise.all(antigos.map((a) => existeLead(a)));
    if (checagens.every((c) => c === false)) {
      estado.movidos.push({
        ...item,
        detalhes: [
          { leadId: item.idNovo, acao: 'mais recente, mantido onde está' },
          ...antigos.map((a) => ({ leadId: a, acao: 'absorvido pela união (não existe mais)' })),
        ],
        quando: new Date().toISOString(),
      });
      estado.pendentesMover = estado.pendentesMover.filter((x) => x !== item);
      resolvidosRapido++;
      if (resolvidosRapido % 50 === 0) {
        salvarJson(cfg.paths.estado, estado);
        log(`  fase 2 rápida: ${resolvidosRapido} grupos confirmados (absorvidos)...`);
      }
    }
    // se algum antigo sobreviveu (ou está em processamento), fica em pendentesMover
  }
  salvarJson(cfg.paths.estado, estado);
  log(`  fase 2 rápida: ${resolvidosRapido} grupos resolvidos sem UI; ${estado.pendentesMover.length} restantes para a rotina completa.`);

  if (estado.pendentesMover.length > 0) {
    await moverPendentes(context, page, estado);
  }
}

module.exports = { turbo };
