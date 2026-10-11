-- REVIEW PROPOSAL ONLY. Apply only after explicit release approval.
-- No operational writes, backfill, existing-function replacement or ACL expansion.
-- Self-contained trigger: SECURITY INVOKER never needs helper-function grants.
CREATE FUNCTION private.guard_stock_adjustments_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $guard$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.data ELSE '{}'::jsonb END;
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE NEW.data END;
  v_operation text := TG_OP;
BEGIN
  -- BEGIN REUSABLE VALIDATION. Read-only tests execute this exact block.
  <<validate_stock>>
  DECLARE
    old_ledger jsonb; ledger jsonb; production jsonb; models jsonb; mountings jsonb;
    e jsonb; oe jsonb; m jsonb; origin jsonb; event_rows jsonb := '[]'::jsonb;
    ids text[] := ARRAY[]::text[]; refs text[]; new_ids text[] := ARRAY[]::text[];
    q numeric; d numeric; model_count integer; n integer; reversal_count integer;
    ref text; line text; col text; sector text; target text; global_target text;
    k text; batch_id text; origin_batch text; issue record; has_adjustments boolean; old_has_adjustments boolean;
  BEGIN
    IF jsonb_typeof(v_old) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_new) IS DISTINCT FROM 'object'
       OR (v_old ? 'stockLedger' AND jsonb_typeof(v_old->'stockLedger') IS DISTINCT FROM 'array')
       OR (v_new ? 'stockLedger' AND jsonb_typeof(v_new->'stockLedger') IS DISTINCT FROM 'array')
    THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Estrutura do estoque inválida.'; END IF;
    old_ledger := coalesce(v_old->'stockLedger','[]'::jsonb);
    ledger := coalesce(v_new->'stockLedger','[]'::jsonb);
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(old_ledger) a WHERE a.value ? 'adjustmentVersion') INTO old_has_adjustments;
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(ledger) a WHERE a.value ? 'adjustmentVersion') INTO has_adjustments;
    IF v_operation='DELETE' THEN
      IF old_has_adjustments THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A base contém ajustes de estoque protegidos e não pode ser apagada.'; END IF;
      EXIT validate_stock;
    END IF;

    -- Presence, not truthiness: stripping the marker or changing its type never
    -- converts a protected adjustment into an editable legacy movement.
    FOR oe IN SELECT value FROM jsonb_array_elements(old_ledger) WHERE value ? 'adjustmentVersion' LOOP
      SELECT count(*), jsonb_agg(a.value)->0 INTO n,e FROM jsonb_array_elements(ledger) a WHERE a.value->>'id'=oe->>'id';
      IF n<>1 OR e IS DISTINCT FROM oe THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Ajuste confirmado não pode ser alterado ou apagado; registre um estorno.';
      END IF;
    END LOOP;
    FOR e IN SELECT value FROM jsonb_array_elements(ledger) LOOP
      IF e ?| ARRAY['mountingId','adjustmentBatchId','reversalOf','reason'] AND NOT (e ? 'adjustmentVersion') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Montagem ou metadados de ajuste exigem adjustmentVersion: 1.';
      END IF;
      IF e ? 'adjustmentVersion' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_ledger) a WHERE a.value->>'id'=e->>'id') THEN
        new_ids := array_append(new_ids,e->>'id');
      ELSIF e ? 'adjustmentVersion' AND EXISTS (SELECT 1 FROM jsonb_array_elements(old_ledger) a WHERE a.value->>'id'=e->>'id' AND NOT (a.value ? 'adjustmentVersion')) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Movimento legado não pode ser convertido em ajuste; acrescente um novo registro.';
      END IF;
    END LOOP;
    IF cardinality(new_ids)>0 THEN
      IF v_operation<>'UPDATE' OR (v_new-'stockLedger') IS DISTINCT FROM (v_old-'stockLedger')
         OR jsonb_array_length(ledger)<=jsonb_array_length(old_ledger)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(old_ledger) WITH ORDINALITY a(value,ord)
                    WHERE ledger->((a.ord-1)::integer) IS DISTINCT FROM a.value)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(ledger) WITH ORDINALITY a(value,ord)
                    WHERE a.ord>jsonb_array_length(old_ledger) AND NOT (a.value ? 'adjustmentVersion'))
      THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Salve o ajuste separadamente, apenas acrescentando novos ajustes ao estoque.'; END IF;
    END IF;
    -- Legacy saves retain their former behavior until the first adjustment.
    -- Reserved fields above are always checked, including null/false values.
    IF NOT has_adjustments AND NOT old_has_adjustments THEN EXIT validate_stock; END IF;
    IF jsonb_typeof(v_new->'settings'->'models') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_new->'settings'->'mountings') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_new->'weeks') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_each(v_new->'weeks') w WHERE jsonb_typeof(w.value->'entries') IS DISTINCT FROM 'array')
    THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Estrutura de produção ou cadastros inválida.'; END IF;
    models:=v_new->'settings'->'models'; mountings:=v_new->'settings'->'mountings';
    SELECT coalesce(jsonb_agg(a.value),'[]'::jsonb) INTO production FROM jsonb_each(v_new->'weeks') w
      CROSS JOIN LATERAL jsonb_array_elements(w.value->'entries') a;
    FOREACH k IN ARRAY ARRAY['models','mountings'] LOOP
      ids:=ARRAY[]::text[];
      FOR e IN SELECT value FROM jsonb_array_elements(CASE k WHEN 'models' THEN models ELSE mountings END) LOOP
        IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string'
           OR btrim(coalesce(e->>'id',''))='' OR (e->>'id')=ANY(ids)
        THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identificador de cadastro inválido ou duplicado.'; END IF;
        ids:=array_append(ids,e->>'id');
      END LOOP;
    END LOOP;
    -- Preserve the meaning of already-saved local cabedal references even if a
    -- later settings edit attempts to repoint that ref at another model ID.
    FOR oe IN SELECT value FROM jsonb_array_elements(old_ledger)
      WHERE value ? 'adjustmentVersion' AND value ? 'mountingId' AND value->>'sector'='cabedal' LOOP
      SELECT array_agg(a.value->>'id' ORDER BY a.value->>'id') INTO refs FROM jsonb_array_elements(coalesce(v_old->'settings'->'models','[]'::jsonb)) a
        WHERE upper(coalesce(nullif(a.value->>'ref',''),substring(a.value->>'name' FROM '\m[0-9]{3}R?\M'))) = oe->>'ref';
      IF refs IS DISTINCT FROM (SELECT array_agg(a.value->>'id' ORDER BY a.value->>'id') FROM jsonb_array_elements(models) a
        WHERE upper(coalesce(nullif(a.value->>'ref',''),substring(a.value->>'name' FROM '\m[0-9]{3}R?\M'))) = oe->>'ref')
      THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Referência de ajuste salvo não pode ser associada a outro modelo.'; END IF;
    END LOOP;

    -- IDs are one namespace across stock, production and expenses.
    ids:=ARRAY[]::text[];
    FOR e IN SELECT value FROM jsonb_array_elements(ledger || production || coalesce(v_new->'factoryExpenses','[]'::jsonb)) LOOP
      IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string'
         OR btrim(coalesce(e->>'id',''))='' OR (e->>'id')=ANY(ids)
      THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identificador operacional ausente ou duplicado.'; END IF;
      ids:=array_append(ids,e->>'id');
    END LOOP;
    -- Shared basic movement checks run before all numeric/date casts.
    FOR e IN SELECT value FROM jsonb_array_elements(ledger || production) LOOP
      IF jsonb_typeof(e->'date') IS DISTINCT FROM 'string' OR coalesce(e->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         OR jsonb_typeof(e->'qty') IS DISTINCT FROM 'number'
      THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Data ou quantidade do movimento inválida.'; END IF;
      PERFORM (e->>'date')::date;
      q:=(e->>'qty')::numeric;
      IF q<=0 OR q<>trunc(q) OR q>9007199254740991 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Quantidade deve ser um inteiro positivo seguro.'; END IF;
    END LOOP;

    -- Each production delivery enters both global and its mounting. Finished
    -- production consumes both scopes and adds global finished products only.
    FOR e IN SELECT value FROM jsonb_array_elements(production) LOOP
      SELECT value INTO m FROM jsonb_array_elements(models) WHERE value->>'id'=e->>'modelId';
      ref:=upper(coalesce(nullif(m->>'ref',''),substring(m->>'name' FROM '\m[0-9]{3}R?\M')));
      line:=coalesce(nullif(e->>'line',''),nullif(m->>'line',''),coalesce(substring(coalesce(nullif(m->>'ref',''),nullif(e->>'modelName',''),m->>'name','') FROM '[0-9]'),'')||'00');
      IF coalesce(e->>'kind','') NOT IN ('cabedal','solado','palmilha','finished') OR line !~ '^[0-9]00$'
         OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(mountings) a WHERE a.value->>'id'=e->>'mountingId')
         OR (e->>'kind' IN ('cabedal','finished') AND (m IS NULL OR coalesce(ref,'') !~ '^[0-9]{3}R?$'
             OR (coalesce(m->>'line','')<>'' AND m->>'line'<>line)))
      THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Montagem, modelo, linha ou componente da produção inválido.'; END IF;
      FOREACH sector IN ARRAY CASE WHEN e->>'kind'='finished' THEN ARRAY['cabedal','solado','palmilha','produto_pronto'] ELSE ARRAY[e->>'kind'] END LOOP
        IF sector='palmilha' AND e->>'kind'='finished' AND (line='300' OR m->'usesPalmilha'='false'::jsonb) THEN CONTINUE; END IF;
        global_target:=CASE WHEN sector IN ('solado','palmilha') THEN '@line:'||line ELSE ref END;
        target:=CASE WHEN sector='cabedal' THEN e->>'modelId' WHEN sector IN ('solado','palmilha') THEN '@line:'||line ELSE ref END;
        d:=(e->>'qty')::numeric * CASE WHEN e->>'kind'='finished' AND sector<>'produto_pronto' THEN -1 ELSE 1 END;
        event_rows:=event_rows||jsonb_build_array(jsonb_build_object('scope','global','location','all','sector',sector,'target',global_target,'globalTarget',global_target,'color',e->>'color','date',e->>'date','delta',d));
        IF sector<>'produto_pronto' THEN event_rows:=event_rows||jsonb_build_array(jsonb_build_object('scope','mounting','location',e->>'mountingId','sector',sector,'target',target,'globalTarget',global_target,'color',e->>'color','date',e->>'date','delta',d)); END IF;
      END LOOP;
    END LOOP;
    FOR e IN SELECT value FROM jsonb_array_elements(ledger) LOOP
      sector:=e->>'sector'; ref:=upper(e->>'ref'); target:=NULL;
      IF coalesce(e->>'direction','') NOT IN ('in','out') OR coalesce(sector,'') NOT IN ('cabedal','solado','palmilha','produto_pronto')
         OR jsonb_typeof(e->'ref') IS DISTINCT FROM 'string' OR btrim(coalesce(ref,''))=''
      THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Movimento de estoque inválido.'; END IF;
      line:=CASE WHEN ref LIKE '@LINE:%' THEN substring(ref FROM 7) ELSE coalesce(substring(ref FROM '[0-9]'),'')||'00' END;
      global_target:=CASE WHEN sector IN ('solado','palmilha') THEN '@line:'||line ELSE ref END;
      IF sector IN ('solado','palmilha') AND line !~ '^[0-9]00$' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Linha do movimento de estoque inválida.'; END IF;
      IF e ? 'adjustmentVersion' THEN
        IF e->'adjustmentVersion' IS DISTINCT FROM '1'::jsonb
           OR (e-ARRAY['id','date','direction','sector','ref','color','qty','note','createdAt','adjustmentVersion','adjustmentBatchId','reason','mountingId','reversalOf'])<>'{}'::jsonb
           OR jsonb_typeof(e->'adjustmentBatchId') IS DISTINCT FROM 'string' OR btrim(regexp_replace(coalesce(e->>'adjustmentBatchId',''),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'))='' OR length(e->>'adjustmentBatchId')>150
           OR jsonb_typeof(e->'reason') IS DISTINCT FROM 'string' OR btrim(regexp_replace(coalesce(e->>'reason',''),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'))='' OR length(e->>'reason')>500
           OR jsonb_typeof(e->'color') IS DISTINCT FROM 'string' OR btrim(regexp_replace(coalesce(e->>'color',''),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'))='' OR jsonb_typeof(e->'note') IS DISTINCT FROM 'string'
           OR jsonb_typeof(e->'createdAt') IS DISTINCT FROM 'string'
           OR coalesce(e->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Registro de ajuste inválido.'; END IF;
        PERFORM (e->>'createdAt')::timestamptz;
        IF (e->>'id')=ANY(new_ids) AND (e->>'date')::date>(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date
        THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Novo ajuste não pode ter data posterior a hoje em São Paulo.'; END IF;
        IF e->>'ref' IS DISTINCT FROM global_target THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A referência do ajuste deve estar na forma canônica.'; END IF;
        IF sector IN ('cabedal','produto_pronto') THEN
          SELECT count(*),min(a.value->>'id') INTO model_count,target FROM jsonb_array_elements(models) a
            WHERE upper(coalesce(nullif(a.value->>'ref',''),substring(a.value->>'name' FROM '\m[0-9]{3}R?\M')))=ref;
          IF model_count<>1 OR ref !~ '^[0-9]{3}R?$' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A referência do ajuste deve identificar exatamente um modelo.'; END IF;
        ELSE
          target:='@line:'||line;
          IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(models) a WHERE coalesce(nullif(a.value->>'line',''),coalesce(substring(coalesce(a.value->>'ref',a.value->>'name','') FROM '[0-9]'),'')||'00')=line)
          THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Linha do ajuste não existe no cadastro.'; END IF;
        END IF;
        IF e ? 'mountingId' AND (sector='produto_pronto' OR jsonb_typeof(e->'mountingId') IS DISTINCT FROM 'string'
           OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(mountings) a WHERE a.value->>'id'=e->>'mountingId'))
        THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Ajuste localizado exige montagem válida e somente materiais.'; END IF;
        IF e ? 'reversalOf' THEN
          SELECT value INTO origin FROM jsonb_array_elements(ledger) WHERE value->>'id'=e->>'reversalOf';
          IF jsonb_typeof(e->'reversalOf') IS DISTINCT FROM 'string' OR btrim(coalesce(e->>'reversalOf',''))=''
             OR origin IS NULL OR NOT (origin ? 'adjustmentVersion') OR origin ? 'reversalOf'
             OR origin->>'id'=e->>'id' OR origin->>'direction'=e->>'direction'
             OR (e->>'date')::date<(origin->>'date')::date
             OR e->'mountingId' IS DISTINCT FROM origin->'mountingId'
             OR e->'sector' IS DISTINCT FROM origin->'sector' OR e->'ref' IS DISTINCT FROM origin->'ref'
             OR e->'color' IS DISTINCT FROM origin->'color' OR e->'qty' IS DISTINCT FROM origin->'qty'
             OR (SELECT count(*) FROM jsonb_array_elements(ledger) a WHERE a.value->>'reversalOf'=origin->>'id')<>1
             OR ((e->>'id')=ANY(new_ids) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_ledger) a WHERE a.value=origin))
          THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Estorno exige um ajuste confirmado, direção oposta, dados iguais, data válida e origem ainda não estornada.'; END IF;
        END IF;
      END IF;
      d:=(e->>'qty')::numeric*CASE WHEN e->>'direction'='out' THEN -1 ELSE 1 END;
      event_rows:=event_rows||jsonb_build_array(jsonb_build_object('scope','global','location','all','sector',sector,'target',global_target,'globalTarget',global_target,'color',e->>'color','date',e->>'date','delta',d));
      IF e ? 'adjustmentVersion' AND e ? 'mountingId' THEN
        event_rows:=event_rows||jsonb_build_array(jsonb_build_object('scope','mounting','location',e->>'mountingId','sector',sector,'target',target,'globalTarget',global_target,'color',e->>'color','date',e->>'date','delta',d));
      END IF;
    END LOOP;
    IF cardinality(new_ids)>0 THEN
      SELECT count(DISTINCT a.value->>'adjustmentBatchId'),min(a.value->>'adjustmentBatchId'),count(*) FILTER (WHERE a.value ? 'reversalOf')
        INTO n,batch_id,reversal_count FROM jsonb_array_elements(ledger) a WHERE (a.value->>'id')=ANY(new_ids);
      IF n<>1 OR EXISTS (SELECT 1 FROM jsonb_array_elements(old_ledger) a WHERE a.value->>'adjustmentBatchId'=batch_id)
         OR (SELECT count(DISTINCT jsonb_build_array(a.value->'date',a.value->'reason',a.value->'createdAt'))
             FROM jsonb_array_elements(ledger) a WHERE (a.value->>'id')=ANY(new_ids))<>1
         OR reversal_count NOT IN (0,cardinality(new_ids))
      THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Cada operação exige um lote novo, com a mesma data, motivo e horário; não misture ajuste e estorno.'; END IF;
      WITH colors AS (
        SELECT a.value,btrim(regexp_replace(lower(regexp_replace(normalize(a.value->>'color',NFD),'[̀-ͯ]','','g')),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')) folded
        FROM jsonb_array_elements(ledger) a WHERE (a.value->>'id')=ANY(new_ids)
      ), targets AS (
        SELECT c.value->>'mountingId' mounting_id,c.value->>'sector' sector,c.value->>'ref' ref,
          CASE WHEN c.folded IN ('','ficha','fichas','kit','kits','sem cor','sem cor discriminada','nao informado','nao informada','cor nao informada') THEN 'sem cor discriminada'
            WHEN c.folded IN ('rose','rosa') THEN 'rose' WHEN c.folded IN ('off','off white','off-white','branco') THEN 'off white'
            WHEN c.folded IN ('ouro','ouro light','ourolight') THEN 'ouro light' ELSE c.folded END color FROM colors c
      ) SELECT count(*) INTO n FROM (SELECT 1 FROM targets t GROUP BY t.mounting_id,t.sector,t.ref,t.color HAVING count(*)>1) duplicates;
      IF n>0 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Item repetido no mesmo lote de ajuste.'; END IF;
      IF reversal_count>0 THEN
        SELECT count(DISTINCT o.value->>'adjustmentBatchId'),min(o.value->>'adjustmentBatchId') INTO n,origin_batch
          FROM jsonb_array_elements(ledger) a JOIN jsonb_array_elements(old_ledger) o ON o.value->>'id'=a.value->>'reversalOf'
          WHERE (a.value->>'id')=ANY(new_ids);
        IF n<>1 OR cardinality(new_ids)<>(SELECT count(*) FROM jsonb_array_elements(old_ledger) o WHERE o.value->>'adjustmentBatchId'=origin_batch)
        THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Estorne o lote original completo em uma única operação.'; END IF;
      END IF;
    END IF;
    -- Daily closing balances match the app's date-only event model. Global is
    -- inclusive of mountings; outside = global - sum(mountings), never a sum of
    -- the global stock and mounted stock. No history rows are rewritten.
    WITH raw AS (
      SELECT a.value->>'scope' scope,a.value->>'location' location,a.value->>'sector' sector,a.value->>'target' target,
        a.value->>'globalTarget' global_target,(a.value->>'date')::date AS event_date,(a.value->>'delta')::numeric delta,
        btrim(regexp_replace(lower(regexp_replace(normalize(coalesce(a.value->>'color',''),NFD),'[̀-ͯ]','','g')),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')) folded
      FROM jsonb_array_elements(event_rows) a
    ), normalized AS (
      SELECT r.*,CASE WHEN r.folded IN ('','ficha','fichas','kit','kits','sem cor','sem cor discriminada','nao informado','nao informada','cor nao informada') THEN 'sem cor discriminada'
        WHEN r.folded IN ('rose','rosa') THEN 'rose' WHEN r.folded IN ('off','off white','off-white','branco') THEN 'off white'
        WHEN r.folded IN ('ouro','ouro light','ourolight') THEN 'ouro light' ELSE r.folded END color FROM raw r
    ), deltas AS (
      SELECT n.scope,n.location,n.sector,n.target,n.color,n.event_date,sum(n.delta) delta FROM normalized n GROUP BY n.scope,n.location,n.sector,n.target,n.color,n.event_date
      UNION ALL
      SELECT 'outside','all',n.sector,n.global_target,n.color,n.event_date,sum(CASE WHEN n.scope='global' THEN n.delta ELSE -n.delta END)
        FROM normalized n GROUP BY n.sector,n.global_target,n.color,n.event_date
    ), balances AS (
      SELECT d.*,sum(d.delta) OVER (PARTITION BY d.scope,d.location,d.sector,d.target,d.color ORDER BY d.event_date ROWS UNBOUNDED PRECEDING) balance FROM deltas d
    )
    SELECT b.* INTO issue FROM balances b WHERE b.balance<0 OR b.balance>9007199254740991 ORDER BY b.event_date,b.scope,b.location,b.sector,b.target,b.color LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE=format('Saldo de estoque inválido em %s: %s / %s / %s / %s / %s (%s pares).',issue.event_date,issue.scope,issue.location,issue.sector,issue.target,issue.color,issue.balance);
    END IF;
  END validate_stock;
  -- END REUSABLE VALIDATION.
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$guard$;

-- New object only. Existing schema/table/function ACLs are left untouched.
REVOKE ALL ON FUNCTION private.guard_stock_adjustments_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_stock_adjustments_guard_v1
BEFORE INSERT OR UPDATE OR DELETE ON public.app_state
FOR EACH ROW EXECUTE FUNCTION private.guard_stock_adjustments_v1();
