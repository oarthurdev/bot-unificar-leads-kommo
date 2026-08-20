const fs = require('fs');
const { chromium } = require('playwright');
const cfg = require('./config');
const { log } = require('./util');

/**
 * Abre navegador + contexto com a sessão salva (storageState).
 * Bloqueia imagens/fontes/mídia para acelerar (essencial com 1000+ leads).
 */
async function abrirNavegador({ headless = cfg.headless, comSessao = true, bloquearRecursos = true } = {}) {
  if (comSessao && !fs.existsSync(cfg.paths.storageState)) {
    throw new Error(
      `Sessão não encontrada (${cfg.paths.storageState}).\n` +
      'Execute primeiro: npm run login'
    );
  }

  const browser = await chromium.launch({ headless, slowMo: cfg.slowMo });
  const context = await browser.newContext({
    storageState: comSessao ? cfg.paths.storageState : undefined,
    viewport: { width: 1600, height: 900 },
    locale: 'pt-BR',
  });
  context.setDefaultTimeout(cfg.timeoutMs);

  if (bloquearRecursos) {
    await context.route('**/*', (route) => {
      const tipo = route.request().resourceType();
      if (tipo === 'image' || tipo === 'font' || tipo === 'media') return route.abort();
      const url = route.request().url();
      if (/google-analytics|googletagmanager|facebook|hotjar|intercom|amplitude/i.test(url)) {
        return route.abort();
      }
      return route.continue();
    });
  }

  const page = await context.newPage();
  return { browser, context, page };
}

/** Retorna o primeiro locator (dentre os candidatos) que existe na página/escopo. */
async function primeiro(escopo, candidatos) {
  for (const sel of candidatos) {
    try {
      const loc = escopo.locator(sel).first();
      if (await loc.count() > 0) return loc;
    } catch (_) { /* seletor inválido nesse contexto — tenta o próximo */ }
  }
  return null;
}

/** Como `primeiro`, mas retorna o locator "cru" (todos os matches) do 1º candidato com resultados. */
async function todos(escopo, candidatos) {
  for (const sel of candidatos) {
    try {
      const loc = escopo.locator(sel);
      if (await loc.count() > 0) return loc;
    } catch (_) { /* tenta o próximo */ }
  }
  return null;
}

/** Salva os cookies atuais (a Kommo renova tokens durante o uso — persistir
 *  ao fim de cada execução mantém a sessão viva entre execuções). */
async function salvarSessao(context) {
  try {
    await context.storageState({ path: cfg.paths.storageState });
  } catch (_) { /* sessão não salva — sem impacto na execução atual */ }
}

/** Verifica se a sessão salva ainda é válida (não caiu na tela de login). */
async function garantirLogado(page) {
  const url = page.url();
  if (/\/(login|auth|oauth)/i.test(url) || /id\.kommo\.com/i.test(url)) {
    throw new Error('Sessão expirou — a Kommo redirecionou para o login. Rode: npm run login');
  }
  return true;
}

module.exports = { abrirNavegador, primeiro, todos, garantirLogado, salvarSessao, log };
