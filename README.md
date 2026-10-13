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

## Etapa 1 — catálogo de materiais e histórico de preços (r8.8.0)

Ajustes → Materiais apresenta o catálogo agrupado por categoria, com nome, unidade, fornecedor opcional, indicação de variação por cor e preço aplicável hoje em `America/Sao_Paulo`. O preço é a vigência de maior data inicial menor ou igual à data consultada. Sem preço aplicável, a tela mostra “A conferir”; um preço zero explicitamente informado aparece como R$ 0,000. Vigências futuras ficam identificadas no histórico. Materiais inativos continuam visíveis, com histórico somente leitura.

“Novo material” exige nome, categoria e unidade, oferece revisão e confirmação e cria um histórico vazio. “Definir novo preço” pede data inicial, preço por unidade e observação opcional, mostra a prévia do período e exige confirmação. As datas futuras e retroativas são admitidas explicitamente; uma data inicial já usada pelo material é recusada. O histórico é somente de acréscimos: correções são registros novos vinculados ao anterior, sem editar ou excluir registros já salvos. Edição de cadastro e ativação/desativação seguem as restrições descritas abaixo. Nenhuma referência ou vínculo existente é removido.

`material-catalog.js` prepara candidatos puros para a coleção opcional `settings.materials` do JSON único. Ausência da coleção significa catálogo vazio, sem acrescentá-la durante leitura, navegação, abertura, prévia ou cancelamento. IDs são estáveis durante cada tentativa e rejeitam colisões; uma repetição exata não duplica o registro. O material guarda `id`, `name`, `category`, `unit`, `supplier` opcional, `variantByColor`, `active`, `prices`, `createdAt` e `updatedAt`. Cada preço guarda `id`, `from`, `unitPriceMills` e `note`. Um registro de correção acrescenta `supersedesPriceId` e `correctedAt`; esses campos ficam somente no registro novo, sem preencher os antigos. As categorias aceitas são `tira`, `solado`, `palmilha`, `enfeite`, `passador`, `cola`, `embalagem`, `cabedal`, `mao_de_obra`, `servico` e `outro`; unidades: `m`, `un`, `par`, `placa`, `kg`. Novos materiais têm `variantByColor: false` por padrão e ficam ativos.

Preços são inteiros em milésimos, com até três casas decimais na entrada. Conversão e formatação preservam todos os milésimos, inclusive no limite de precisão; não há arredondamento por unidade. Negativos, notação científica, separador de milhares, mais de três casas, datas inválidas e valores fora do limite seguro são recusados. Um catálogo inconsistente bloqueia novas gravações e pede conferência, sem normalizar ou apagar dados existentes.

O candidato parte do JSON bruto confirmado online, separado das normalizações usadas apenas para exibir o app: campos desconhecidos e campos ausentes de outros cadastros são preservados. A base confirmada e o estado visível são conferidos novamente na revisão e na confirmação. A gravação continua na fila durável e no CAS `save_app_state` existentes. Confirmação local não é apresentada como confirmação online. Os fluxos bloqueiam cliques repetidos, callbacks antigos, troca de tela, sessão não carregada, atualização concorrente, pendência e conflito. Falha antes da fila durável restaura o estado anterior e mantém os campos/ID para revisão e nova tentativa. Falha apenas do cache mantém a fila recuperável. Recusa remota preserva a intenção pendente; resposta perdida é reconciliada por leitura antes de reenviar.

Escopo: somente catálogo e histórico de preço (seções 2.1 e 4.1). Não implementa ficha técnica, consumo, custo calculado, análise de impacto nem integração com produção, pedidos ou resultado financeiro. Não altera `inventory-guard.js`, `assembly-finance.js`, dados operacionais, SQL, schema, autenticação ou políticas de segurança. O JSON online permanece a fonte operacional principal. A validação de acréscimos deste catálogo está no módulo/interface; não foi instalada nem afirmada uma nova guarda de catálogo no servidor. O SQL versionado de ajustes de estoque não limita as chaves adicionais de `settings`, mas a aceitação das políticas efetivamente instaladas não foi testada com escrita na base real. Uma eventual recusa deverá ser investigada sem contornar o CAS ou mudar políticas nesta etapa.

