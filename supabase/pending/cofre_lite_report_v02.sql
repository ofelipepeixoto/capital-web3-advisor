-- Candidate only. Apply after cofre_lite_intake_v02 and canonical report.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create function capital_web3_private.cofre_lite_canonical_report(v jsonb)
returns jsonb language plpgsql immutable security definer set search_path='' as $$
declare
 details constant jsonb := $json${"backup":["Backup","Revise a existência e proteção do backup com o titular, sem solicitar seu conteúdo."],"vault":["Função de reserva","Revise uma separação proporcional entre reserva e uso."],"apps":["Função para aplicativos","Revise uma função apropriada para uso de aplicativos."],"spending":["Função para gastos","Revise uma função para gastos conforme a necessidade."],"testing":["Função de teste","Considere se uma função separada para teste se aplica."],"watch":["Função de observação","Considere se uma função somente de observação se aplica."],"recovery":["Recuperação","Planeje revisão da recuperação com o titular em ambiente adequado, sem solicitar segredos."],"secret_exposure":["Exposição de segredo","Interrompa novas interações e procure apoio de resposta a incidentes por canal conhecido. Não envie segredos."],"source":["Conferência de origem","Confira origem, domínio, rede e destino antes de qualquer interação."],"permissions":["Revisão de permissões","Liste as permissões para revisão humana. Este portal não revoga permissões."],"payload":["Compreensão da assinatura","Interrompa se o efeito da assinatura não estiver claro e peça revisão."],"routine":["Rotina de revisão","Combine uma rotina de revisão e responsáveis. Este portal não monitora automaticamente."]}$json$::jsonb;
 labels constant jsonb := $json${"urgency":"Pressão de urgência","guaranteed_return":"Promessa de retorno garantido","unsolicited_link":"Link não solicitado","different_domain":"Domínio diferente","unverified_contract":"Contrato não verificado","unlimited_approval":"Permissão ilimitada","secret_request":"Pedido de segredo","missing_team_docs":"Documentação insuficiente","unclear_tokenomics":"Regras de token pouco claras","profit_screenshots":"Prints ou depoimentos de lucro"}$json$::jsonb;
 controls_ids text[]:=array['backup','vault','apps','spending','testing','watch','recovery','secret_exposure','source','permissions','payload','routine'];
 signal_ids text[]:=array['urgency','guaranteed_return','unsolicited_link','different_domain','unverified_contract','unlimited_approval','secret_request','missing_team_docs','unclear_tokenomics','profit_screenshots'];
 critical_ids text[]:=array['guaranteed_return','unsolicited_link','different_domain','secret_request'];
 id text; answer text; evidence text; is_critical boolean:=false;
 flagged integer:=0; critical integer:=0; unknown integer:=0; not_app integer:=0; applicable integer;
 signal_status text; status text; controls jsonb:='[]'; findings jsonb:='[]'; gaps jsonb:='[]'; plan jsonb:='[]'; assessment jsonb;
