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


## Montagem a pagar (r8.2)

Novos lançamentos de Produto pronto usam `assembly-finance.js` para criar a entrada de produção e uma obrigação de mão de obra pendente em um único estado. O guard de estoque continua validando esse estado antes de qualquer salvamento. O bruto é congelado pela tarifa da data da produção. Sem vigência histórica confirmada, o valor atual é aceito apenas para produção do próprio dia em São Paulo; uma produção retroativa exige tarifa datada.

O painel Montagem a pagar seleciona contas pendentes de um montador, abate automaticamente os adiantamentos disponíveis por data/ID e mostra bruto, abatimento e líquido. Somente a confirmação de um acerto já realizado marca as obrigações como pagas e registra a saída líquida. O registro não transfere dinheiro. Acerto sem adiantamento é válido no novo caminho; acerto integralmente coberto não cria saída de valor zero. O formulário de acerto avulso legado mantém suas regras anteriores.

Custo lançado/quitado e Pago no caixa são projeções distintas. Obrigações de produção representam o custo bruto; adiantamentos e pagamentos líquidos representam as saídas de caixa. O bruto quitado não é somado novamente ao caixa. Acertos legados sem vínculo não inventam custos históricos de produção.

Limitações de preservação explícitas:
- Não há geração retroativa de contas ao abrir o app. Produções antigas permanecem fora das novas obrigações.
- Ao ativar o recurso, Produtos prontos existentes e os novos vinculados ficam protegidos contra edição/exclusão. A interface orienta solicitar revisão específica quando houver correção; não há estorno automático.
- Componentes não podem ser transformados em Produto pronto pela edição do mesmo registro; o produto deve ser lançado como um novo movimento.
- Um novo acerto de montagem por salvamento, sem misturar acerto avulso no mesmo pacote. A seleção pode conter várias obrigações; o abatimento é automático até o menor valor entre bruto e saldo elegível.
- Não há garantia de simultaneidade entre o sistema online e serviços externos. O estado online é a referência operacional.

Os novos fluxos bloqueiam duplo clique, callback antigo, data sem tarifa, estoque insuficiente, alteração durante a confirmação, pendência e conflito. A fila local é persistida antes do cache. Falha sem gravação durável reverte o estado em memória; se a fila foi gravada mas o cache falhou, a intenção permanece pendente e recuperável. O último envio fica registrado na fila para reconhecer por leitura um commit cuja resposta foi perdida, inclusive após recarga, sem sobrescrever uma intenção local posterior. Comparação de estado ignora somente a ordem de chaves de objetos JSON; a ordem de arrays é preservada.

### Compatibilidade de implantação

A versão r8.2 depende das guardas financeiras correspondentes no banco. A implantação das guardas é uma operação administrativa separada, revisada e autorizada, após backup conferido. Ela não cria produção, gastos, pagamentos, tarifas nem histórico retroativo. Clientes anteriores precisam atualizar para lançar novos produtos prontos com as obrigações correspondentes.


## Histórico de tarifas por montagem — r8.3

Ajustes → Montagens exibe a tarifa aplicável hoje em São Paulo e as vigências em histórico somente leitura. “Definir nova vigência” pede a data inicial confirmada e o valor por par, oferece uma prévia e exige confirmação. Hoje aparece como sugestão de data, mas nenhuma tarifa ou data de exemplo é gravada ao abrir, voltar, cancelar ou fornecer valores inválidos. Vigências existentes não podem ser editadas ou apagadas. Montagens inativas continuam visíveis para consulta. Uma vigência futura cadastrada incorretamente também não pode ser corrigida ou removida por esta tela; exige um procedimento específico de revisão, preservando as tarifas já aplicadas.

A gravação usa o motor de montagem e acrescenta somente a nova vigência, com a ativação necessária do controle caso ainda não exista. O aviso explica que essa primeira ativação protege o histórico existente de Produto pronto contra edição e exclusão. A tarifa antiga do cadastro, os snapshots semanais, as produções, os gastos e os acertos anteriores não são recalculados nem completados retroativamente. Tarifas futuras e retroativas são admitidas quando a data é informada explicitamente e ainda não possui vigência.

O formulário bloqueia pendência, conflito, sessão ainda não carregada, dados alterados, callback antigo, duplo clique e troca de tela. Uma falha de gravação reverte o candidato e permite revisão/repetição com o mesmo identificador. A confirmação online reabilita os botões de vigência sem descartar outros campos que estejam sendo editados em Ajustes.