Cache v40, incluindo o novo módulo. Execute `node --test tests/*.test.js`. Os testes usam exclusivamente dados fictícios e cobrem catálogo ausente/vazio, categorias/unidades, precisão, zero, ausência de preço, histórico retroativo/futuro, inativos, entradas inválidas, estado congelado, preservação de registros e campos não relacionados, confirmação/cancelamento/repetição, foco/semântica acessível, meia-noite em São Paulo, quota local, cache, CAS, conflito, recusa remota e resposta perdida. Não acessam a base operacional. A inspeção visual desktop/iPhone não foi concluída: o Chromium local falhou em `socket() ... Operation not permitted`, inclusive na tentativa com execução ampliada; os testes DOM não substituem essa inspeção.


### Edição, ativação e correção de preço

“Editar material” permite mudar nome, fornecedor e variação por cor, inclusive em materiais inativos. Categoria e unidade só podem mudar enquanto `prices` estiver inteiramente vazio; a existência de qualquer preço, futuro ou já corrigido, bloqueia os dois campos tanto na interface quanto no módulo. A revisão exige confirmação e preserva `id`, `createdAt`, campos desconhecidos e todos os registros de preço. Uma edição sem mudanças não grava nem atualiza o timestamp.

“Ativar material” e “Desativar material” pedem confirmação, preservam os vínculos e mantêm todo o histórico visível. Inativos podem ter seu cadastro editado ou ser reativados; novos preços e correções exigem material ativo. Antes de desativar, a interface apenas consulta `settings.techSheets`, se existir, e avisa quais referências têm o material na versão de maior `validFrom` menor ou igual a hoje em São Paulo. Uma estrutura desconhecida ou ambígua produz aviso de que não foi possível conferir as referências. Essa leitura não cria, normaliza, modifica nem calcula fichas técnicas.

“Corrigir preço” aparece nas vigências ainda não substituídas, inclusive passadas e futuras, e mantém a mesma data inicial. A prévia compara o preço anterior com o novo e exige confirmação. A gravação acrescenta um registro com ID próprio, `supersedesPriceId` apontando para a versão escolhida e `correctedAt` com a data/hora UTC da confirmação; a interface exibe essa data no fuso de São Paulo. O registro anterior continua byte a byte como estava. O rótulo “Corrigido em” é derivado da ligação com o sucessor, sem marcar ou reescrever o original. Uma correção pode ser corrigida novamente pela mesma regra.

O módulo aceita uma única cadeia linear por data inicial e recusa referências órfãs, entre materiais, ciclos, bifurcações, alvo já corrigido, data divergente e timestamps incoerentes. O preço aplicável usa somente o último registro não substituído de cada data e depois escolhe a maior data inicial já alcançada. Zero continua sendo um preço explícito. “Definir novo preço” segue recusando uma data já usada e não aceita metadados de correção; não é um caminho alternativo para substituir um registro.

Os testes adicionais são exclusivamente sintéticos: edição ativa/inativa, campos bloqueados mesmo com vigência futura ou corrigida, ativação, avisos de referências, cadeias repetidas, preservação byte a byte, data real da confirmação e exibição em São Paulo, ausência de gravação em leitura/cancelamento, callbacks antigos, falha local/repetição, CAS sequencial, concorrência, recusa remota e resposta perdida. As limitações de validação visual e de aceitação das políticas online descritas acima permanecem aplicáveis. Não houve migração, escrita operacional, mudança de SQL/políticas, merge ou deploy.

## Etapa 2 — motor puro de ficha técnica

`tech-sheet.js` acrescenta somente funções de consulta e cálculo. Não é carregado por `index.html`, não altera telas nem é chamado pelos cálculos legados (`itemCost`, `localSheet`, `catalogSheet`). Não cria nem salva ficha técnica, material, preço, semana, produção, estoque, pedido, pagamento, gasto, retirada, obrigação ou snapshot. Não lê a base online, não tem relógio implícito, não migra o JSON e não acrescenta campos ausentes. Nenhuma integração das etapas seguintes foi implementada. As referências antigas continuam usando seus caminhos existentes.

### Entrada e vigências

A coleção opcional é um mapa em `settings.techSheets`: cada chave de referência contém `{ ref, versions }`. Cada versão segue `{ id, validFrom, sizeGroups, items, salePriceMills?, note, createdAt }`; cada item segue `{ id, materialId, label?, qtyPerPair?, qtyBySizeGroup?, colorMap? }`. O motor não produz candidatos de escrita. A seleção usa a maior `validFrom` menor ou igual à data explícita de consulta; uma data inicial ou ID repetido no histórico da referência exige conferência. Sem versão aplicável, não usa ficha futura nem custo de outro cadastro. A seleção devolve uma cópia independente da versão.

