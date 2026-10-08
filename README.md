# acompanhar-produ-o-
## Testes de exibição

Não é necessário instalar dependências para os testes de cálculo e marcação:

    node --test tests/*.test.js

Os dados de `tests/fixtures/dashboard-state.js` são fictícios. Os testes não acessam a base online.

O módulo `dashboard-view.js` só prepara dados para exibição. Os saldos e a capacidade de produção continuam calculados por `inventory-guard.js`.

Todos os scripts inline são verificados sintaticamente. Os testes de Pedidos cobrem abertura, cliques repetidos, troca de abas, atualização do estado recebido, listagem vazia e preservação dos dados durante a exibição.

O botão Recibo abre uma prévia no próprio app, com PNG para baixar, compartilhamento quando o navegador permite e texto selecionável como alternativa. O módulo `sales-receipt.js` lê preços antigos em centavos e preços em milésimos sem alterar o pedido. O total salvo continua sendo a referência; pagamentos e saldo usam apenas alocações para o pedido escolhido.

O cadastro de novos pedidos usa `sales-order.js`: preços em milésimos exatos (até três casas decimais), quantidades inteiras positivas, limite de precisão por item e soma. Totais que não fecham em centavos são recusados, sem arredondamento. Pedidos legados em centavos ou milésimos não são reescritos.

Os materiais de cada montagem são exibidos por linha como fichas inteiras mais a sobra em pares, usando `settings.pairsPerSheet` (padrão: 72). Essa conversão é somente por quantidade; não comprova grade completa de cores ou tamanhos. As cores e a capacidade ficam no detalhamento. Cabedais, produto pronto, cálculos de estoque e valores financeiros não mudam.

## Atendimento dos pedidos

`order-fulfillment.js` é uma projeção pura, sem reservas, baixas, lançamentos financeiros ou alteração da base online. A aba Pedidos mostra saldo pronto registrado, falta a produzir, capacidade com materiais compatíveis e lacunas por montagem/cor. Usa o estoque acumulado até a data de hoje em São Paulo, não a semana selecionada.

A prioridade é a data mais antiga do pedido, seguida de `createdAt` e `id`. Consome uma cópia do saldo pronto e dos materiais por montagem, linha e cor, compartilhada por toda a projeção. Primeiro considera conjuntos completos nas montagens; depois, cabedais e componentes parciais para identificar material adicional. Essa regra pode priorizar um pedido que precisa de reposição antes de outro que usaria o mesmo componente. Os números não prometem disponibilidade física ou prazo.

Limites explícitos:
- Apenas referências com exatamente um modelo identificado entram nas contas; serviços, ajustes e itens sem vínculo aparecem para conferência.
- Pedidos entregues e cancelados não entram na fila, independentemente do saldo financeiro.
- Sem quantidade restante por item, entregas parciais e estados desconhecidos suspendem a distribuição da referência afetada e a capacidade de produção que compartilha os materiais da mesma linha. O saldo pronto de outras referências continua calculável. Datas, quantidades e identificadores inconsistentes também exigem conferência.
- Sem cores/tamanhos nos itens de pedido, a visão compara quantidades por referência, não confirma grade. Cabedais sem cor discriminada não estabelecem capacidade de produção.
- Não há prazo estruturado no cadastro atual; a tela mostra “Prazo não informado”.
- Marcar como entregue não baixa estoque automaticamente. O usuário deve conferir saídas já feitas antes de separar o saldo pronto projetado.
- Qualquer pendência informada pelo guard de estoque suspende a projeção. O guard e as movimentações originais permanecem intactos.

Os testes usam apenas fixtures sintéticas, incluindo compartilhamento de materiais entre modelos, FIFO, recibo PNG, envio de pedido e ausência de mutações durante a exibição.

## Consulta e registro de acertos

A consulta por pares e tarifa é uma simulação sem gravação. Ela não reconcilia quais pares já foram pagos. O registro de um acerto realizado fica recolhido, começa com abatimento zero e exige revisão e confirmação do bruto, do abatimento escolhido e do pagamento líquido. Nenhum desconto é selecionado automaticamente.

O formato financeiro existente exige pelo menos um abatimento em cada acerto; sem abatimento, a interface informa essa limitação e não cria o registro. Não há migração, campo financeiro paralelo, inferência de pagamento histórico nem alteração de controles no banco. O formulário Novo gasto continua separado.

Os testes financeiros usam dados sintéticos e verificam simulação sem escrita, valores em centavos, confirmação e cancelamento, clique repetido, alterações enquanto a confirmação está aberta, sincronização pendente e acerto sem novo pagamento líquido.


## Login e meta semanal — v2026.10.08-r8.1

A tela de login aparece antes de qualquer janela de meta. O app só oferece “Comece pela meta” depois de autenticar e carregar a base online com sucesso, quando a semana atual ainda não tem meta positiva registrada. O indicador local `onboardingDone` não decide mais essa abertura. Metas de semanas anteriores permanecem no histórico, sem serem copiadas automaticamente para a semana nova.

Antes de salvar a primeira meta, o app confere novamente a base online. Se outra pessoa ou aparelho já definiu a meta, a versão online prevalece. A gravação continua usando a revisão esperada da base; alterações concorrentes ficam protegidas para conferência. Falta de internet, erro ao carregar e saída da conta não são tratados como ausência de meta.

Nenhuma estrutura ou registro da base online foi migrado nesta correção. A recuperação local mantém alterações pendentes válidas, isola estados antigos criados antes da primeira sincronização e preserva arquivos de recuperação anteriores. Uma falha ao preservar a recuperação impede que a pendência seja removida. O cache do aplicativo foi atualizado para v29.

`tests/meta-login.test.js` executa o fluxo de autenticação e sincronização com Supabase simulado e dados fictícios, sem rede nem acesso à base real. Inclui aparelho novo, sessão existente, leitura lenta/falha, meta já existente, semana nova, cliques repetidos, fechamento da janela, logout, atualizações concorrentes, respostas antigas, restauração de pendências e falhas de recuperação. Execute junto aos demais testes:

    node --test tests/*.test.js