O resumo semanal e o texto de compartilhamento somam cada Produto pronto pela sua tarifa congelada em `assemblyRate`, ou pela tarifa numérica legada em `mountingRate`. Sem tarifa salva no lançamento, os valores projetados ficam explicitamente separados como estimativas; sem referência calculável, os pares ficam sem valor e pedem conferência. Essa consulta nunca gera despesa, dívida, pagamento ou histórico. Valores inválidos e limites de precisão não viram zero silenciosamente.

O cache do aplicativo passou a v31. Os testes usam apenas dados sintéticos, incluindo mudanças de tarifa no meio da semana, fronteiras de vigência, datas futuras, legado, cancelamento, repetição, sincronização e falhas de salvamento. A validação visual em navegador permanece pendente: o Chromium local não pôde iniciar devido à restrição de socket do ambiente.


## Meta por referência — r8.4

Editar meta oferece fichas de 72 pares por modelo e pares avulsos de 0 a 71 para preservar metas legadas não múltiplas de uma ficha. A soma do plano deve coincidir com a meta total; o botão “Usar a soma como meta total” muda apenas o formulário. O armazenamento continua nos campos existentes `weeks[semana].goal` e `modelGoals`, em pares. Metas de modelos inativos ou antigos continuam editáveis e não são omitidas. Não há migração ou mudança automática na base ao abrir esta versão.

A validação termina antes de alterar o estado. Falha de persistência desfaz o candidato; fila durável continua protegida quando somente o cache falha. A tela bloqueia pendência, sessão não carregada, conflito, callback antigo, fechamento, outro modal, troca de semana, duplo clique e alteração dos dados enquanto o editor está aberto. Sem confirmação online, o texto informa que o salvamento ainda está pendente.

No Início, cada referência do plano mostra meta, produto pronto produzido na semana, saldo de cabedais em montagem e falta cortar. Falta cortar = máximo(meta − produção pronta da semana − saldo geral de cabedal, 0). O saldo geral já contém o das montagens e já desconta os retornos de Produto pronto. Cabedal fora da montagem aparece separadamente, sem ser somado novamente. Cabedal antigo ainda disponível pode atender ao corte; produto pronto antigo não reduz a meta de produção nova. Solados e palmilhas compartilhados não são contados como cabedal.

O resultado é uma estimativa por quantidade: não faz reserva para pedidos, não garante disponibilidade física, cores, numeração nem grade completa de fichas. Erros de estoque, meta inválida, referência ambígua ou saldo incoerente suspendem a estimativa, mostrando “A conferir”. Sem plano, não é inferida uma distribuição. Semanas arquivadas continuam somente leitura e preservam seus snapshots.

O cache passa a v32. Os testes sintéticos cobrem conversão, sobras, soma, limites, estoque antigo, cabedal externo, retorno sem duplicação, materiais compartilhados, datas, inconsistência, histórico, cancelamento, repetição, concorrência e falhas de salvamento. O Chromium deste executor não iniciou devido à restrição de socket, inclusive na tentativa de execução com permissões ampliadas; a inspeção visual desta versão não foi concluída.

## Ficha padrão por cor e numeração — r8.5

A unidade Fichas e o botão +1 ficha na aba Lançar preenchem a grade antes de salvar. Cada ficha tem 72 pares. Cores e quantidades de 35 a 39 podem ser editadas, adicionadas ou removidas do rascunho; a soma precisa coincidir com o total de fichas. O atalho preserva quantidades que já fecham fichas inteiras e pede um lançamento separado para avulsos. Fichas fracionárias não são distribuídas automaticamente. Pares e kits continuam disponíveis, exigindo cor; “Sem cor discriminada” exige uma escolha explícita na caixa correspondente.

Os padrões iniciais confirmados são somente leitura até a pessoa salvar uma configuração:
- Linha 500: Preto, Caramelo, Rose e Off White, 18 pares de cada; grade 35–39 de 3/3/6/3/3 por cor.
- Linha 300: Preto e Caramelo com 24 pares de cada (4/4/8/4/4), Rose e Off White com 12 pares de cada (2/2/4/2/2). Essa linha não usa palmilha.
- Ref.315 não herda o padrão genérico da 300, pois possui variações próprias. A linha600 e demais linhas sem grade confirmada pedem configuração explícita.