`sizeGroups` deve ser `[]` (consumo único) ou conter exatamente `35-37` e `38-39`. A quantidade é texto decimal positivo com até três casas, ponto ou vírgula decimal, sem separador de milhares ou notação científica. `qtyBySizeGroup` nulo/omitido usa `qtyPerPair`; quando informado, precisa cobrir todas as faixas e substitui o consumo único, sem completar uma faixa ausente por inferência. Nesse caso, `qtyPerPair` não é usado. IDs de item são únicos. O mesmo material só pode se repetir com identificações (`label`) diferentes, comparadas sem distinção de maiúsculas/minúsculas e espaços excedentes; duas utilizações sem identificação são ambíguas. `colorMap` é exclusivamente informativo, sem seleção de preço ou consumo. `note` e `createdAt` não participam do cálculo.

O material precisa existir sem ambiguidade em `settings.materials`, estar ativo e ter preço válido aplicável à data consultada. `material-catalog.js` continua sendo a autoridade para validar e selecionar preços: só a ponta de cada cadeia linear de correções concorre pela maior data `from` já alcançada. `correctedAt` é auditoria da correção, não uma nova vigência de preço. Inativos, materiais ausentes, históricos inconsistentes e falta de preço são detalhados por item. Preço explicitamente zero é válido.

### API, grade e completude

API CommonJS (`require('./tech-sheet')`) ou UMD (`FioriTechSheets`, somente se carregado explicitamente):

- `parseQuantityThousandths(text)` devolve a quantidade em milésimos inteiros; entrada inválida lança erro com `code`.
- `applicableVersion(state, ref, date)` devolve a versão independente ou `null`; cadastro ambíguo/inválido lança erro com `code`.
- `calculateItemCost(state, item, date, sizeGroups = [])` devolve validação, preço aplicável e custos exatos por faixa, com `issues` e status `ok`/`a_conferir`.
- `calculateTechSheet(state, { ref, date, rows? })` devolve itens, custos por faixa, distribuição, composição por categoria, custos por par/ficha, venda, lucro e margem. Falhas de cálculo são resultados `null` com pendências em `issues`, nunca substituições silenciosas por zero.

Para consumos por faixa, `rows` explícitas, quando fornecidas, prevalecem sobre a configuração e seguem a grade existente: linhas com `color` e `sizeBreakdown` dos tamanhos 35 a 39, somando exatamente 72 pares. Sem `rows`, a consulta reutiliza a resolução existente de `settings.sheetPatterns` (versão 1, `templates`), com padrão de referência antes do padrão de linha, e a validação da grade existente. Os padrões implícitos das linhas antigas não são usados para calcular médias. Sem grade explicitamente configurada/válida, permanecem apenas os custos por faixa; média, custo da ficha e lucro ponderado ficam a conferir. A referência com exceção à grade da linha continua exigindo seu padrão específico ou uma grade explícita. Não é inventada distribuição igual entre faixas.

Quando `sizeGroups` é vazio, o consumo é uniforme: o custo por par e o de 72 pares independem da numeração. A distribuição retornada tem `source: 'uniform'`, sem criar uma grade em `settings`. Uma grade explicitamente fornecida ainda é validada. Nos demais casos, `distribution.source` informa `actual`, `custom:ref` ou `custom:line`.

`complete` indica que todos os itens têm material ativo, quantidade válida e preço vigente, sem duplicidades; não depende de preço de venda nem de grade. `valuationComplete` indica que também foi possível calcular os custos ponderados dentro do limite seguro. O status geral reflete essa avaliação de custos. `financialComplete` indica que venda, lucro e margem também foram calculados. Preço de venda ausente não invalida os custos; venda zero mantém receita e lucro calculáveis, mas a margem fica `null` porque sua divisão não é definida. Essas limitações são identificadas em `issues` com escopo de venda. Cada pendência de item inclui seu índice e ID quando disponível. Uma ficha com item incompleto não apresenta soma parcial como custo total nem composição completa.

### Precisão e fórmulas