begin
 perform capital_web3_private.validate_lite_intake_v02(v);
 if v#>>'{profile,experience}'='unknown' then gaps:=gaps||jsonb_build_array('profile.experience'); end if;
 foreach id in array controls_ids loop
  answer:=v#>>array['controls',id];
  if answer='unknown' then gaps:=gaps||jsonb_build_array('controls.'||id); end if;
  evidence:=case answer when 'unknown' then 'unknown' when 'not_applicable' then 'not_applicable' else 'declared' end;
  controls:=controls||jsonb_build_array(jsonb_build_object('id',id,'label',details->id->>0,'answer',answer,'evidence',evidence,'limitation','A resposta não é uma verificação independente.'));
 end loop;
 foreach id in array signal_ids loop
  answer:=v#>>array['signals',id];
  if answer='unknown' then unknown:=unknown+1; gaps:=gaps||jsonb_build_array('signals.'||id); end if;
  if answer='not_applicable' then not_app:=not_app+1; end if;
  if answer='yes' then flagged:=flagged+1; if id=any(critical_ids) then critical:=critical+1; end if; end if;
 end loop;
 applicable:=10-not_app;
 if applicable=0 then gaps:=gaps||jsonb_build_array('signals.applicability'); end if;
 signal_status:=case when critical>0 then 'blocked' when flagged>=3 then 'pause_and_investigate' when flagged>0 then 'review_signals' when unknown>0 or applicable=0 then 'incomplete' else 'no_signal_reported' end;
 assessment:=jsonb_build_object('status',signal_status,'critical_signals',critical,'flagged_signals',flagged,'unknown',unknown,'not_applicable',not_app,'applicable',applicable,'assessed',applicable-unknown,'scope','declared_only','safety_guarantee',false);
 is_critical:=v#>>'{controls,secret_exposure}'='yes' or critical>0;
 if v#>>'{controls,secret_exposure}'='yes' then
  findings:=findings||jsonb_build_array(jsonb_build_object('id','secret_exposure','severity','critical','evidence','Exposição de segredo informada na simulação.','impact','Um segredo exposto pode permitir acesso indevido.','action',details->'secret_exposure'->>1));
 end if;
 foreach id in array signal_ids loop
  if v#>>array['signals',id]='yes' then
   findings:=findings||jsonb_build_array(jsonb_build_object('id','signal.'||id,'severity',case when id=any(critical_ids) then 'critical' else 'attention' end,'evidence',(labels->>id)||' informado na simulação.','impact','O sinal exige revisão do contexto e pode indicar risco.','action','Pause a interação e peça revisão por um canal conhecido.'));
  end if;
 end loop;
 foreach id in array controls_ids loop
  if id<>all(array['secret_exposure','testing','watch']) and v#>>array['controls',id]='no' then
   findings:=findings||jsonb_build_array(jsonb_build_object('id','control.'||id,'severity','attention','evidence',(details->id->>0)||': resposta negativa declarada.','impact','O controle precisa de revisão proporcional ao contexto.','action',details->id->>1));
  end if;
 end loop;
 if is_critical then plan:=plan||jsonb_build_array(jsonb_build_object('priority','critical','action','Interrompa a interação e procure apoio humano por canal conhecido. Não informe segredos.')); end if;
 if jsonb_array_length(gaps)>0 then plan:=plan||jsonb_build_array(jsonb_build_object('priority','review','action','Revise as informações ainda não avaliadas antes de concluir o diagnóstico.')); end if;
 if exists(select 1 from jsonb_array_elements(findings) f where f->>'severity'='attention') then plan:=plan||jsonb_build_array(jsonb_build_object('priority','review','action','Revise os pontos relatados e confirme as evidências com a equipe.')); end if;
 plan:=plan||jsonb_build_array(jsonb_build_object('priority','review','action','Uma pessoa revisora deve conferir a versão antes de qualquer entrega.'));
 status:=case when is_critical then 'blocked' when jsonb_array_length(gaps)>0 then 'incomplete' else 'requires_review' end;
 return jsonb_build_object('report_kind','cofre_lite','schema_version','cofre-lite-report-0.2','mode','synthetic',
  'status',status,'profile',v->'profile','controls',controls,'signals',jsonb_build_object('answers',v->'signals','assessment',assessment),
  'findings',findings,'gaps',gaps,'plan',plan,'limitations',jsonb_build_array('Somente dados fictícios; sem consulta externa ou verificação automática.','Informações declaradas não comprovam segurança, custódia, controle ou revogação de permissões.','Nenhuma pontuação está disponível enquanto a metodologia não for aprovada.','Este rascunho não realiza movimentação, assinatura ou recomendação de investimento.'),
  'score',null,'human_review',jsonb_build_object('status','pending','approved',false));
end $$;
revoke all on function capital_web3_private.cofre_lite_canonical_report(jsonb) from public,anon,authenticated,service_role;

