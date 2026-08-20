const cfg = require('./config');
const sel = require('./seletores');
const { abrirNavegador, primeiro } = require('./navegador');
const { log } = require('./util');

/**
 * Abre o navegador VISÍVEL para você fazer login manualmente na Kommo
 * (inclusive 2FA, se houver). Quando o CRM carregar, a sessão é salva
 * em data/storageState.json e reutilizada pelos comandos scan/merge.
 */
async function login() {
  if (!cfg.subdomain) {
    throw new Error('Defina KOMMO_SUBDOMAIN no arquivo .env (copie de .env.example).');
  }

  const { browser, context, page } = await abrirNavegador({
    headless: false,
    comSessao: false,
    bloquearRecursos: false,
  });

  log(`Abrindo ${cfg.baseUrl} — faça o login manualmente na janela do navegador.`);
  await page.goto(cfg.baseUrl, { waitUntil: 'domcontentloaded' });

  // Espera até 5 minutos o usuário concluir o login (menu do CRM visível)
  const prazo = Date.now() + 5 * 60 * 1000;
  let logado = false;
  while (Date.now() < prazo) {
    const menu = await primeiro(page, sel.indicadorLogado);
    const urlOk = /\/(leads|dashboard|todo|settings)/i.test(page.url());
    if (menu || urlOk) { logado = true; break; }
    await page.waitForTimeout(2000);
  }

  if (!logado) {
    await browser.close();
    throw new Error('Login não detectado em 5 minutos. Tente novamente: npm run login');
  }

  await context.storageState({ path: cfg.paths.storageState });
  log(`Sessão salva em ${cfg.paths.storageState}. Agora rode: npm run scan`);
  await browser.close();
}

module.exports = { login };