Ajustes oferece padrão por linha ou referência; o da referência tem prioridade. O cadastro opcional fica em settings.sheetPatterns, sem preencher ou migrar a base ao abrir o app. Cancelamento e consultas não gravam. Novos padrões mudam somente lançamentos futuros.

Cada cor resulta em um registro com quantidade própria, sizeBreakdown e um identificador estável de lote. Produto pronto gera uma obrigação de montagem por registro/cor, usando a tarifa já vigente. O estado inteiro é validado pelos motores de estoque e montagem e enviado pelo CAS existente, em um salvamento. Uma cor insuficiente recusa toda a ficha. Repetir o mesmo lote não duplica produção, estoque ou obrigações; não são gerados pagamentos. A interface também cobre fichas em ajustes manuais de estoque, sem inventar mão de obra para um saldo inicial ou expedição.

A grade é um detalhamento registrado, não um controle separado de saldo por tamanho: a guarda de estoque continua validando cor e quantidade. O SQL existente aceita os campos adicionais, mas não valida sua soma; a validação semântica de grade fica no módulo e na interface. Não houve DDL. Os lotes salvos ficam protegidos contra editar/apagar uma cor isoladamente; correções posteriores exigem revisão do lote completo, preservando o histórico. Registros antigos, incluindo seu campo sizes quando existente, permanecem inalterados.

No Início, o aviso de pares sem cor usa somente saldos globais positivos e não soma novamente os saldos das montagens. Mostra o detalhamento por setor e esclarece que a soma de componentes não é quantidade de sapatos prontos. Divergências suspendem esse total. Nenhuma cor é atribuída retroativamente.

Cache v33. Testes sintéticos cobrem padrões, exceções, edição, soma, limites, validação por cor, integridade financeira, repetição, rollback, concorrência, navegação e ausência de gravações ao consultar. Nenhum teste grava produção ou financeiro reais.

## Capacidade e material parado por montagem — r8.6

Cada montagem mostra a capacidade estimada e as sobras por linha, fora do detalhamento de cores. O limite por quantidade é o menor saldo entre cabedal, solado e palmilha da linha; a linha 300 usa apenas cabedal e solado. Modelos com configuração explícita sem palmilha respeitam essa regra. Se a mesma linha mistura exigências diferentes de palmilha, o cálculo fica a conferir, para não inventar uma distribuição de componentes entre modelos.

As sobras são os saldos que excedem esse limite por quantidade. Exemplo sintético: 216 cabedais, 576 solados e 1.152 palmilhas na linha 500 indicam limite estimado de 216 pares, sobra de 360 solados (5 fichas) e 936 palmilhas (13 fichas). O material continua disponível para produções futuras; o excedente não identifica sozinho uma referência faltante. Fichas seguem a unidade configurada e representam equivalência de quantidade, não grade completa.

O resumo para compartilhar remete ao detalhamento por linha, sem prometer produção imediata com um total agregado ou indicar um gargalo global. O cálculo adicional com cores informadas usa o guard de estoque existente. Todos os modelos da mesma linha compartilham os materiais uma única vez. Saldo sem cor discriminada continua nos totais e nas sobras por quantidade, mas não é tratado como combinação de cores confirmada. Quando o limite por cores é menor, um aviso pede conferência antes de produzir. A numeração registrada nas fichas não estabelece saldo independente por tamanho nem garantia de montagem.

Saldo negativo, quantidade inválida, divergência no guard, cadastro ambíguo, resumo incompatível com cores ou histórico de materiais alterado suspendem a estimativa e as sobras calculadas. Os saldos permanecem para conferência. Consultar, expandir cores, voltar ao histórico ou receber atualização online não grava, reserva, baixa ou redistribui estoque e não cria obrigações financeiras.

Cache v34. Testes somente com dados sintéticos cobrem cálculos, cores conhecidas e desconhecidas, linhas e montagens isoladas, materiais compartilhados, falta de componentes, retornos, datas, inválidos, congelamento do estado, cliques e renderizações repetidas, histórico e atualização recebida. A prévia visual não pôde ser acessada pelo navegador da nuvem: os protocolos locais foram bloqueados, e HTTP local retornou ERR_BLOCKED_BY_CLIENT. Não foi realizada validação visual em navegador.

## Ajustes físicos por montagem — r8.6.2

Estoque oferece um ajuste localizado com data, motivo obrigatório, montagem, setor, referência/linha, cor e pares. Um material corrigido numa montagem muda o saldo local e o total na mesma quantidade, pelo mesmo registro. Produto pronto usa o saldo geral. A diferença entre material total e material nas montagens é o saldo da fábrica; uma saída global não pode consumir material que ainda pertence a uma montagem.

