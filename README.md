# acompanhar-produ-o-
## Testes de exibição

Não é necessário instalar dependências para os testes de cálculo e marcação:

    node --test tests/*.test.js

Os dados de `tests/fixtures/dashboard-state.js` são fictícios. Os testes não acessam a base online.

O módulo `dashboard-view.js` só prepara dados para exibição. Os saldos e a capacidade de produção continuam calculados por `inventory-guard.js`.

Todos os scripts inline são verificados sintaticamente. Os testes de Pedidos cobrem abertura, cliques repetidos, troca de abas, atualização do estado recebido, listagem vazia e preservação dos dados durante a exibição.

Limite conhecido, fora da correção de exibição: criar um novo pedido e gerar seu recibo ainda dependem dos auxiliares ausentes `parseSalesPriceMills` e `itemPriceMills`. Os testes de exibição não representam aprovação desses fluxos de escrita ou de recibos.
