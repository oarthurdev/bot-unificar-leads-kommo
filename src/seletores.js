/**
 * Seletores REAIS da interface web da Kommo (conta dicasaindaial, calibrados
 * em 20/08/2026 via tools/inspecionar-*.js). Se a Kommo mudar o layout,
 * ajuste apenas este arquivo.
 */
module.exports = {
  // ===== Funil (pipeline) =====
  // Botão "..." no topo do funil, que abre o context-menu
  botaoMenuMais: [
    '.button-input-more button.button-input-with-menu',
    '.list-top-nav__button-more button',
    '.list-top-nav__button-more',
  ],
  // Item do context-menu (filtrar por texto "Localizar duplicatas")
  itemContextMenu: '.button-input__context-menu__item',
  textoLocalizarDuplicatas: /localizar duplicatas/i,

  // ===== Assistente "Localizar e unir duplicatas" =====
  // Título: <h2 class="modal-body__caption head_2">Localizar e unir duplicatas — 1 de 993</h2>
  tituloAssistente: 'h2.modal-body__caption',
  formAssistente: '.js-merge-form',
  botaoUnir: '.js-merge-start',        // "Unir esta duplicata"
  botaoPular: '.js-merge-next',        // "Pular esta duplicata" (marca como NÃO duplicata — evitar!)
  botaoCancelar: 'button.button-cancel', // "Cancelar" — fecha sem efeito
  // Dentro do form:
  //   inputs hidden  name="id[]"                      → IDs dos leads, na ordem das colunas
  //   radios         name="[prefixo]result_element[CAMPO]" → opções na ordem das colunas
  //   grupo DATE_CREATE tem as datas de criação como value ("YYYY-MM-DD HH:MM:SS")
  //   checkboxes     result_element[TAGS][] / [cfv]…  → união de tags/contatos (manter marcados)
  //   checkbox       name="merge_switcher"            → toggle "Unir" de cada subgrupo

  // ===== Card do lead (mover de funil) =====
  seletorFunilCard: '.pipeline-select-view',            // widget clicável no topo do card
  funilAtualAttr: '.pipeline-select-view__inner',       // data-pipeline-id = funil atual
  dropdownFunil: '.pipeline-select-wrapper__inner__container',
  // Etapa: label.pipeline-select__dropdown__item__label[for^="pipeline_<PIPELINE>_<STATUS>_"]
  // Etapas finais do sistema têm status 142 (ganho) e 143 (perdido) — não usar como destino padrão

  // ===== Lista de leads (usada pelo scan, opcional) =====
  linhaLead: ['.js-list-row[data-id]'],
  nomeLead: ['a.list-row__template-name__table-wrapper__name-link', 'a[href*="/leads/detail/"]'],
  checkboxLinha: ['label.control-checkbox'],
  campoBusca: ['#search_input'],

  // Indicador de sessão logada
  indicadorLogado: ['#nav_menu', '.nav__menu', 'aside .nav', '[data-entity="leads"]', '.pipeline_leads__quick_add_button'],
};
