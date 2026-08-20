/**
 * Seletores da interface web da Kommo (baseada no front do amoCRM).
 * Cada entrada é uma LISTA de candidatos — o bot usa o primeiro que existir na página.
 * Se a Kommo mudar o layout, ajuste apenas este arquivo.
 */
module.exports = {
  // Linha de lead na lista (/leads/list/)
  linhaLead: [
    '.list__body-right__wrapper .js-list-row',
    'tr.list-row[data-id]',
    '.list__row[data-id]',
    '[data-entity="leads"] [data-id].js-list-row',
  ],

  // Célula/link com o nome do lead dentro da linha
  nomeLead: [
    '.list__body-right__row__link',
    'a[href*="/leads/detail/"]',
    '.js-navigate-link',
  ],

  // Checkbox de seleção dentro da linha
  checkboxLinha: [
    'input[type="checkbox"]',
    '.control--checkbox',
    '.js-item-checkbox',
  ],

  // Campo de busca global / da lista
  campoBusca: [
    'input.js-search-input',
    '#search_input',
    'input[type="search"]',
    'input[placeholder*="usca"]',
    'input[placeholder*="earch"]',
  ],

  // Barra de ações que aparece ao selecionar linhas
  barraAcoes: [
    '.list-actions',
    '.js-list-actions',
    '.list__body-right__top__actions',
  ],

  // Botão "..." / mais ações (a unificação às vezes fica dentro dele)
  botaoMais: [
    '.js-list-actions-more',
    '.list-actions__more',
    'button:has-text("...")',
  ],

  // Botão de unificar/mesclar na barra de ações (fallback: busca por texto)
  botaoUnificar: [
    '.js-merge',
    '.js-list-merge',
    '#list_actions_merge',
  ],
  textosUnificar: /unificar|mesclar|merge|combinar/i,

  // Modal de unificação
  modalUnificacao: [
    '.modal.merge',
    '.merge-modal',
    '.modal:has-text("nificar")',
    '.modal:has-text("erge")',
  ],

  // Botão de confirmação dentro do modal
  botaoConfirmarModal: [
    '.js-merge-save',
    '.merge__save',
    'button[type="submit"]',
  ],
  textosConfirmar: /^(unificar|mesclar|merge|salvar|save|confirmar)$/i,

  // Indicador de que o usuário está logado (menu lateral do CRM)
  indicadorLogado: [
    '#nav_menu',
    '.nav__menu',
    'aside .nav',
    '[data-entity="leads"]',
  ],
};
