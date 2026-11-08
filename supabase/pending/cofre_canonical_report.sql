-- Candidate, not a migration and not deployed. Security-critical server-side
-- reconstruction; keep in sync with the versioned engine. CI must prove parity.
begin;
create function capital_web3_private.cofre_canonical_report(v jsonb, asof text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  rules constant jsonb := $json${"secret_exposure":{"title":"Exposição de segredo","yes":"Foi informada exposição de segredo. A avaliação está bloqueada para resposta a incidente.","no":"Não foi relatada exposição conhecida. Isso não comprova que um segredo esteja protegido.","impact":"Um segredo exposto pode permitir acesso indevido. Revogar permissões não resolve a exposição da chave.","action":"Interrompa novas interações e procure apoio de resposta a incidentes por um canal verificado. Não envie segredos ou códigos.","verification":"Registrar somente o encaminhamento e a revisão humana; nunca o conteúdo do segredo."},"backup_offline":{"title":"Backup fora da nuvem","yes":"Foi informado backup offline. Seu conteúdo e sua proteção física não foram verificados pelo sistema.","no":"Não foi informado backup offline disponível.","impact":"Perda de acesso e exposição de cópias digitais podem comprometer a recuperação.","action":"Revise com o titular como o backup é protegido fora da nuvem, sem revelar seu conteúdo.","verification":"Titular confirma apenas existência e proteção do backup, sem palavras, fotos ou localização exata."},"recovery_tested":{"title":"Recuperação testada pelo titular","yes":"O titular informou um teste de recuperação. O sistema não executou nem verificou esse teste.","no":"Não foi informado teste de recuperação concluído.","impact":"Um backup existente pode não permitir recuperação quando necessário.","action":"Planeje uma revisão de recuperação pelo próprio titular com orientação confiável e ambiente adequado.","verification":"Registrar somente conclusão ou pendência declarada; nunca inserir palavras ou códigos neste portal."},"wallet_separation":{"title":"Separação de funções","yes":"Foi informada separação de funções. Endereços sob a mesma seed não comprovam independência de chaves.","no":"Não foi informada separação entre guarda, aplicativos e gastos.","impact":"Misturar funções pode ampliar o impacto de uma interação indevida.","action":"Mapeie as funções de guarda, aplicativos e gastos de forma proporcional à necessidade do titular.","verification":"Revisor confere o mapa fictício; uma função de cofre não deve depender de conexão com aplicativos."},"device_updates":{"title":"Atualizações do dispositivo","yes":"Foram informadas atualizações em dia. Isso não atesta a integridade do dispositivo.","no":"Não foram informadas atualizações em dia.","impact":"Falhas conhecidas no dispositivo podem afetar credenciais e interações.","action":"Confira atualizações pelos canais oficiais do dispositivo e registre a pendência sem instalar ferramentas indicadas por desconhecidos.","verification":"Titular registra apenas a situação declarada das atualizações."},"domain_checks":{"title":"Conferência de domínio e interação","yes":"Foi informada conferência de domínios. Aparência, marca ou assinatura sem gas não comprovam segurança.","no":"Não foi informada rotina de conferência de domínio e interação.","impact":"Links falsos e pedidos urgentes podem induzir interações prejudiciais.","action":"Antes de interagir, confira fonte, incentivo, urgência, assinatura solicitada e limite de perda. Se houver dúvida, pare.","verification":"Revisor pede uma explicação fictícia da conferência, sem abrir link desconhecido ou assinar."},"permissions_review":{"title":"Revisão de permissões","yes":"Foi informada revisão de permissões. A análise não comprova revogação nem elimina risco de chave exposta.","no":"Não foi informada revisão de permissões.","impact":"Permissões e assinaturas de gasto podem manter poderes diferentes ao longo do tempo.","action":"Liste por categoria os tipos de permissão e as dúvidas para revisão humana. O portal não aprova nem revoga permissões.","verification":"Registrar situação e lacunas da revisão fictícia, sem conectar carteira ou executar ações."}}$json$::jsonb;
  evidence_labels constant jsonb := $json${"declared":"Autodeclarado na simulação","observed":"Revisão humana declarada na simulação","unknown":"Sem resposta ou evidência informada"}$json$::jsonb;
  cat_labels constant jsonb := $json${"exchange":"Corretora","vault":"Guarda","apps":"Aplicativos","spending":"Gastos","watch":"Observação"}$json$::jsonb;
  net_labels constant jsonb := $json${"bitcoin":"Bitcoin","evm":"EVM","other":"Outra rede","unknown":"Rede não informada"}$json$::jsonb;
  custody_labels constant jsonb := $json${"self":"Autocustódia declarada","third_party":"Custódia de terceiro declarada","unknown":"Custódia não informada"}$json$::jsonb;
  rule jsonb; resp jsonb; id text; answer text; ev text; stat text; impact text; action text;
  controls jsonb := '[]'; findings jsonb := '[]'; plan jsonb := '[]'; inv jsonb := '[]';
  gaps jsonb := '[]'; unknown_fields text := ''; item jsonb; count_provided int:=0; count_declared int:=0; count_observed int:=0;
  pos int:=0; blocked boolean; report_status text; report_summary text; inventory_unknown boolean:=false;
  ids text[]:=array['secret_exposure','backup_offline','recovery_tested','wallet_separation','device_updates','domain_checks','permissions_review'];
  asof_time timestamptz;
begin
  perform capital_web3_private.validate_cofre_intake(v);
  if asof is null or asof !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' then
    raise exception 'invalid timestamp' using errcode='22023';
  end if;
  begin asof_time:=asof::timestamptz;
  exception when others then raise exception 'invalid timestamp' using errcode='22023'; end;
  foreach id in array ids loop
    rule:=rules->id; resp:=v->'controls'->id; answer:=resp->>'answer'; ev:=resp->>'evidence';
    if answer <> 'unknown' then count_provided:=count_provided+1; end if;
    if ev = 'declared' then count_declared:=count_declared+1; elsif ev='observed' then count_observed:=count_observed+1; end if;
    stat:=case when id='secret_exposure' and answer='yes' then 'critical' when answer='unknown' then 'unknown' when id<>'secret_exposure' and answer='no' then 'gap' else 'reported' end;
    if stat in ('critical','unknown','gap') then
      action:=case when answer='unknown' and id='secret_exposure' then 'Confirme com o titular se há suspeita de exposição, sem pedir ou registrar o segredo.'
        when answer='unknown' then 'Esclareça com o titular: '||lower(rule->>'title')||'. Não preencha a resposta por suposição.' else rule->>'action' end;
      impact:=case when answer='unknown' then 'Sem resposta, este controle não pode ser considerado atendido. '|| (rule->>'impact') else rule->>'impact' end;
      findings:=findings||jsonb_build_array(jsonb_build_object('id',id,'title',rule->>'title','severity',case when stat='critical' then 'critical' when id=any(array['backup_offline','recovery_tested','secret_exposure']) then 'high' else 'medium' end,'evidence',evidence_labels->>ev,'impact',impact,'action',action));
      plan:=plan||jsonb_build_array(jsonb_build_object('priority',case when stat='critical' then 'P0' else 'P1' end,'action',action,'owner',case when stat='critical' then 'Titular e apoio humano de resposta a incidentes' else 'Titular, com revisão do consultor' end,
        'deadline',case when stat='critical' or id='secret_exposure' then 'Antes de novas interações' else 'Na próxima revisão humana' end,
        'verification',case when answer='unknown' then 'Registrar somente a opção confirmada e a origem declarada da resposta.' else rule->>'verification' end));
    end if;
    controls:=controls||jsonb_build_array(jsonb_build_object('id',id,'title',rule->>'title','answer',answer,'evidence',ev,'evidence_label',evidence_labels->>ev,'status',stat,
      'explanation',case when answer='unknown' then 'Resposta desconhecida. O sistema não inferiu proteção nem ausência de risco.' when answer='yes' then rule->>'yes' else rule->>'no' end));
  end loop;
  if v#>>'{profile,liquidity}'='unknown' then gaps:=gaps||jsonb_build_array('necessidade de liquidez'); unknown_fields:='necessidade de liquidez'; end if;
  if v#>>'{profile,loss_capacity}'='unknown' then gaps:=gaps||jsonb_build_array('capacidade de absorver perda'); unknown_fields:=unknown_fields||case when unknown_fields='' then '' else ' e ' end||'capacidade de absorver perda'; end if;
  if jsonb_array_length(gaps)>0 then
    action:='Esclareça liquidez e capacidade de perda com opções, sem pedir valores exatos.';
    findings:=findings||jsonb_build_array(jsonb_build_object('id','profile_unknown','title','Contexto incompleto','severity','medium','evidence','Opções não informadas: '||unknown_fields,'impact','Faltam dados de contexto; não há base para decisões financeiras individualizadas.','action',action));
  end if;
  if v#>>'{profile,liquidity}'='short_term' or v#>>'{profile,loss_capacity}'='essential' then
    action:='Priorize esclarecer a necessidade de caixa e a proteção dos recursos essenciais com o responsável humano.';
    findings:=findings||jsonb_build_array(jsonb_build_object('id','essential_or_short_term','title','Recursos essenciais ou necessidade de curto prazo','severity','high','evidence','Contexto declarado nas opções da simulação','impact','Perdas ou indisponibilidade podem afetar necessidades próximas. Este questionário não autoriza exposição financeira.','action',action));
  end if;
  for item in select value from jsonb_array_elements(v->'inventory') loop
    pos:=pos+1; if item->>'network'='unknown' or item->>'custody'='unknown' then inventory_unknown:=true; end if;
    inv:=inv||jsonb_build_array(item||jsonb_build_object('title','Item fictício '||pos,'category_label',cat_labels->>(item->>'category'),'network_label',net_labels->>(item->>'network'),'custody_label',custody_labels->>(item->>'custody')));
  end loop;
  if jsonb_array_length(inv)=0 or inventory_unknown then
    action:='Complete apenas as categorias fictícias necessárias; não crie uma carteira para preencher o questionário.';
    findings:=findings||jsonb_build_array(jsonb_build_object('id','inventory_incomplete','title','Inventário com lacunas','severity','medium','evidence',case when jsonb_array_length(inv)=0 then 'Nenhum item fictício informado' else 'Há rede ou custódia não informada' end,'impact','O mapa de funções está incompleto. Não foram consultados saldos, endereços ou posições.','action',action));
  end if;
  for item in select value from jsonb_array_elements(findings) loop
    if not (item->>'id'=any(ids)) then
      plan:=plan||jsonb_build_array(jsonb_build_object('priority','P1','action',item->>'action','owner','Titular, com revisão do consultor','deadline','Antes de concluir o diagnóstico','verification','Revisor confere as opções atualizadas e registra as lacunas remanescentes.'));
    end if;
  end loop;
  blocked:=v#>>'{controls,secret_exposure,answer}'='yes';
  report_status:=case when blocked then 'blocked' when jsonb_array_length(findings)>0 then 'needs_input' else 'ok' end;
  report_summary:=case when blocked then 'Foi informada exposição de segredo. Interrompa a avaliação de prontidão e encaminhe a situação para resposta humana a incidente. Não envie o segredo.' when report_status='needs_input' then 'Há respostas ou controles pendentes. O diagnóstico registra as lacunas e propõe próximos passos para revisão humana.' else 'As respostas mínimas estão preenchidas e não há pendência declarada nos itens avaliados. Isso não certifica segurança nem autoriza operações.' end;
  if jsonb_array_length(plan)=0 then plan:= $json$[{"priority":"P2","action":"Revise as respostas e o mapa fictício com outra pessoa antes de entregar o relatório.","owner":"Consultor e revisor humano","deadline":"Antes da entrega ao cliente","verification":"Aprovação e publicação da versão pelo fluxo humano do servidor."}]$json$::jsonb; end if;
  return jsonb_build_object('schema_version','cofre-report-0.1','rule_version','cofre-individual-synthetic-0.1.0','report_kind','cofre_individual','mode','synthetic','title','Diagnóstico COFRE Individual — simulação',
    'summary',report_summary,'as_of',asof,'status',report_status,
    'data_quality',jsonb_build_object('total_controls',7,'provided_controls',count_provided,'unknown_controls',7-count_provided,'declared_controls',count_declared,'observed_controls',count_observed,
      'coverage_explanation',count_provided||' de 7 controles com resposta informada. Cobertura mede preenchimento, não segurança.',
      'observed_explanation','Observado significa revisão humana declarada pelo autor. O sistema não verificou a evidência nem executou testes de carteira.',
      'profile_gaps',gaps,'financial_data','Não coletados; não há saldos, endereços ou reconciliação financeira.'),
    'profile',v->'profile','inventory',inv,'controls',controls,'findings',findings,'plan',plan,
    'limitations',$json$["Simulação declarada pelo autor; o sistema não consegue comprovar se respostas correspondem a dados reais.","Sem acesso a carteiras, consulta externa, integração paga, assinatura ou execução financeira.","Sem nota ou certificação de segurança; respostas positivas são declarações, não testes automáticos.","Não avalia rentabilidade, alocação, adequação de investimento, tributação ou sucessão.","Não envie seed, chave privada, senha, PIN, passphrase, OTP ou códigos de recuperação.","Esta análise nasce como rascunho. A situação de revisão e entrega é informada pelo servidor, fora do conteúdo deste documento."]$json$::jsonb,'alternatives',$json$["Manter a atividade pausada enquanto existirem dúvidas ou suspeita de incidente.","Fazer apenas educação e organização com categorias fictícias, sem conectar carteira.","Solicitar apoio humano especializado para lacunas fora deste questionário."]$json$::jsonb,
    'next_steps',case when blocked then $json$["Priorizar o encaminhamento humano de incidente sem compartilhar segredos.","Retomar a avaliação somente após nova revisão da situação pelo responsável humano."]$json$::jsonb else $json$["Revisar cada lacuna e confirmar as respostas com o titular.","Submeter esta versão ao revisor independente; a entrega exige publicação explícita."]$json$::jsonb end,
    'sources',jsonb_build_array(jsonb_build_object('kind','synthetic_intake','label','Respostas estruturadas fictícias fornecidas pelo autor','reference','cofre-intake-0.1','as_of',asof),jsonb_build_object('kind','internal_rules','label','Regras determinísticas COFRE Individual, sem score','reference','cofre-individual-synthetic-0.1.0','as_of',asof)),
    'human_review',$json${"required":true,"status":"pending","approved":false,"note":"Esta proposta não aprova nem publica a versão. Usar o fluxo humano de revisão e entrega."}$json$::jsonb);
end $$;
revoke all on function capital_web3_private.cofre_canonical_report(jsonb,text) from public,anon,authenticated,service_role;
create or replace function capital_web3.advisory_save_cofre_intake(p_case_id uuid,p_intake jsonb,p_content jsonb,p_expected_revision integer,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; wid uuid; req jsonb; prior capital_web3_private.cofre_actions%rowtype; rev integer; rid uuid; vid uuid; result jsonb; partial_enabled boolean;
begin
 v_actor:=capital_web3_private.require_human_identity();
 select workspace_id into wid from capital_web3_private.cofre_case_workspaces where case_id=p_case_id;
 if wid is null or not capital_web3_private.cofre_is_staff(wid,array['analyst']) or
 not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then
 raise exception 'case unavailable' using errcode='42501'; end if;
 perform 1 from capital_web3.advisory_cases where id=p_case_id for update;
 if capital_web3_private.require_human_identity()<>v_actor or not capital_web3_private.cofre_is_staff(wid,array['analyst']) or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then raise exception 'case unavailable' using errcode='42501'; end if;
 select l.partial_enabled into partial_enabled from capital_web3_private.cofre_partial_limits l where l.singleton=true for share;
 if not coalesce(partial_enabled,false)
 and exists(select 1 from capital_web3_private.cofre_partial_intakes where case_id=p_case_id) then
   raise exception 'partial progress requires reconciliation' using errcode='23514';
 end if;
 perform capital_web3_private.validate_cofre_intake(p_intake);
 -- Reconstruct every field from validated inputs and reject any caller-altered content.
 if p_content is distinct from capital_web3_private.cofre_canonical_report(p_intake,p_content->>'as_of') then
 raise exception 'report integrity mismatch' using errcode='22023'; end if;
 -- Draft authored through the product; content never grants review/publication authority.
 if p_content is null or jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>60000
 or p_content->>'report_kind' is distinct from 'cofre_individual' or p_content->>'mode' is distinct from 'synthetic'
 or p_content->>'schema_version' is distinct from 'cofre-report-0.1'
 or p_content->'profile' is distinct from p_intake->'profile'
 or (select jsonb_object_agg(c->>'id',jsonb_build_object('answer',c->'answer','evidence',c->'evidence')) from jsonb_array_elements(p_content->'controls') c) is distinct from p_intake->'controls'
 or (select coalesce(jsonb_agg(i - array['title','category_label','network_label','custody_label']::text[]),'[]'::jsonb) from jsonb_array_elements(p_content->'inventory') i) is distinct from p_intake->'inventory'
 or p_content#>'{human_review,approved}' is distinct from 'false'::jsonb then
 raise exception 'invalid draft envelope' using errcode='22023'; end if;
 if (p_content->>'status'=any(array['blocked','needs_input','ok'])) is not true
 or (p_intake#>>'{controls,secret_exposure,answer}'='yes' and p_content->>'status'<>'blocked')
 or (p_content->>'status'='ok' and (
   p_intake#>>'{controls,secret_exposure,answer}'<>'no'
   or exists(select 1 from jsonb_each(p_intake->'controls') c where c.key<>'secret_exposure' and c.value->>'answer'<>'yes')
   or p_intake#>>'{profile,liquidity}'<>'long_term'
   or p_intake#>>'{profile,loss_capacity}' in ('essential','unknown')
   or jsonb_array_length(p_intake->'inventory')=0
   or exists(select 1 from jsonb_array_elements(p_intake->'inventory') i where i->>'network'='unknown' or i->>'custody'='unknown')
 )) then raise exception 'draft status contradicts intake' using errcode='22023'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_idempotency_key is null then
 raise exception 'invalid revision' using errcode='22023'; end if;
 req:=jsonb_build_object('case',p_case_id,'intake',p_intake,'expected_revision',p_expected_revision);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||':cofre_save:'||p_idempotency_key::text,0));
 select * into prior from capital_web3_private.cofre_actions where cofre_actions.actor=v_actor and action='cofre_save' and key=p_idempotency_key;
 if found then
 if prior.request<>req then raise exception 'key conflict' using errcode='23505'; end if;
 return prior.result; end if;
 -- Retries reuse the confirmed receipt even after the window; new writes require freshness.
 if (p_content->>'as_of')::timestamptz < now() - interval '10 minutes' or (p_content->>'as_of')::timestamptz > now() + interval '2 minutes' then
  raise exception 'timestamp outside accepted window' using errcode='22023'; end if;
 select coalesce(max(revision),0) into rev from capital_web3.cofre_intakes where case_id=p_case_id;
 if rev<>p_expected_revision then raise exception 'intake changed; reload current version' using errcode='23514'; end if;
 select id into rid from capital_web3.advisory_reports where case_id=p_case_id order by created_at limit 1;
 if rid is null then insert into capital_web3.advisory_reports(case_id,created_by) values(p_case_id,v_actor) returning id into rid; end if;
 insert into capital_web3.advisory_report_versions(report_id,case_id,version_number,content,created_by)
 values(rid,p_case_id,rev+1,p_content,v_actor) returning id into vid;
 insert into capital_web3.cofre_intakes(case_id,revision,intake,report_version_id,created_by) values(p_case_id,rev+1,p_intake,vid,v_actor);
 result:=jsonb_build_object('case_id',p_case_id,'revision',rev+1,'report_version_id',vid);
 insert into capital_web3_private.cofre_actions(actor,action,key,request,result) values(v_actor,'cofre_save',p_idempotency_key,req,result);
 insert into capital_web3.advisory_audit_events(case_id,actor_user_id,action,entity_id) values(p_case_id,v_actor,'cofre_draft_created',vid);
 return result;
end $$;
commit;
