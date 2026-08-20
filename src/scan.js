const cfg = require('./config');
const sel = require('./seletores');
const { abrirNavegador, todos, garantirLogado } = require('./navegador');
const { log, salvarJson, normalizarNome, dormir } = require('./util');

/**
 * Varre a lista de leads (/leads/list/) rolando até o fim, coleta {id, nome}
 * de cada linha e agrupa duplicados por nome normalizado.
 *
 * Critério "mais recente": na Kommo os IDs de lead são sequenciais e crescentes,
 * então o lead com MAIOR ID é o criado mais recentemente. Isso evita depender
 * da coluna de data (que pode não estar visível na lista).
 *
 * Saída: data/leads.json e data/duplicados.json
 */
async function scan() {
  const { browser, page } = await abrirNavegador();
  try {
    log(`Abrindo lista de leads: ${cfg.listUrl}`);
    await page.goto(cfg.listUrl, { waitUntil: 'domcontentloaded' });
    await garantirLogado(page);

    const linhas = await todos(page, sel.linhaLead);
    if (!linhas) {
      throw new Error(
        'Nenhuma linha de lead encontrada. Verifique se a conta tem leads e, ' +
        'se o layout mudou, ajuste os seletores em src/seletores.js (linhaLead).'
      );
    }

    // Coleta incremental com rolagem infinita
    const mapa = new Map(); // id -> { id, nome }
    let estaveis = 0;

    const coletar = async () => {
      const extraidos = await page.evaluate((s) => {
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

      for (const l of extraidos) mapa.set(String(l.id), { id: String(l.id), nome: l.nome });
    };

    await coletar();
    log(`Coletados ${mapa.size} leads na primeira tela. Rolando a lista...`);

    // Rola até a contagem parar de crescer por 3 rodadas seguidas
    while (estaveis < 3) {
      const antes = mapa.size;
      await page.evaluate(() => {
        const alvo =
          document.querySelector('.list__body-right__wrapper') ||
          document.querySelector('.list__body') ||
          document.scrollingElement;
        if (alvo) alvo.scrollTop = alvo.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
      });
      await dormir(1200);
      await coletar();
      if (mapa.size === antes) estaveis++;
      else {
        estaveis = 0;
        if (mapa.size % 500 < 50) log(`... ${mapa.size} leads coletados`);
      }
    }

    const leads = Array.from(mapa.values());
    salvarJson(cfg.paths.leads, leads);
    log(`Varredura concluída: ${leads.length} leads salvos em data/leads.json`);

    // Agrupa duplicados por nome normalizado
    const grupos = new Map();
    for (const l of leads) {
      const chave = normalizarNome(l.nome);
      if (!chave) continue;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(l);
    }

    const duplicados = [];
    for (const [chave, itens] of grupos) {
      if (itens.length < 2) continue;
      // Maior ID = mais recente → primeiro da lista
      const ids = itens.map((i) => parseInt(i.id, 10)).sort((a, b) => b - a).map(String);
      duplicados.push({
        chave,
        nome: itens[0].nome,
        idMaisRecente: ids[0],
        ids,
        total: ids.length,
      });
    }
    duplicados.sort((a, b) => b.total - a.total);

    salvarJson(cfg.paths.duplicados, duplicados);
    const totalLeadsDup = duplicados.reduce((s, g) => s + g.total, 0);
    log(`Encontrados ${duplicados.length} grupos de duplicados (${totalLeadsDup} leads envolvidos).`);
    log('Revise data/duplicados.json e depois rode: npm run merge');
  } finally {
    await browser.close();
  }
}

module.exports = { scan };
