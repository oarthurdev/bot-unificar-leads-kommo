# Bot de Unificação de Leads Duplicados — Kommo CRM (Playwright)

Bot que opera **exclusivamente pela interface web da Kommo** para unificar leads
duplicados **em lotes**, mantendo sempre o lead **criado mais recentemente** como
prioridade de valores. Feito para bases grandes (1000+ duplicados): sessão salva,
recursos pesados bloqueados, progresso persistente e retomada automática.

## Como funciona

1. **`login`** — abre um navegador visível; você faz login (com 2FA, se houver) e a
   sessão fica salva em `data/storageState.json`. Não pede login de novo até expirar.
2. **`scan`** — abre `/leads/list/`, rola a lista até o fim, coleta `id + nome` de
   todos os leads e agrupa duplicados por **nome normalizado** (sem acentos,
   maiúsculas/minúsculas ou espaços extras). Gera `data/duplicados.json`.
   - *Critério "mais recente":* os IDs da Kommo são sequenciais — **maior ID = lead
     mais novo**. Não depende de coluna de data visível.
3. **`merge`** — para cada grupo: busca o nome, marca os checkboxes das linhas
   duplicadas, clica em **Unificar/Mesclar**, no modal prioriza os valores do lead
   mais recente e confirma. Grupos grandes são unificados em rodadas de até
   `MAX_LEADS_POR_UNIFICACAO`, sempre incluindo o lead mais novo.
4. Progresso em `data/estado.json` — pode interromper com `Ctrl+C` e rodar de novo
   que ele **continua de onde parou**. `BATCH_SIZE` limita quantos grupos por execução.

## Instalação

```bash
npm install
npx playwright install chromium
```

## Configuração

```bash
copy .env.example .env
```

Edite o `.env`:

| Variável | Descrição |
|---|---|
| `KOMMO_SUBDOMAIN` | Subdomínio da conta (`https://SUB.kommo.com`) |
| `DRY_RUN` | `true` = simula sem confirmar nada (**comece assim!**) |
| `BATCH_SIZE` | Grupos unificados por execução (`0` = todos) |
| `MAX_LEADS_POR_UNIFICACAO` | Leads selecionados por unificação (grupos maiores → várias rodadas) |
| `HEADLESS` | `false` para assistir o bot trabalhando |
| `CUSTOM_LIST_URL` | URL da lista já filtrada (pipeline/etapa), se quiser restringir |

## Uso

```bash
npm run login
```

```bash
npm run scan
```

```bash
npm run merge
```

```bash
npm run status
```

**Roteiro recomendado para 1000+ duplicados:**

1. `npm run login` e `npm run scan`.
2. Revise `data/duplicados.json` (confira se os grupos fazem sentido!).
3. Primeiro teste: `.env` com `DRY_RUN=true`, `HEADLESS=false`, `BATCH_SIZE=3` →
   `npm run merge` e observe o bot selecionar e abrir o modal sem confirmar.
4. Valendo: `DRY_RUN=false`, `HEADLESS=true`, `BATCH_SIZE=100` → rode `npm run merge`
   repetidamente (ou `BATCH_SIZE=0` para tudo de uma vez). Cada grupo leva ~5–10 s;
   ~1000 grupos ≈ 1,5–3 h em uma execução contínua.
5. `npm run status` a qualquer momento para ver o progresso.

## Se o layout da Kommo mudar

Todos os seletores ficam centralizados em [`src/seletores.js`](src/seletores.js),
como listas de candidatos (o bot usa o primeiro que existir). Se algum passo falhar
("botão de unificar não encontrado", etc.):

1. Rode com `HEADLESS=false` e `DRY_RUN=true`;
2. Inspecione o elemento na tela (F12) e adicione o seletor real no início da lista
   correspondente. O restante do código não precisa mudar.

## Segurança

- `DRY_RUN=true` é o padrão — nada é alterado até você desligar explicitamente.
- Unificação na Kommo **não é reversível** em massa: valide o `duplicados.json`
  e faça um lote pequeno de teste antes de liberar tudo.
- Falhas não travam o lote: o grupo é registrado em `estado.json` e re-tentado
  na próxima execução.
- Para reprocessar do zero: apague `data/estado.json`.