Entradas e agregados monetários são inteiros em milésimos de real. Produtos intermediários usam `BigInt`: quantidade em milésimos × preço em milésimos. O campo `costMillsExact` preserva essa fração como `{ numerator: 'texto inteiro', denominator: 1000 }`, sem `BigInt` no resultado JSON. Itens não são arredondados antes da soma. Custos por faixa, por categoria, média e ficha são arredondados apenas em seus próprios agregados, ao milésimo mais próximo, com empates afastando-se de zero. A soma de subtotais já arredondados pode diferir do total; o motor sempre volta aos valores exatos. O custo de uma ficha nunca é obtido multiplicando uma média já arredondada.

Custo do item = quantidade × preço aplicável; custo da faixa = soma dos itens; custo da ficha = soma dos pares de cada faixa × seu custo exato; média = custo exato da ficha ÷ 72. Venda da ficha = preço de venda por par × 72. Lucro = venda − custo, preservando a precisão antes do arredondamento; prejuízo é permitido. Margem percentual = lucro exato ÷ venda × 100. Composição soma os mesmos itens por categoria e informa participação no custo, que fica indefinida se o custo total for zero. Resultados fora de `Number.MAX_SAFE_INTEGER` ficam `null` com alerta de limite de precisão.

### Verificação e limites desta etapa

Cache v41, sem adicionar o módulo ao carregamento da aplicação. Os módulos operacionais e a versão visual anterior permanecem intactos. Rode `node --test tests/*.test.js`. A suíte usa exclusivamente fixtures sintéticas, sem consultar/gravar a base operacional. O cenário de conferência foi reparametrizado: valores monetários seguem um fator de escala comum e consumos foram reformulados preservando os produtos. O teste mantém as duas faixas e os pesos 48/24 em 72 pares, verificando média ponderada, composição, venda, lucro e margem; nenhum preço, consumo ou nome operacional foi incorporado.

Há regressões para opcionais omitidos, vigência atual/futura, correções de preço, item e material duplicados, quantidades inválidas, mapas incompletos, material inativo/sem preço, ausência de grade sem fallback implícito, prioridade de padrão, grade real alterada/inválida, consumo uniforme, zero, prejuízo, frações de milésimo, overflow, estado congelado e repetição sem mutação. Esta etapa não tem interface nova para inspeção visual e não afirma persistência ou validação no servidor.

## Etapa 3 — tela de ficha técnica por referência

Ajustes → Modelos → **Ficha** abre a consulta técnica; **Cadastro** mantém os campos antigos do modelo. A ficha apresenta sempre oito seções: 1) custos fixos de solado, palmilha, cola, embalagem e mão de obra; 2) consumo com parte opcional, material, quantidade e unidade; 3) custo de cada item e preço por unidade; 4) custo por par nas faixas e média; 5) custo de 72 pares; 6) venda por par; 7) lucro por par; 8) lucro da ficha e margem sobre a venda. Sem ficha, o formato fica vazio/a conferir e oferece montagem manual. Não há referências, materiais, preços ou consumos operacionais pré-preenchidos.

### Montagem e histórico

“Montar ficha” começa com um rascunho vazio. “Nova versão” copia a versão vigente **hoje em São Paulo**, mesmo quando a pessoa está consultando uma versão anterior ou futura. A cópia conserva campos desconhecidos da versão e dos itens, incluindo `colorMap`; o novo ID e `createdAt` pertencem ao rascunho. A data inicial começa vazia e precisa ser informada. O histórico salvo permanece somente leitura; não há exclusão, edição de registro existente ou migração. Novas vigências comuns recusam datas iniciais ou IDs repetidos; a correção vinculada descrita abaixo é o único caminho para substituir a mesma data; repetir exatamente o candidato já presente não acrescenta outra versão.

Cada item escolhe um material ativo do catálogo, uma parte/identificação opcional e consumo único ou por 35–37/38–39. Materiais usados em mais de uma parte precisam de identificações diferentes. A quantidade aceita até três casas decimais positivas. Itens uniformes podem coexistir com itens por faixa; cada mapa precisa cobrir as duas faixas. A unidade vem do catálogo e não é cadastrada de novo na ficha. A venda por par é obrigatória para salvar uma nova versão, em milésimos exatos; zero explícito é válido, com margem indefinida. Uma versão antiga sem venda continua consultável, com pendência financeira.

Materiais inativos, ausentes, ambíguos e quantidades inválidas bloqueiam uma nova versão. Um material ativo sem preço vigente permite salvar a composição após a revisão mostrar claramente a pendência; item, totais e lucro ficam **A conferir**, nunca zero implícito ou soma parcial. A mesma indicação aparece ao consultar uma ficha cujo material foi inativado posteriormente. Falhas estruturais de uma ficha já salva não são normalizadas; a consulta mostra pendências e a edição/simulação de itens estruturalmente inválidos é recusada para conferência.

