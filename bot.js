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
      const estado = lerJson(cfg.paths.estado, { totalUnificados: 0, pendentesMover: [], movidos: [], falhas: [] });
      log('=============== STATUS ===============');
      log(`Duplicatas unificadas (acumulado): ${estado.totalUnificados}`);
      log(`Movidos para o funil ${cfg.pipelineDestino}:   ${estado.movidos.length}`);
      log(`Aguardando mover de funil:         ${estado.pendentesMover.length}`);
      log(`Falhas registradas:                ${estado.falhas.length}`);
      log('O total de duplicatas restantes aparece no título do assistente a cada "npm run merge".');
      break;
    }

    default:
      console.log(`Uso: node bot.js <comando>

  login   Abre o navegador para login manual na Kommo (salva a sessão)
  merge   Une duplicatas pelo assistente "Localizar duplicatas" em lotes
          (mantém o lead mais recente e move o unificado para o funil destino)
  status  Mostra o progresso da unificação
  scan    (opcional) Varre a lista de leads e gera um relatório de duplicados por nome

Fluxo: npm run login  →  npm run merge (repetir até zerar)`);
  }
}

main().catch((e) => {
  log(`ERRO: ${e.message}`);
  process.exit(1);
});
