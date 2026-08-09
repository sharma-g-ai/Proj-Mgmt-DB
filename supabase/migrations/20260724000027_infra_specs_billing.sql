-- Migration 0027 — InfraSpecs + InfraBilling foundation (optimized to match core schema style).
-- Data-driven providers, ownership, resource types, invoices, lines, discrepancies.
-- Requires 0026 (InfraOps enum value) to be committed first.
-- Conventions aligned with 0001/0004+: idx_* indexes, ON UPDATE CASCADE on user FKs,
-- grant execute on RLS helpers, named CHECKs, project CASCADE deletes.

-- ---------------------------------------------------------------------------
-- 1. Managed lookups (lean, unique labels; soft-deactivate via is_active)
-- ---------------------------------------------------------------------------
create table public.infra_provider (
  provider_id uuid primary key default gen_random_uuid(),
  label       text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint infra_provider_label_unique unique (label)
);

create table public.billing_ownership_option (
  option_id  uuid primary key default gen_random_uuid(),
  label      text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_ownership_label_unique unique (label)
);

create table public.infra_resource_type (
  resource_type_id uuid primary key default gen_random_uuid(),
  label            text not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint infra_resource_type_label_unique unique (label)
);

-- Case-insensitive uniqueness for .ilike create-or-find paths
create unique index idx_infra_provider_label_lower
  on public.infra_provider (lower(label));
create unique index idx_billing_ownership_label_lower
  on public.billing_ownership_option (lower(label));
create unique index idx_infra_resource_type_label_lower
  on public.infra_resource_type (lower(label));

-- Hot path: .eq('is_active', true).order('label')
create index idx_infra_provider_active_label
  on public.infra_provider (label) where is_active;
create index idx_billing_ownership_active_label
  on public.billing_ownership_option (label) where is_active;
create index idx_infra_resource_type_active_label
  on public.infra_resource_type (label) where is_active;

create table public.infra_resource_type_attribute (
  attribute_id     uuid primary key default gen_random_uuid(),
  resource_type_id uuid not null references public.infra_resource_type(resource_type_id) on delete cascade,
  attr_key         text not null,
  label            text not null,
  data_type        text not null default 'text',
  is_required      boolean not null default false,
  sort_order       integer not null default 0,
  constraint infra_rta_data_type check (data_type in ('text', 'number', 'boolean', 'date')),
  constraint infra_rta_unique_key unique (resource_type_id, attr_key)
);

create trigger set_updated_at before update on public.infra_provider
  for each row execute function public.trg_set_updated_at();
create trigger set_updated_at before update on public.billing_ownership_option
  for each row execute function public.trg_set_updated_at();
create trigger set_updated_at before update on public.infra_resource_type
  for each row execute function public.trg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Project FKs for provider + ownership
-- ---------------------------------------------------------------------------
alter table public.project
  add column if not exists provider_id uuid references public.infra_provider(provider_id),
  add column if not exists ownership_option_id uuid references public.billing_ownership_option(option_id);

create index if not exists idx_project_provider on public.project (provider_id);
create index if not exists idx_project_ownership on public.project (ownership_option_id);

-- ---------------------------------------------------------------------------
-- 3. Infra resources (specs)
-- ---------------------------------------------------------------------------
create table public.infra_resource (
  resource_id      uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.project(project_id) on delete cascade,
  resource_type_id uuid not null references public.infra_resource_type(resource_type_id),
  name             text not null,
  external_id      text,
  attributes       jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint infra_resource_name_nonempty check (length(trim(name)) > 0)
);

create index idx_infra_resource_project on public.infra_resource (project_id);
create index idx_infra_resource_type on public.infra_resource (resource_type_id);
create index idx_infra_resource_project_name on public.infra_resource (project_id, name);
-- Unique cloud/tool IDs per project when present (billing scope matching)
create unique index idx_infra_resource_project_external
  on public.infra_resource (project_id, external_id)
  where external_id is not null and length(trim(external_id)) > 0;