Com consumo por faixas, a média e o custo da ficha exigem grade de 72 pares salva em Ajustes por referência ou linha; o padrão da referência tem prioridade. A ficha oferece o atalho **Grade em Ajustes**, que abre o configurador existente para a referência e não salva apenas por abrir. Padrões implícitos não são usados para médias. Sem grade válida, custos por faixa ficam visíveis e os agregados dependentes ficam a conferir. Consumo inteiramente uniforme independe da grade, conforme o contrato do motor. A consulta de versão anterior/futura usa a data inicial dessa versão para os preços e informa essa data na tela; a vigente usa hoje. O histórico guarda a composição, não congela o catálogo de preços ou a grade. Correções do catálogo e ajustes de grade podem, portanto, mudar projeções consultadas.

### Simulação e texto para WhatsApp

“Simular sem salvar” recalcula venda, lucro e margem imediatamente. A troca temporária de material mantém as quantidades e exige material ativo com a mesma unidade; não há conversão de unidades inferida. A tela mostra as diferenças de custo por par e por ficha em relação à versão consultada. As diferenças são apenas subtrações, em milésimos, de dois agregados já calculados pelo motor; quando qualquer agregado está indisponível, a diferença também fica a conferir. Não são duplicadas fórmulas de custo, ponderação, ficha, lucro ou margem na interface.

“Texto para WhatsApp” gera o resumo 1–8 e oferece cópia para a área de transferência, com texto selecionável quando a cópia não está disponível. Simulações são identificadas como temporárias e não salvas. A tela não abre conversa nem envia mensagem a terceiros. Abrir, mudar versão, simular, gerar/copiar texto, cancelar, voltar ou navegar não altera o JSON, cria semana ou registra evento operacional.

### Persistência, isolamento e verificação

`tech-sheet.js` passou a ser carregado explicitamente para esta tela. Na entrega inicial da Etapa 3, permanecia byte a byte como na Etapa 2; a extensão de correções descrita abaixo altera somente sua seleção e validação de histórico. `tech-sheet-ui.js` contém apresentação, cópias de consulta e candidatos append-only; todos os valores de custo, composição, venda, lucro e margem vêm do motor puro. O custo exato de item é formatado com até seis casas, preservando a fração entregue pelo motor; totais são os agregados do motor em três casas, sem multiplicar a média arredondada por 72.

A revisão e a confirmação conferem novamente sessão, ausência de pendência/conflito, estado visível e JSON bruto confirmado online. O candidato só acrescenta `settings.techSheets[ref].versions`, preservando campos desconhecidos e ausentes de todo o restante do JSON. O salvamento continua usando a fila durável e um único `save_app_state` com revisão esperada. Duplo clique, callback antigo, fechamento, outro diálogo, troca de tela, atualização remota e perda de autenticação não reaplicam o candidato. `save() === false` ou exceção antes da fila durável reverte o estado e conserva rascunho/ID para nova revisão. Falha apenas do cache mantém a intenção durável; recusa remota e conflito continuam pendentes; resposta perdida é reconciliada por leitura. Confirmação local não é apresentada como confirmação online.

Não há alterações nos motores de estoque, montagem a pagar, pedidos ou financeiro; no catálogo de materiais; nos caminhos legados `itemCost`, `localSheet` ou `catalogSheet`; em SQL, políticas, autenticação ou base operacional. Não implementa análise de impacto de preços da Etapa 4 nem integrações da Etapa 5. Não cria lançamentos online nem registros no Notion durante implementação ou testes.

Cache v42 inclui os dois módulos da ficha técnica. Execute `node --test tests/*.test.js`. Testes unitários, DOM sintético estrito e CAS simulado cobrem as oito seções, ausência de pré-preenchimento, materiais/quantidades, versões, precisão, grade, simulações, cópia sem envio, preservação do JSON bruto, confirmação, cancelamento, navegação, callback antigo, repetição, falhas, pendência, conflito e resposta perdida. Todos os dados novos são fictícios; os testes não acessam serviços operacionais. Testes DOM não substituem inspeção visual em navegador, e a aceitação das políticas efetivamente instaladas não foi testada por escrita na base real.