-- Dedicated report identity avoids sharing the Individual report's version counter.
create table capital_web3_private.cofre_lite_report_registry (
 case_id uuid primary key references capital_web3.advisory_cases(id),
 report_id uuid not null unique references capital_web3.advisory_reports(id)
);
create table capital_web3_private.cofre_lite_report_snapshots (
 case_id uuid not null references capital_web3.advisory_cases(id),
 intake_revision integer not null check(intake_revision>0),
 intake jsonb not null check(jsonb_typeof(intake)='object' and octet_length(intake::text)<=6000),
 report_version_id uuid not null unique references capital_web3.advisory_report_versions(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 primary key(case_id,intake_revision)
);
create table capital_web3_private.cofre_lite_report_receipts (
 actor uuid not null references auth.users(id),
 key uuid not null,
 request_hash text not null check(length(request_hash)=64),
 result jsonb not null,
 created_at timestamptz not null default now(),
 retain_until timestamptz not null,
 primary key(actor,key)
);
alter table capital_web3_private.cofre_lite_report_registry enable row level security;
alter table capital_web3_private.cofre_lite_report_registry force row level security;
alter table capital_web3_private.cofre_lite_report_snapshots enable row level security;
alter table capital_web3_private.cofre_lite_report_snapshots force row level security;
alter table capital_web3_private.cofre_lite_report_receipts enable row level security;
alter table capital_web3_private.cofre_lite_report_receipts force row level security;
revoke all on capital_web3_private.cofre_lite_report_registry,capital_web3_private.cofre_lite_report_snapshots,capital_web3_private.cofre_lite_report_receipts from public,anon,authenticated,service_role;
create trigger lite_snapshot_immutable before update or delete on capital_web3_private.cofre_lite_report_snapshots for each row execute function capital_web3_private.reject_mutation();
create trigger lite_registry_immutable before update or delete on capital_web3_private.cofre_lite_report_registry for each row execute function capital_web3_private.reject_mutation();
create function capital_web3_private.protect_lite_report_version()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from capital_web3_private.cofre_lite_report_snapshots where report_version_id=old.id) then
  raise exception 'Lite draft version is immutable' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function capital_web3_private.protect_lite_report_version() from public,anon,authenticated,service_role;
create trigger lite_version_immutable before update or delete on capital_web3.advisory_report_versions for each row execute function capital_web3_private.protect_lite_report_version();

-- Lite review and publication require the latest complete synthetic snapshot.
-- The case row serializes this gate against intake saves and prevents a stale
-- snapshot becoming approved while a newer answer is committed.
create function capital_web3_private.guard_lite_review_and_publication()
returns trigger language plpgsql security definer set search_path='' as $$
declare snapshot_revision integer; current_revision integer; report_status text; requires_complete boolean;
begin
 select intake_revision into snapshot_revision from capital_web3_private.cofre_lite_report_snapshots
  where report_version_id=new.report_version_id and case_id=new.case_id;
 if not found then return new; end if;
 perform 1 from capital_web3.advisory_cases where id=new.case_id for update;
 select revision into current_revision from capital_web3_private.cofre_lite_intakes_v02 where case_id=new.case_id;
 select content->>'status' into report_status from capital_web3.advisory_report_versions where id=new.report_version_id;
 if tg_table_name='advisory_publications' then requires_complete:=true; else requires_complete:=new.decision='approved'; end if;
 if requires_complete then
  if snapshot_revision is distinct from current_revision or report_status is distinct from 'requires_review' then
   raise exception 'Lite version is incomplete, blocked or out of date' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
revoke all on function capital_web3_private.guard_lite_review_and_publication() from public,anon,authenticated,service_role;
create trigger lite_review_gate before insert on capital_web3.advisory_human_reviews for each row execute function capital_web3_private.guard_lite_review_and_publication();
create trigger lite_publication_gate before insert on capital_web3.advisory_publications for each row execute function capital_web3_private.guard_lite_review_and_publication();

