# acompanhar-produ-o-
## Testes do painel

Não é necessário instalar dependências para os testes de cálculo e marcação:

    node --test tests/dashboard-view.test.js

Os dados de `tests/fixtures/dashboard-state.js` são fictícios. Os testes não acessam a base online.

O módulo `dashboard-view.js` só prepara dados para exibição. Os saldos e a capacidade de produção continuam calculados por `inventory-guard.js`.

Limite conhecido no código de origem: o módulo inline de Pedidos contém uma sequência `\\n` fora de string após `moneyCents` e falha na análise sintática. Os testes do painel isolam esse erro preexistente; não representam uma aprovação geral do app. A suíte também aceita a correção futura desse erro, sem exigir que ele permaneça.