Verificação local desta entrega: **1.355 testes passaram**, sem falhas ou testes ignorados, e `git diff --check` ficou limpo. Uma tentativa de inspeção visual isolada com dados sintéticos foi bloqueada na inicialização do Chromium (`socket: Operation not permitted`); portanto o layout desktop/iPhone não foi validado em navegador real nesta entrega. Nenhuma escrita na base real foi usada para contornar essa limitação.

### Correção de versão salva — extensão da Etapa 3

A versão vigente oferece **Corrigir esta versão**. O botão abre um rascunho com todo o conteúdo da folha vigente, preservando metadados desconhecidos, IDs dos itens e `colorMap`. A data inicial permanece somente leitura. Depois de revisar e confirmar, é acrescentada uma nova versão com ID próprio, a **mesma** `validFrom`, `supersedesVersionId` apontando para o alvo e `correctedAt` com a data/hora UTC real da confirmação. O registro alvo continua byte a byte intacto. A marca **Corrigida em**, exibida no fuso de São Paulo, é derivada do sucessor; não é gravada no registro antigo. A correção pode ser corrigida novamente pela mesma regra. Versões anteriores, futuras e já substituídas continuam disponíveis para consulta, sem botão de correção nesta tela.

`versionHistory(state, ref)` no motor puro valida o histórico e devolve cópias independentes de `{ version, correctedBy }`. `applicableVersion` considera apenas folhas não substituídas e escolhe a maior data inicial menor ou igual à data consultada. Duas versões comuns com a mesma data continuam inválidas. Uma correção precisa apontar para uma versão anterior no array, da mesma referência e data, com um único sucessor. Referências órfãs, links entre referências, ciclos, links para frente, ramificações, alvo já corrigido e timestamps incoerentes são recusados. A data de correção não pode preceder a criação informada das versões envolvidas, a correção anterior nem a última correção acrescentada ao histórico. Versões antigas sem `createdAt`/`note` continuam consultáveis; não há preenchimento retroativo. `correctedAt` é auditoria, não uma nova vigência: a folha corrigida passa a representar aquela data inicial, também nas consultas retroativas. As fórmulas de consumo, preço, custo, venda, lucro e margem não mudaram.

A apresentação de uma versão original já corrigida continua possível para conferência: usa uma cópia isolada da versão escolhida, sem metadados de encadeamento nessa projeção temporária, e exibe o aviso de que foi substituída. Nenhuma versão armazenada é modificada. **Nova versão** comum copia o conteúdo atual mas retira `supersedesVersionId`/`correctedAt` do novo rascunho, pedindo uma data inicial nova; não herda acidentalmente a semântica de correção.

`draftCorrection` e `correctVersion` preparam a cópia e o candidato append-only no módulo de interface. A confirmação mantém todas as guardas da Etapa 3: base bruta confirmada, pendência/conflito, concorrência, cliques repetidos, callbacks antigos, fechamento/navegação, falha local `false`/exceção, recusa remota e resposta perdida. Se a versão vigente mudar com a virada do dia em São Paulo enquanto a revisão estiver aberta, a confirmação antiga é recusada. O timestamp da correção é capturado na confirmação, e uma falha local conserva o ID/rascunho para nova revisão.

Com autorização específica, somente a **consulta** do aviso de desativação de material foi adaptada: históricos com correção usam a mesma seleção de `applicableVersion`, ignorando itens que aparecem apenas em versões substituídas e apontando as referências cujo material está na folha vigente. Catálogo, preços, ativação/desativação e seus candidatos permanecem inalterados; `material-catalog.js` não mudou. A compatibilidade é coberta por teste sintético com material presente na ficha corrigida e ausente da folha de outra referência.

Cache v43 atualiza os módulos da ficha técnica. Os testes novos cobrem cadeias sucessivas, fronteiras de vigência, auditoria, cópias independentes, preservação byte a byte, cálculos usando a folha, novo rascunho comum após correção, UI somente na vigente, confirmação/rollback e CAS único. As limitações de inspeção visual e de escrita na base real declaradas acima permanecem. Não houve merge, deploy, migração, lançamento operacional ou registro no Notion.

Verificação desta extensão: **1.437 testes passaram**, sem falhas ou testes ignorados, incluindo 82 cenários adicionais de correção/compatibilidade; `git diff --check` ficou limpo. Os demais motores e o módulo de catálogo permanecem idênticos ao commit anterior do PR.