create function capital_web3_private.lock_lite_release(p_version uuid,p_roles text[],p_recipients uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid; cid uuid; wid uuid; snapshot_rev integer; current_rev integer; state text; author uuid;
begin
 -- A missing or foreign version is still handled by original authorization below.
 -- Lite's report row and snapshot become visible atomically at commit.
 select s.case_id into cid from capital_web3_private.cofre_lite_report_snapshots s where s.report_version_id=p_version;
 if cid is null then return; end if;
 v_actor:=capital_web3_private.require_human_identity();
 -- First take the common case lock. 0.2 saves and draft creation use it too.
 perform 1 from capital_web3.advisory_cases where id=cid for update;
 select cw.workspace_id into wid from capital_web3_private.cofre_case_workspaces cw where cw.case_id=cid for share;
 if wid is null then raise exception 'report unavailable' using errcode='42501'; end if;
 perform 1 from capital_web3_private.cofre_lite_features where workspace_id=wid and enabled for share;
 if not found then raise exception 'report unavailable' using errcode='42501'; end if;
 perform 1 from capital_web3_private.cofre_workspaces where id=wid for share;
 perform 1 from capital_web3_private.cofre_workspace_members m where m.workspace_id=wid and m.user_id=v_actor and m.active and m.member_role=any(p_roles) order by m.member_role for share;
 if p_recipients is not null then
  if cardinality(p_recipients) not between 1 and 100 or array_position(p_recipients,null) is not null then
   raise exception 'invalid recipients' using errcode='22023';
  end if;
  perform 1 from capital_web3_private.cofre_workspace_members m where m.workspace_id=wid and m.user_id=any(p_recipients) and m.member_role='client' and m.active order by m.user_id for share;
  if (select count(*) from capital_web3_private.cofre_workspace_members m where m.workspace_id=wid and m.user_id=any(p_recipients) and m.member_role='client' and m.active) <> cardinality(p_recipients) then
   raise exception 'report unavailable' using errcode='42501';
  end if;
 end if;
 perform 1 from capital_web3.advisory_case_staff s where s.case_id=cid and s.user_id=v_actor and s.active and s.staff_role=any(p_roles) order by s.staff_role for share;
 perform 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=v_actor for share;
 if not found or capital_web3_private.require_human_identity() is distinct from v_actor
    or not capital_web3_private.cofre_is_staff(wid,p_roles)
    or not capital_web3_private.is_assigned_staff(cid,p_roles)
 then raise exception 'report unavailable' using errcode='42501'; end if;
 -- Lock and reread version only after case and authorization locks.
 select v.content->>'status',v.created_by into state,author from capital_web3.advisory_report_versions v
  where v.id=p_version and v.case_id=cid for update;
 if not found or author=v_actor then raise exception 'report unavailable' using errcode='42501'; end if;
 select s.intake_revision into snapshot_rev from capital_web3_private.cofre_lite_report_snapshots s
  where s.report_version_id=p_version and s.case_id=cid;
 select i.revision into current_rev from capital_web3_private.cofre_lite_intakes_v02 i where i.case_id=cid;
 if snapshot_rev is null or current_rev is distinct from snapshot_rev or state is distinct from 'requires_review' then
   raise exception 'Lite report outdated or not ready' using errcode='23514';
 end if;
end $$;
revoke all on function capital_web3_private.lock_lite_release(uuid,text[],uuid[]) from public,anon,authenticated,service_role;


-- Wrappers lock the Lite authorization chain before the existing report lock.
-- Other report types retain the existing behavior. The renamed functions are
-- not executable by clients, preventing an unguarded direct RPC bypass.
alter function capital_web3.advisory_review_report(uuid,text,text,text,text,uuid) rename to advisory_review_report_unguarded;
alter function capital_web3.advisory_publish_report(uuid,uuid[],text,text,timestamptz,uuid) rename to advisory_publish_report_unguarded;
revoke all on function capital_web3.advisory_review_report_unguarded(uuid,text,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function capital_web3.advisory_publish_report_unguarded(uuid,uuid[],text,text,timestamptz,uuid) from public,anon,authenticated,service_role;
create function capital_web3.advisory_review_report(p_report_version_id uuid,p_decision text,p_expected_content_sha256 text,p_expected_manifest_sha256 text,p_private_notes text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform capital_web3_private.lock_lite_release(p_report_version_id,array['reviewer','admin'],null);
 return capital_web3.advisory_review_report_unguarded(p_report_version_id,p_decision,p_expected_content_sha256,p_expected_manifest_sha256,p_private_notes,p_idempotency_key);
end $$;
create function capital_web3.advisory_publish_report(p_report_version_id uuid,p_recipient_user_ids uuid[],p_expected_content_sha256 text,p_expected_manifest_sha256 text,p_expires_at timestamptz,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform capital_web3_private.lock_lite_release(p_report_version_id,array['publisher','admin'],p_recipient_user_ids);
 return capital_web3.advisory_publish_report_unguarded(p_report_version_id,p_recipient_user_ids,p_expected_content_sha256,p_expected_manifest_sha256,p_expires_at,p_idempotency_key);
end $$;
revoke all on function capital_web3.advisory_review_report(uuid,text,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function capital_web3.advisory_publish_report(uuid,uuid[],text,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function capital_web3.advisory_review_report(uuid,text,text,text,text,uuid) to authenticated;
grant execute on function capital_web3.advisory_publish_report(uuid,uuid[],text,text,timestamptz,uuid) to authenticated;

-- This RPC receives only the expected revision and an idempotency key. It never
-- accepts report content from the caller. Existing review/publication RPCs still
-- enforce reviewer separation and version-bound hashes.
create function capital_web3.advisory_lite_create_draft(p_case_id uuid,p_expected_revision integer,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; wid uuid; r integer; data jsonb; rid uuid; vid uuid; next_version integer;
 request_hash text; old capital_web3_private.cofre_lite_report_receipts%rowtype; result jsonb;
 quota integer; retention integer;
begin
 v_actor:=capital_web3_private.require_human_identity();
 select workspace_id into wid from capital_web3_private.cofre_case_workspaces where case_id=p_case_id;
 if wid is null or not exists(select 1 from capital_web3_private.cofre_lite_features f where f.workspace_id=wid and f.enabled)
  or not capital_web3_private.cofre_is_staff(wid,array['analyst'])
  or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then raise exception 'case unavailable' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<1 or p_idempotency_key is null then raise exception 'invalid revision' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||':lite-draft-actor',0));
 perform 1 from capital_web3.advisory_cases where id=p_case_id for update;
 perform 1 from capital_web3_private.cofre_case_workspaces where case_id=p_case_id and workspace_id=wid for share;
 if not found then raise exception 'case unavailable' using errcode='42501'; end if;
 perform 1 from capital_web3_private.cofre_lite_features where workspace_id=wid and enabled for share;
 if not found then raise exception 'case unavailable' using errcode='42501'; end if;
 perform 1 from capital_web3_private.cofre_workspaces where id=wid for share;
 perform 1 from capital_web3_private.cofre_workspace_members where workspace_id=wid and user_id=v_actor and member_role='analyst' and active for share;
 perform 1 from capital_web3.advisory_case_staff where case_id=p_case_id and user_id=v_actor and staff_role in ('analyst','admin') and active order by staff_role for share;
 perform 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=v_actor for share;
 if not found or capital_web3_private.require_human_identity() is distinct from v_actor
  or not capital_web3_private.cofre_is_staff(wid,array['analyst'])
  or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then raise exception 'case unavailable' using errcode='42501'; end if;
 request_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('case',p_case_id,'revision',p_expected_revision)::text,'UTF8')),'hex');
 select * into old from capital_web3_private.cofre_lite_report_receipts x where x.actor=v_actor and x.key=p_idempotency_key;
 if found then if old.request_hash<>request_hash then raise exception 'key conflict' using errcode='23505'; end if; return old.result; end if;
 select max_receipts_per_actor,minimum_retention_days into strict quota,retention from capital_web3_private.cofre_lite_intake_policy_v02 where singleton for share;
 if (select count(*) from capital_web3_private.cofre_lite_report_receipts x where x.actor=v_actor)>=quota then raise exception 'receipt limit reached' using errcode='54000'; end if;
 select revision,intake into r,data from capital_web3_private.cofre_lite_intakes_v02 where case_id=p_case_id;
 if r is distinct from p_expected_revision then raise exception 'lite changed' using errcode='23514'; end if;
 select report_version_id into vid from capital_web3_private.cofre_lite_report_snapshots where case_id=p_case_id and intake_revision=r;
 if vid is null then
  select report_id into rid from capital_web3_private.cofre_lite_report_registry where case_id=p_case_id;
  if rid is null then
   insert into capital_web3.advisory_reports(case_id,created_by) values(p_case_id,v_actor) returning id into rid;
   insert into capital_web3_private.cofre_lite_report_registry(case_id,report_id) values(p_case_id,rid);
  end if;
  select coalesce(max(version_number),0)+1 into next_version from capital_web3.advisory_report_versions where report_id=rid;
  insert into capital_web3.advisory_report_versions(report_id,case_id,version_number,content,created_by)
   values(rid,p_case_id,next_version,capital_web3_private.cofre_lite_canonical_report(data),v_actor) returning id into vid;
  insert into capital_web3_private.cofre_lite_report_snapshots(case_id,intake_revision,intake,report_version_id,created_by) values(p_case_id,r,data,vid,v_actor);
  insert into capital_web3.advisory_audit_events(case_id,actor_user_id,action,entity_id) values(p_case_id,v_actor,'cofre_lite_draft_created',vid);
 end if;
 result:=jsonb_build_object('case_id',p_case_id,'intake_revision',r,'report_version_id',vid);
 insert into capital_web3_private.cofre_lite_report_receipts(actor,key,request_hash,result,retain_until) values(v_actor,p_idempotency_key,request_hash,result,now()+pg_catalog.make_interval(days=>retention));
 return result;
end $$;
revoke all on function capital_web3.advisory_lite_create_draft(uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function capital_web3.advisory_lite_create_draft(uuid,integer,uuid) to authenticated;

-- Keep Individual report identity separate even if Lite creates its report first.
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
 select ar.id into rid from capital_web3.advisory_reports ar where ar.case_id=p_case_id and not exists (select 1 from capital_web3_private.cofre_lite_report_registry lr where lr.report_id=ar.id) order by ar.created_at,ar.id limit 1;
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
