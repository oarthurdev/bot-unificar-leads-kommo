const fs = require('fs');
const cfg = require('./config');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(cfg.paths.logFile, line + '\n'); } catch (_) {}
}

function lerJson(caminho, padrao) {
  try {
    if (fs.existsSync(caminho)) return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch (e) {
    log(`AVISO: falha ao ler ${caminho}: ${e.message}`);
  }
  return padrao;
}

function salvarJson(caminho, dados) {
  const tmp = caminho + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), 'utf8');
  fs.renameSync(tmp, caminho);
}

// Normaliza nome para agrupar duplicados: minúsculas, sem acentos, espaços colapsados
function normalizarNome(nome) {
  return (nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { log, lerJson, salvarJson, normalizarNome, dormir };