“Revisar zeragem” prepara uma prévia dos produtos prontos e materiais de todas as montagens. Os materiais da fábrica ficam fora dessa seleção. Nada é gravado até a confirmação da prévia. A abertura, o cancelamento, a troca de tela e a consulta do histórico não fazem lançamentos. As quantidades e cores permanecem como registradas; saldo sem cor discriminada não recebe cor inventada.

Cada confirmação cria um lote imutável de ajustes no `stockLedger`. Estornar lote acrescenta movimentos contrários vinculados aos originais; não apaga o histórico, não admite segundo estorno e não pode provocar saldo negativo. A repetição do mesmo identificador e conteúdo não duplica o lote. Um identificador reutilizado com outros dados é rejeitado. A UI revalida o estado e a sincronização antes do salvamento, usando o controle de revisão existente. Uma falha de persistência local reverte o candidato, mantendo o lote para revisão e repetição.

Ajustes não criam produção, obrigações de mão de obra, pedidos, pagamentos ou despesas. O histórico de produção e as metas salvas não são recalculados. A disponibilidade e estimativas que usam o saldo atual acompanham o ajuste. Visões anteriores à data do movimento permanecem iguais; uma correção retroativa ou atual que inviabilize produção posterior é recusada.

A guarda SQL correspondente exige somente acréscimos ao razão, preserva ajustes já confirmados e verifica saldos cronológicos local/global. Sua instalação é separada da aplicação de qualquer ajuste operacional e requer backup conferido. Não altera autenticação, RLS, permissões ou guardas financeiras/comerciais existentes. Clientes antigos precisam atualizar para interpretar os movimentos localizados.

Cache v35. Testes locais usam dados fictícios e cobrem preservação, zeragem, reversão, repetição, datas, saldo insuficiente, cores desconhecidas, concorrência de interface, cancelamento e falha de salvamento. Execute `node --test tests/*.test.js`. Testes SQL em `sql/` rodam com dados temporários e terminam em rollback; nunca use o estado operacional como fixture de escrita. A simulação da base real deve permanecer em memória até a autorização de aplicação.

## Painel geral — r8.7.0

A aba Painel reúne cinco blocos somente de consulta: produção semanal; estoque e materiais atuais; pedidos/clientes; entradas e pagamentos; e resultado bruto estimado. `general-dashboard.js` é uma projeção pura dos registros carregados. Abrir o painel ou mudar filtros não grava, cria semana/snapshot, reserva estoque, gera obrigação, concilia ou altera pagamentos. As abas de lançamento e o histórico semanal continuam disponíveis.

Períodos e fontes:
- Produção usa a semana atual, até hoje em São Paulo. A baixa física de estoque não apaga produção. A equivalência principal é uma ficha de 72 pares, sem garantia de grade.
- Estoque é acumulado até hoje. Cabedal na fábrica é o global menos o das montagens; o global já inclui as montagens. Divergências por material, referência e cor suspendem disponibilidade. O motor existente permanece dono dos saldos e das sobras.
- O mês selecionado vale para pedidos, recebimentos, saídas e resultado estimado. A receber, entregas pendentes e contas pendentes são acumulados até hoje, independentemente desse mês. O filtro de cliente afeta somente pedidos e resultado; o caixa da fábrica mantém todos os clientes.
- O total salvo do pedido é a autoridade monetária. Recebimentos são contados uma única vez pela data/valor do pagamento, com alocações usadas apenas no saldo dos pedidos. Créditos ficam separados. Cancelados não entram nos totais ativos; serviços/descontos não contam como pares. Entrega parcial não inventa quantidade restante.
- Caixa pago exclui obrigações `assembly_payable`, inclui adiantamentos e pagamentos líquidos. Retiradas são deduzidas apenas quando pagas. Gastos comuns usam a data registrada no lançamento; não existe data independente de quitação garantida. O movimento registrado é recebimentos menos caixa pago menos retiradas pagas, sem saldo inicial ou conciliação bancária; não é saldo disponível. Acertos avulsos sem vínculo provocam aviso de conferência, sem quitar obrigações por inferência.
- Lucro bruto estimado usa apenas pedidos inteiros cujos itens têm custos correspondentes calculáveis. Receita e custo sempre cobrem os mesmos pedidos. Custos salvos, referências de custo e snapshots consistentes têm prioridade; um `sourceItem` importado exige referência e quantidade correspondentes. Catálogo completo atual é fallback explicitamente estimado, sem afirmar custo histórico. Milésimos são preservados até arredondar o custo agregado. Custos ausentes ou contraditórios, serviços e descontos excluem o pedido inteiro do resultado; a cobertura parcial e o valor excluído ficam visíveis. Não se mostra lucro líquido nem se descontam novamente compras ou montagem do custo completo.

