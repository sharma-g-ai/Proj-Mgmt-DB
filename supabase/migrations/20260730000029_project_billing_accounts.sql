-- Migration 0029 — project billing tool + account allow-list for InfraSpecs gate.
-- One tool per project via project.provider_id; multiple account numbers per project.

create table public.project_billing_account (
  account_row_id uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.project(project_id) on delete cascade,
  account_id     text not null,
  account_name   text,
  created_at     timestamptz not null default now(),
  constraint project_billing_account_nonempty check (length(trim(account_id)) > 0)
);

create unique index idx_project_billing_account_unique
  on public.project_billing_account (project_id, lower(trim(account_id)));

create index idx_project_billing_account_project
  on public.project_billing_account (project_id);

alter table public.project_billing_account enable row level security;

grant select, insert, update, delete on public.project_billing_account to authenticated;

create policy project_billing_account_select on public.project_billing_account
  for select using (public.can_view_infra(project_id));
create policy project_billing_account_insert on public.project_billing_account
  for insert with check (public.can_manage_infra());
create policy project_billing_account_update on public.project_billing_account
  for update using (public.can_manage_infra()) with check (public.can_manage_infra());
create policy project_billing_account_delete on public.project_billing_account
  for delete using (public.can_manage_infra());

-- InfraOps cannot use project_update (Admin / Manager-Lead only). Allow setting
-- provider_id only through this helper when managing infra billing setup.
create or replace function public.set_project_infra_provider(
  p_project uuid,
  p_provider uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_infra() then
    raise exception 'Not allowed to set project billing tool.';
  end if;
  if p_provider is not null and not exists (
    select 1 from public.infra_provider where provider_id = p_provider
  ) then
    raise exception 'Invalid billing tool.';
  end if;
  update public.project
  set provider_id = p_provider
  where project_id = p_project;
  if not found then
    raise exception 'Project not found.';
  end if;
end;
$$;

grant execute on function public.set_project_infra_provider(uuid, uuid) to authenticated;

comment on table public.project_billing_account is
  'Allow-listed cloud/billing account IDs for a project (one tool via project.provider_id).';

comment on column public.project_billing_account.account_name is
  'Optional display label for the account number (not used in invoice matching).';
