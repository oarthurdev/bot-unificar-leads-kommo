#!/usr/bin/env node
/**
 * Bot de unificação de leads duplicados na Kommo CRM (via interface web).
 *
 * Comandos:
 *   node bot.js login   → abre navegador para você logar; salva a sessão
 *   node bot.js scan    → varre a lista de leads e gera data/duplicados.json
 *   node bot.js merge   → unifica os duplicados em lotes (retomável)
 *   node bot.js status  → mostra o progresso
 */
const cfg = require('./src/config');
const { log, lerJson } = require('./src/util');

async function main() {
  const cmd = (process.argv[2] || '').toLowerCase();

  switch (cmd) {
    case 'login':
      await require('./src/login').login();
      break;

    case 'scan':
      await require('./src/scan').scan();
      break;

    case 'merge':
      await require('./src/merge').merge();
      break;

    case 'status': {
      const dups = lerJson(cfg.paths.duplicados, []);
      const estado = lerJson(cfg.paths.estado, { concluidos: {}, falhas: {} });
      const concluidos = Object.keys(estado.concluidos).length;
      const falhas = Object.keys(estado.falhas).length;
      const totalLeads = dups.reduce((s, g) => s + g.total, 0);
      log('=============== STATUS ===============');
      log(`Grupos de duplicados detectados: ${dups.length} (${totalLeads} leads envolvidos)`);
      log(`Grupos unificados:               ${concluidos}`);
      log(`Grupos com falha:                ${falhas}`);
      log(`Grupos pendentes:                ${dups.length - concluidos}`);
      if (falhas > 0) log('Detalhes das falhas em data/estado.json (serão re-tentados no próximo merge).');
      break;
    }

    default:
      console.log(`Uso: node bot.js <comando>

  login   Abre o navegador para login manual na Kommo (salva a sessão)
  scan    Varre todos os leads e detecta duplicados por nome
  merge   Unifica os duplicados em lotes (BATCH_SIZE no .env), mantendo o mais recente
  status  Mostra o progresso da unificação

Fluxo: npm run login  →  npm run scan  →  npm run merge (repetir até zerar)`);
  }
}

main().catch((e) => {
  log(`ERRO: ${e.message}`);
  process.exit(1);
});
