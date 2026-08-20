require('dotenv').config();
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const subdomain = process.env.KOMMO_SUBDOMAIN || '';
const domain = process.env.KOMMO_DOMAIN || 'kommo.com';

module.exports = {
  subdomain,
  baseUrl: `https://${subdomain}.${domain}`,
  listUrl: process.env.CUSTOM_LIST_URL || `https://${subdomain}.${domain}/leads/list/`,

  headless: (process.env.HEADLESS || 'true').toLowerCase() !== 'false',
  dryRun: (process.env.DRY_RUN || 'true').toLowerCase() !== 'false',
  batchSize: parseInt(process.env.BATCH_SIZE || '50', 10),
  maxPorUnificacao: Math.max(2, parseInt(process.env.MAX_LEADS_POR_UNIFICACAO || '6', 10)),
  pausaEntreGruposMs: parseInt(process.env.PAUSA_ENTRE_GRUPOS_MS || '800', 10),
  timeoutMs: parseInt(process.env.TIMEOUT_MS || '20000', 10),
  slowMo: parseInt(process.env.SLOW_MO || '0', 10),

  paths: {
    dataDir: DATA_DIR,
    storageState: path.join(DATA_DIR, 'storageState.json'),
    leads: path.join(DATA_DIR, 'leads.json'),
    duplicados: path.join(DATA_DIR, 'duplicados.json'),
    estado: path.join(DATA_DIR, 'estado.json'),
    logFile: path.join(DATA_DIR, 'bot.log'),
  },
};
