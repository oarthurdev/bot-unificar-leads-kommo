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

  // Destino dos leads unificados: funil "12347316" (etapa padrão = primeira etapa
  // regular do funil; defina STATUS_DESTINO com o id da etapa para escolher outra)
  pipelineDestino: process.env.PIPELINE_DESTINO || '12347316',
  statusDestino: process.env.STATUS_DESTINO || '',

  // Abas simultâneas na fase 2 (verificar/mover leads após a união)
  concorrenciaFase2: Math.max(1, parseInt(process.env.CONCORRENCIA_FASE2 || '3', 10)),

  // Regras por funil:
  //  - 2 ou mais leads do grupo no funil de VENDAS → pular (não unificar)
  //  - exatamente 1 no funil de vendas → unificar PARA o funil de vendas
  //    (etapa do lead de vendas), com os dados do lead mais recente
  pipelineVendas: process.env.PIPELINE_VENDAS || '8865067',

  paths: {
    dataDir: DATA_DIR,
    storageState: path.join(DATA_DIR, 'storageState.json'),
    leads: path.join(DATA_DIR, 'leads.json'),
    duplicados: path.join(DATA_DIR, 'duplicados.json'),
    estado: path.join(DATA_DIR, 'estado.json'),
    logFile: path.join(DATA_DIR, 'bot.log'),
  },
};
