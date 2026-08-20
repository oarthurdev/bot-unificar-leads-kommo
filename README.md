# Bot de Unificação de Leads Duplicados — Kommo CRM (Playwright)

Bot que opera **exclusivamente pela interface web da Kommo** usando o assistente
nativo **"Localizar duplicatas"** (menu "..." do funil), em lotes, sempre mantendo
o lead **criado mais recentemente**. Após cada união, o lead unificado é **movido
para o funil `12347316`** (etapa "Deletar" por padrão).

Seletores calibrados contra a conta real (`dicasaindaial`) em 20/08/2026.

## Como funciona

1. **`login`** — abre um navegador visível; você faz login (com 2FA, se houver) e a
   sessão fica salva em `data/storageState.json`.
2. **`merge`** — abre o funil → "..." → **Localizar duplicatas**. Em cada tela do
   assistente ("1 de 993"):
   - Lê os subgrupos de duplicatas e os IDs dos leads (inputs `id[]` do form);
   - Compara as **datas de criação** (grupo `result_element[DATE_CREATE]`) e marca,
     em **todos** os campos (nome, data, status, responsável, orçamento…), a coluna
     do lead **mais recente**. Tags, e-mails e telefones ficam todos marcados —
     a união preserva tudo;
   - Clica **"Unir esta duplicata"** e espera a próxima tela;
   - Após o lote, **FASE 2**: abre o card de cada lead unificado e o move para o
     funil `PIPELINE_DESTINO` pelo seletor de funil/etapa do card.
3. Progresso em `data/estado.json` — `Ctrl+C` a qualquer momento e rode de novo:
   ele retoma (inclusive movimentações de funil pendentes). `BATCH_SIZE` limita
   quantas duplicatas por execução.

> O botão **"Pular esta duplicata" nunca é usado** — na Kommo ele marca o par como
> "não duplicata" permanentemente.

## Instalação

```bash
npm install
npx playwright install chromium
```

## Configuração (.env)

| Variável | Descrição |
|---|---|
| `KOMMO_SUBDOMAIN` | Subdomínio da conta (`https://SUB.kommo.com`) |
| `DRY_RUN` | `true` = analisa e seleciona a 1ª tela **sem unir nada** |
| `BATCH_SIZE` | Duplicatas unificadas por execução (`0` = todas de uma vez) |
| `PIPELINE_DESTINO` | Funil para onde o lead unificado é movido (padrão `12347316`) |
| `STATUS_DESTINO` | Id da etapa destino (vazio = primeira etapa regular, ex.: "Deletar") |
| `HEADLESS` | `false` para assistir o bot trabalhando |

## Uso

```bash
npm run login
```

```bash
npm run merge
```

```bash
npm run status
```

**Roteiro para as ~993 duplicatas:**

1. Teste: `DRY_RUN=true` → `npm run merge` (analisa a 1ª tela, salva
   `data/dry-run-selecao.png` para conferência e fecha com Cancelar).
2. Valendo: `DRY_RUN=false`, `BATCH_SIZE=100` → rode `npm run merge` repetidamente,
   ou `BATCH_SIZE=0` para tudo de uma vez. Cada duplicata leva ~4–6 s de união
   + ~6–8 s para mover o lead de funil (~2–4 h no total para 993).
3. `npm run status` mostra o acumulado; o restante aparece no título do assistente.

## Se o layout da Kommo mudar

Seletores centralizados em [`src/seletores.js`](src/seletores.js), documentados
com a estrutura real do DOM. As ferramentas de calibração estão em `tools/`
(`inspecionar*.js` — todas somente leitura, fecham com Cancelar/Escape):

```bash
node tools/inspecionar-modal.js
```

## Segurança

- `DRY_RUN=true` é o padrão — nada é alterado até você desligar explicitamente.
- A união de leads na Kommo **não é reversível** — confira `data/dry-run-selecao.png`
  antes de liberar e rode um primeiro lote pequeno (`BATCH_SIZE=5`).
- Falhas (união ou movimentação) ficam em `data/estado.json` e são re-tentadas
  na execução seguinte, sem travar o lote.
