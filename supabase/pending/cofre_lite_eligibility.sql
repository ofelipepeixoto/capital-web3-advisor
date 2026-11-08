-- Candidate only. Read-only hint; review and publication RPCs enforce all rules again.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function capital_web3.advisory_lite_report_eligibility(p_report_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid; cid uuid; wid uuid; author_id uuid; snapshot_revision integer; current_revision integer;
 snapshot_epoch uuid; current_epoch uuid; enabled boolean; state text; current_status text; content_hash text;
 rev capital_web3.advisory_human_reviews%rowtype; review_state text:='pending';
 review_allowed boolean:=false; publish_allowed boolean:=false;
begin
 actor_id:=capital_web3_private.require_human_identity();
 select s.case_id,cw.workspace_id,s.intake_revision,s.release_epoch,v.created_by,v.content->>'status',v.content_sha256
 into cid,wid,snapshot_revision,snapshot_epoch,author_id,current_status,content_hash
 from capital_web3_private.cofre_lite_report_snapshots s
 join capital_web3.advisory_report_versions v on v.id=s.report_version_id and v.case_id=s.case_id
 join capital_web3_private.cofre_case_workspaces cw on cw.case_id=s.case_id
 where s.report_version_id=p_report_version_id;
 if cid is null or not capital_web3_private.cofre_is_staff(wid,array['analyst','reviewer','publisher'])
  or not capital_web3_private.is_assigned_staff(cid,array['analyst','reviewer','publisher','admin']) then
  raise exception 'report unavailable' using errcode='42501';
 end if;
 select f.enabled,f.release_epoch into enabled,current_epoch from capital_web3_private.cofre_lite_features f where f.workspace_id=wid;
 select i.revision into current_revision from capital_web3_private.cofre_lite_intakes_v02 i where i.case_id=cid;
 state:=case when enabled is distinct from true then 'feature_disabled'
             when snapshot_epoch is distinct from current_epoch then 'new_intake_required'
             when snapshot_revision is distinct from current_revision then 'stale'
             when current_status='blocked' then 'blocked'
             when current_status='incomplete' then 'incomplete'
             when current_status='requires_review' then 'ready'
             else 'unavailable' end;
 select * into rev from capital_web3.advisory_human_reviews r where r.report_version_id=p_report_version_id;
 if found then review_state:=rev.decision; end if;
 if state='ready' and author_id<>actor_id then
  review_allowed:=review_state='pending' and capital_web3_private.is_assigned_staff(cid,array['reviewer','admin']);
  publish_allowed:=review_state='approved' and rev.reviewed_content_sha256=content_hash
   and rev.reviewed_manifest_sha256=capital_web3_private.manifest_sha256(p_report_version_id)
   and capital_web3_private.is_assigned_staff(cid,array['publisher','admin']);
 end if;
 return jsonb_build_object('report_version_id',p_report_version_id,'state',state,'review_state',review_state,
  'can_review',review_allowed,'can_publish_with_valid_recipients',publish_allowed);
end $$;
revoke all on function capital_web3.advisory_lite_report_eligibility(uuid) from public,anon,authenticated,service_role;
grant execute on function capital_web3.advisory_lite_report_eligibility(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
