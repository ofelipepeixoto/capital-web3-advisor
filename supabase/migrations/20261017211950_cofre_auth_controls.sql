-- Require a second factor for Capital staff without changing shared Auth settings.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table capital_web3_private.cofre_workspaces alter column staff_mfa_required set default true;
update capital_web3_private.cofre_workspaces set staff_mfa_required=true where not staff_mfa_required;

-- A person who enrolled a verified factor must also use it when acting as client.
create function capital_web3_private.cofre_mfa_satisfied()
returns boolean language sql stable security definer set search_path='' as $$
 select auth.jwt()->>'aal'='aal2' or not exists(
  select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified');
$$;
revoke all on function capital_web3_private.cofre_mfa_satisfied() from public,anon,authenticated,service_role;

create or replace function capital_web3_private.cofre_is_staff(p_workspace uuid,p_roles text[] default array['analyst','reviewer','publisher'])
returns boolean language sql stable security definer set search_path='' as $$
 select capital_web3_private.cofre_session_active() and capital_web3_private.cofre_mfa_satisfied() and exists(
 select 1 from capital_web3_private.cofre_workspace_members m
 join capital_web3_private.cofre_workspaces w on w.id=m.workspace_id
 where m.workspace_id=p_workspace and m.user_id=auth.uid() and m.active
 and m.member_role=any(p_roles) and (not w.staff_mfa_required or auth.jwt()->>'aal'='aal2'));
$$;
create or replace function capital_web3_private.cofre_case_access(p_case uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select capital_web3_private.cofre_session_active() and capital_web3_private.cofre_mfa_satisfied() and exists(
 select 1 from capital_web3_private.cofre_case_workspaces c
 join capital_web3_private.cofre_workspace_members m on m.workspace_id=c.workspace_id
 join capital_web3_private.cofre_workspaces w on w.id=c.workspace_id
 where c.case_id=p_case and m.user_id=auth.uid() and m.active
 and (not w.staff_mfa_required or auth.jwt()->>'aal'='aal2' or not exists(
 select 1 from capital_web3_private.cofre_workspace_members staff where staff.workspace_id=c.workspace_id
 and staff.user_id=auth.uid() and staff.active and staff.member_role<>'client')));
$$;

-- Before MFA, reveal only this account's access requirement, never the roster.
create function capital_web3.advisory_access_requirements()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not capital_web3_private.cofre_session_active() then return null; end if;
 return jsonb_build_object(
  'mfa_required', exists(select 1 from capital_web3_private.cofre_workspace_members m
    join capital_web3_private.cofre_workspaces w on w.id=m.workspace_id
    where m.user_id=auth.uid() and m.active and m.member_role<>'client' and w.staff_mfa_required)
    or exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified'),
  'assurance_level', case when auth.jwt()->>'aal'='aal2' then 'aal2' else 'aal1' end);
end $$;
revoke all on function capital_web3.advisory_access_requirements() from public,anon,authenticated,service_role;
grant execute on function capital_web3.advisory_access_requirements() to authenticated;
notify pgrst,'reload schema';
commit;
