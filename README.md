# acompanhar-produ-o-
## Testes de exibição

Não é necessário instalar dependências para os testes de cálculo e marcação:

    node --test tests/*.test.js

Os dados de `tests/fixtures/dashboard-state.js` são fictícios. Os testes não acessam a base online.

O módulo `dashboard-view.js` só prepara dados para exibição. Os saldos e a capacidade de produção continuam calculados por `inventory-guard.js`.

Todos os scripts inline são verificados sintaticamente. Os testes de Pedidos cobrem abertura, cliques repetidos, troca de abas, atualização do estado recebido, listagem vazia e preservação dos dados durante a exibição.

O botão Recibo abre uma prévia no próprio app, com PNG para baixar, compartilhamento quando o navegador permite e texto selecionável como alternativa. O módulo `sales-receipt.js` lê preços antigos em centavos e preços em milésimos sem alterar o pedido. O total salvo continua sendo a referência; pagamentos e saldo usam apenas alocações para o pedido escolhido.

Limite conhecido, fora da correção de recibos: criar um novo pedido ainda depende do auxiliar ausente `parseSalesPriceMills`. Nenhum fluxo de escrita foi alterado nesta correção.

Os materiais de cada montagem são exibidos por linha como fichas inteiras mais a sobra em pares, usando `settings.pairsPerSheet` (padrão: 72). Essa conversão é somente por quantidade; não comprova grade completa de cores ou tamanhos. As cores e a capacidade ficam no detalhamento. Cabedais, produto pronto, cálculos de estoque e valores financeiros não mudam.