A faixa de sincronização distingue carregamento, alterações pendentes, conflitos, horário da última leitura e horário de alteração informado pelo servidor. Enquanto a primeira leitura não termina, nenhum saldo é apresentado como zero. Um horário antigo de alteração é ocultado depois de nova gravação confirmada até outra leitura. Não há importação silenciosa de informações externas ao sistema nem dados operacionais incorporados ao código ou aos testes públicos.

Cache v36. Testes de módulo, DOM sintético e login cobrem filtros, navegação, callbacks antigos, estados vazios/indisponíveis, preservação do JSON, zeragem, cores, datas, cancelados, serviços, crédito, retiradas pendentes, custos salvos/atuais, precisão, overflow e registros inválidos. Execute `node --test tests/*.test.js`. A validação visual de layout exige navegador e é reportada separadamente dos testes DOM.

## Etapa 0 — consulta sem criação de semana (r8.7.1)

A renderização e a navegação usam a semana carregada ou uma projeção vazia em memória, sem acrescentar semana, `createdAt` ou snapshots ao estado. Isso corrige a regressão exposta em 12/10/2026 ao fechar/reabrir um recibo e navegar para a visão semanal. A regra também vale para Lançar, Histórico, Ajustes, Estoque, Pedidos, Gastos e para a visão semanal de contingência sem o módulo do painel geral.

Abrir, preencher, fornecer valores inválidos ou cancelar o editor de meta não cria semana nem completa campos ausentes. No fluxo “Editar meta”, depois da validação e do clique em Salvar meta, a semana necessária é preparada somente no candidato. Uma falha de persistência local antes de gravar a fila durável descarta esse candidato; uma intenção já enfileirada continua pendente, seguindo a sincronização e a proteção de conflitos existentes. Na Etapa 0, esse rollback ficou restrito ao editor, sem cobrir recusa remota do CAS ou o fluxo inicial “Começar” (corrigido na Etapa 0.1 abaixo). O primeiro lançamento explícito continua podendo criar sua semana. Semanas existentes e snapshots históricos não são migrados ou regravados durante a consulta. O salvamento mantém o único JSON e o CAS `save_app_state` já existente; não há alteração de SQL, permissões, motores de estoque/montagem ou fluxo de pedidos.

Cache v37. Os testes de recibo recebem relógio fixo por injeção, incluindo 12/10/2026 e os instantes imediatamente antes/depois da virada de domingo para segunda em São Paulo (03:00 UTC). As regressões também cobrem navegação repetida, leitura de histórico, estado congelado, campos ausentes, cancelamento, confirmação única, callback antigo e falha/repetição do salvamento da meta com CAS simulado. Use `node --test tests/*.test.js`; os cenários usam somente fixtures sintéticas, sem ler ou gravar a base operacional. Testes DOM não substituem a inspeção visual em navegador.

### Etapa 0.1 — falha ao salvar no botão “Começar” (r8.7.2)

A pendência de “Começar” foi corrigida nesta branch `etapa-0-1`. O fluxo `setInitialGoal` alterava a meta em memória e ignorava `save() === false`: uma falha local antes de gravar a fila durável podia fechar a janela e manter semana/meta sem nenhum CAS enviado. Agora, como em “Editar meta”, semana, meta e `onboardingDone` são preparados somente no candidato. Se o salvamento retornar `false` ou lançar erro, o estado anterior é restaurado, a janela e o valor digitado permanecem para nova tentativa e o aviso informa que a meta não pôde ser salva.

Uma fila já gravada continua pendente e recuperável quando somente o cache falha; a confirmação online e os conflitos continuam no CAS existente. Cache v38. Os testes sintéticos cobrem semana ausente ou existente com campos ausentes, preservação do estado anterior, falha da fila, falha apenas do cache, repetição com um único CAS, valores inválidos, cancelamento e callback antigo. Execute `node --test tests/*.test.js`. Nenhum dado operacional é usado ou gravado.