create trigger set_updated_at before update on public.infra_resource
  for each row execute function public.trg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Invoice enums + table
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.infra_processing_status as enum (
    'pending', 'processing', 'parsed', 'failed'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.infra_validation_status as enum (
    'unchecked', 'valid', 'invalid', 'partial'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.infra_discrepancy_severity as enum (
    'info', 'warning', 'error'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.infra_discrepancy_status as enum (
    'open', 'acknowledged', 'resolved'
  );
exception when duplicate_object then null;
end $$;

create table public.infra_invoice (
  invoice_id           uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.project(project_id) on delete cascade,
  provider_id          uuid references public.infra_provider(provider_id),
  billing_period_start date,
  billing_period_end   date,
  invoice_number       text,
  currency             text,
  amount_total         numeric,
  storage_path         text not null,
  original_filename    text,
  mime_type            text,
  processing_status    public.infra_processing_status not null default 'pending',
  validation_status    public.infra_validation_status not null default 'unchecked',
  extracted_payload    jsonb not null default '{}'::jsonb,
  error_message        text,
  uploaded_by          uuid references public.users(user_id) on update cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint infra_invoice_period_order check (
    billing_period_end is null
    or billing_period_start is null
    or billing_period_end >= billing_period_start
  ),
  constraint infra_invoice_amount_nonneg check (
    amount_total is null or amount_total >= 0
  )
);

create index idx_infra_invoice_project on public.infra_invoice (project_id);
create index idx_infra_invoice_project_created on public.infra_invoice (project_id, created_at desc);
create index idx_infra_invoice_period on public.infra_invoice (billing_period_start, billing_period_end);
create index idx_infra_invoice_provider on public.infra_invoice (provider_id);
create index idx_infra_invoice_processing on public.infra_invoice (processing_status);
create index idx_infra_invoice_uploaded_by on public.infra_invoice (uploaded_by);

create trigger set_updated_at before update on public.infra_invoice
  for each row execute function public.trg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Invoice line items
-- ---------------------------------------------------------------------------
create table public.infra_invoice_line (
  line_id             uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.infra_invoice(invoice_id) on delete cascade,
  resource_id         uuid references public.infra_resource(resource_id) on delete set null,
  line_label          text,
  resource_type_label text,
  quantity            numeric,
  unit                text,
  unit_cost           numeric,
  amount              numeric,
  attributes          jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index idx_infra_invoice_line_invoice on public.infra_invoice_line (invoice_id);
create index idx_infra_invoice_line_resource on public.infra_invoice_line (resource_id);

-- ---------------------------------------------------------------------------
-- 6. Billing discrepancies
-- ---------------------------------------------------------------------------
create table public.infra_billing_discrepancy (
  discrepancy_id   uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references public.infra_invoice(invoice_id) on delete cascade,
  discrepancy_type text not null,
  severity         public.infra_discrepancy_severity not null default 'warning',
  message          text not null,
  expected_value   text,
  actual_value     text,
  status           public.infra_discrepancy_status not null default 'open',
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint infra_discrepancy_type_nonempty check (length(trim(discrepancy_type)) > 0)
);

create index idx_infra_discrepancy_invoice on public.infra_billing_discrepancy (invoice_id);
create index idx_infra_discrepancy_status on public.infra_billing_discrepancy (status);
create index idx_infra_discrepancy_invoice_open
  on public.infra_billing_discrepancy (invoice_id)
  where status = 'open';

create trigger set_updated_at before update on public.infra_billing_discrepancy
  for each row execute function public.trg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. project_metrics: expose provider + ownership labels
-- ---------------------------------------------------------------------------
create or replace view public.project_metrics
with (security_invoker = true) as
select
  p.project_id,
  p.project_name,
  p.stakeholder,
  p.stakeholder_description,
  p.description,
  p.project_type_id,
  pt.label                                              as project_type_label,
  p.priority,
  p.status_id,
  so.label                                              as status_label,
  p.status_detail,
  p.manager_lead_id,
  ml.full_name                                          as manager_lead_name,
  p.start_date,
  p.planned_end_date,
  p.estimated_effort_hrs,
  p.is_archived,
  public.fn_project_logged_hours(p.project_id)          as logged_hours,
  public.fn_project_pct_completion(p.project_id)        as pct_completion,
  public.fn_project_pending_hours(p.project_id)         as pending_hours,
  public.fn_project_pending_pct(p.project_id)           as pending_pct,
  public.fn_project_planned_hours(p.project_id)         as planned_hours,
  public.fn_working_days(current_date, p.planned_end_date) as working_days_remaining,
  case
    when p.estimated_effort_hrs = 0 then null
    else public.fn_project_planned_hours(p.project_id) / p.estimated_effort_hrs * 100
  end                                                   as allocation_pct,
  p.jira_url,
  p.drive_url,
  p.is_organizational,
  p.provider_id,
  ip.label                                              as provider_label,
  p.ownership_option_id,
  bo.label                                              as ownership_label
from public.project p
left join public.project_type_option pt on pt.option_id = p.project_type_id
left join public.status_option        so on so.option_id = p.status_id
left join public.users                ml on ml.user_id   = p.manager_lead_id
left join public.infra_provider       ip on ip.provider_id = p.provider_id
left join public.billing_ownership_option bo on bo.option_id = p.ownership_option_id;

grant select on public.project_metrics to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_infraops()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where user_id = auth.uid() and role = 'InfraOps' and is_active = true
  );
$$;

create or replace function public.can_manage_infra()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or public.is_infraops();
$$;

create or replace function public.can_view_infra(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_infra()
      or public.leads_project(p_project);
$$;

grant execute on function public.is_infraops() to authenticated;
grant execute on function public.can_manage_infra() to authenticated;
grant execute on function public.can_view_infra(uuid) to authenticated;

-- InfraOps must see all projects (org-wide infra scope), not only led ones.
drop policy if exists project_select on public.project;
create policy project_select on public.project
  for select
  using (
    public.is_admin()
    or public.is_infraops()
    or (public.is_active_user() and manager_lead_id = auth.uid())
    or (public.is_active_user() and is_organizational)
  );

-- ---------------------------------------------------------------------------
-- 9. Enable RLS + policies
-- ---------------------------------------------------------------------------
alter table public.infra_provider enable row level security;
alter table public.billing_ownership_option enable row level security;
alter table public.infra_resource_type enable row level security;
alter table public.infra_resource_type_attribute enable row level security;
alter table public.infra_resource enable row level security;
alter table public.infra_invoice enable row level security;
alter table public.infra_invoice_line enable row level security;
alter table public.infra_billing_discrepancy enable row level security;

grant select, insert, update, delete on public.infra_provider to authenticated;
grant select, insert, update, delete on public.billing_ownership_option to authenticated;
grant select, insert, update, delete on public.infra_resource_type to authenticated;
grant select, insert, update, delete on public.infra_resource_type_attribute to authenticated;
grant select, insert, update, delete on public.infra_resource to authenticated;
grant select, insert, update, delete on public.infra_invoice to authenticated;
grant select, insert, update, delete on public.infra_invoice_line to authenticated;
grant select, insert, update, delete on public.infra_billing_discrepancy to authenticated;

create policy infra_provider_select on public.infra_provider
  for select using (public.is_active_user());
create policy infra_provider_insert on public.infra_provider
  for insert with check (public.can_manage_infra());
create policy infra_provider_update on public.infra_provider
  for update using (public.can_manage_infra()) with check (public.can_manage_infra());
create policy infra_provider_delete on public.infra_provider
  for delete using (public.can_manage_infra());

create policy billing_ownership_select on public.billing_ownership_option
  for select using (public.is_active_user());
create policy billing_ownership_insert on public.billing_ownership_option
  for insert with check (public.is_admin());
create policy billing_ownership_update on public.billing_ownership_option
  for update using (public.is_admin()) with check (public.is_admin());
create policy billing_ownership_delete on public.billing_ownership_option
  for delete using (public.is_admin());

create policy infra_resource_type_select on public.infra_resource_type
  for select using (public.is_active_user());
create policy infra_resource_type_insert on public.infra_resource_type
  for insert with check (public.can_manage_infra());
create policy infra_resource_type_update on public.infra_resource_type
  for update using (public.can_manage_infra()) with check (public.can_manage_infra());
create policy infra_resource_type_delete on public.infra_resource_type
  for delete using (public.can_manage_infra());

create policy infra_rta_select on public.infra_resource_type_attribute
  for select using (public.is_active_user());
create policy infra_rta_insert on public.infra_resource_type_attribute
  for insert with check (public.can_manage_infra());
create policy infra_rta_update on public.infra_resource_type_attribute
  for update using (public.can_manage_infra()) with check (public.can_manage_infra());
create policy infra_rta_delete on public.infra_resource_type_attribute
  for delete using (public.can_manage_infra());

create policy infra_resource_select on public.infra_resource
  for select using (public.can_view_infra(project_id));
create policy infra_resource_insert on public.infra_resource
  for insert with check (public.can_manage_infra());
create policy infra_resource_update on public.infra_resource
  for update using (public.can_manage_infra()) with check (public.can_manage_infra());
create policy infra_resource_delete on public.infra_resource
  for delete using (public.can_manage_infra());

create policy infra_invoice_select on public.infra_invoice
  for select using (public.can_view_infra(project_id));
create policy infra_invoice_insert on public.infra_invoice
  for insert with check (public.can_manage_infra());
create policy infra_invoice_update on public.infra_invoice
  for update using (public.can_manage_infra()) with check (public.can_manage_infra());
create policy infra_invoice_delete on public.infra_invoice
  for delete using (public.can_manage_infra());

create policy infra_invoice_line_select on public.infra_invoice_line
  for select using (
    exists (
      select 1 from public.infra_invoice i
      where i.invoice_id = infra_invoice_line.invoice_id
        and public.can_view_infra(i.project_id)
    )
  );
create policy infra_invoice_line_insert on public.infra_invoice_line
  for insert with check (public.can_manage_infra());
create policy infra_invoice_line_update on public.infra_invoice_line
  for update using (public.can_manage_infra()) with check (public.can_manage_infra());
create policy infra_invoice_line_delete on public.infra_invoice_line
  for delete using (public.can_manage_infra());

create policy infra_discrepancy_select on public.infra_billing_discrepancy
  for select using (
    exists (
      select 1 from public.infra_invoice i
      where i.invoice_id = infra_billing_discrepancy.invoice_id
        and public.can_view_infra(i.project_id)
    )
  );
create policy infra_discrepancy_insert on public.infra_billing_discrepancy
  for insert with check (public.can_manage_infra());
create policy infra_discrepancy_update on public.infra_billing_discrepancy
  for update using (public.can_manage_infra()) with check (public.can_manage_infra());
create policy infra_discrepancy_delete on public.infra_billing_discrepancy
  for delete using (public.can_manage_infra());

-- ---------------------------------------------------------------------------
-- 10. Storage bucket (private). Path: {project_id}/{invoice_id}/{filename}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'infra-invoices',
  'infra-invoices',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do nothing;

drop policy if exists infra_invoices_storage_select on storage.objects;
drop policy if exists infra_invoices_storage_insert on storage.objects;
drop policy if exists infra_invoices_storage_update on storage.objects;
drop policy if exists infra_invoices_storage_delete on storage.objects;

create policy infra_invoices_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'infra-invoices'
    and public.can_view_infra((split_part(name, '/', 1))::uuid)
  );

create policy infra_invoices_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'infra-invoices'
    and public.can_manage_infra()
    and public.can_view_infra((split_part(name, '/', 1))::uuid)
  );

create policy infra_invoices_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'infra-invoices'
    and public.can_manage_infra()
    and public.can_view_infra((split_part(name, '/', 1))::uuid)
  )
  with check (
    bucket_id = 'infra-invoices'
    and public.can_manage_infra()
    and public.can_view_infra((split_part(name, '/', 1))::uuid)
  );

create policy infra_invoices_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'infra-invoices'
    and public.can_manage_infra()
    and public.can_view_infra((split_part(name, '/', 1))::uuid)
  );

comment on table public.infra_resource is
  'Per-project InfraSpecs inventory (cloud instances, SaaS seats, etc.).';
comment on table public.infra_invoice is
  'Uploaded billing invoices per project; lines + discrepancies hang off this.';
comment on column public.infra_resource.attributes is
  'Type-specific fields (region, seats, instance_type, …) as JSONB.';
comment on column public.infra_invoice.storage_path is
  'Object path in infra-invoices bucket: {project_id}/{invoice_id}/{filename}';
