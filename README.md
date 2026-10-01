# Grid SOL

Grid bot de Solana rodando 24h **com dinheiro de mentira** (começa com US$ 20), usando o preço real da SOL.

**Painel:** https://luan146.github.io/Grid-bot-sol/

## Como funciona

- `bot/ao_vivo.py` roda a cada ~10 minutos no GitHub Actions (workflow **Bot ao vivo**). Ele busca os candles de 1 minuto da SOL na Coinbase, simula as compras e vendas do grid (com taxa de 0,1%) e salva tudo em `data/estado.json`.
- `bot/historico.py` roda 1x por dia (workflow **Histórico simulado**) e refaz o backtest do último ano em `data/historico.json`.
- `bot/otimizar.py` testa 126 combinações de configuração (workflow **Otimizar configuração**, só manual) e salva o ranking em `data/otimizacao.json`.
- `index.html` é o painel (GitHub Pages) que lê esses arquivos.

Não precisa de chave de API: só preço público, nenhuma ordem de verdade é enviada.

## Configurar

Use a aba **Configurar** do painel, ou edite `config.json` direto:

| Campo | O que faz |
|---|---|
| `saldo_inicial_usd` | Saldo de mentira. Mudar reinicia o bot do zero. |
| `sessao` | Troque o número pra reiniciar do zero com o mesmo saldo. |
| `linhas` | Quantidade de degraus do grid. |
| `faixa_abaixo_pct` / `faixa_acima_pct` | Tamanho da faixa em volta do preço na hora de montar o grid. |
| `recentrar_apos_horas` | Se o preço ficar fora da faixa por esse tempo, remonta o grid em volta do preço novo (0 = nunca). |
| `preco_min` / `preco_max` | Opcional: faixa fixa em dólar no lugar da percentual. |

Mudar `ao_vivo` remonta o grid com o patrimônio atual, sem perder o histórico.

## Rodar na mão

Em **Actions**, escolha o workflow e clique em **Run workflow**.

> Simulação educativa. Resultado passado não garante resultado futuro.
