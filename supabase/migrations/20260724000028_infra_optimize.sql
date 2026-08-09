-- Migration 0028 — Optimize InfraSpecs/InfraBilling to match core DB conventions.
-- Safe/idempotent for DBs that already applied an older 0027.
-- Fresh installs that use the updated 0027 already have these; IF NOT EXISTS no-ops.

-- ---------------------------------------------------------------------------
-- Indexes (idx_* naming + real query paths)
-- ---------------------------------------------------------------------------
create index if not exists idx_project_provider on public.project (provider_id);
create index if not exists idx_project_ownership on public.project (ownership_option_id);

create index if not exists idx_infra_provider_active_label
  on public.infra_provider (label) where is_active;
create index if not exists idx_billing_ownership_active_label
  on public.billing_ownership_option (label) where is_active;
create index if not exists idx_infra_resource_type_active_label
  on public.infra_resource_type (label) where is_active;

create unique index if not exists idx_infra_provider_label_lower
  on public.infra_provider (lower(label));
create unique index if not exists idx_billing_ownership_label_lower
  on public.billing_ownership_option (lower(label));
create unique index if not exists idx_infra_resource_type_label_lower
  on public.infra_resource_type (lower(label));

create index if not exists idx_infra_resource_project on public.infra_resource (project_id);
create index if not exists idx_infra_resource_type on public.infra_resource (resource_type_id);
create index if not exists idx_infra_resource_project_name on public.infra_resource (project_id, name);
create unique index if not exists idx_infra_resource_project_external
  on public.infra_resource (project_id, external_id)
  where external_id is not null and length(trim(external_id)) > 0;

create index if not exists idx_infra_invoice_project on public.infra_invoice (project_id);
create index if not exists idx_infra_invoice_project_created on public.infra_invoice (project_id, created_at desc);
create index if not exists idx_infra_invoice_period on public.infra_invoice (billing_period_start, billing_period_end);
create index if not exists idx_infra_invoice_provider on public.infra_invoice (provider_id);
create index if not exists idx_infra_invoice_processing on public.infra_invoice (processing_status);
create index if not exists idx_infra_invoice_uploaded_by on public.infra_invoice (uploaded_by);

create index if not exists idx_infra_invoice_line_invoice on public.infra_invoice_line (invoice_id);
create index if not exists idx_infra_invoice_line_resource on public.infra_invoice_line (resource_id);

create index if not exists idx_infra_discrepancy_invoice on public.infra_billing_discrepancy (invoice_id);
create index if not exists idx_infra_discrepancy_status on public.infra_billing_discrepancy (status);
create index if not exists idx_infra_discrepancy_invoice_open
  on public.infra_billing_discrepancy (invoice_id)
  where status = 'open';

-- Drop legacy non-idx_* names from early 0027 (if present)
drop index if exists public.infra_resource_project_idx;
drop index if exists public.infra_invoice_project_idx;
drop index if exists public.infra_invoice_period_idx;
drop index if exists public.infra_invoice_line_invoice_idx;
drop index if exists public.infra_discrepancy_invoice_idx;

-- ---------------------------------------------------------------------------
-- Integrity helpers
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.infra_resource
    add constraint infra_resource_name_nonempty check (length(trim(name)) > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.infra_invoice
    add constraint infra_invoice_amount_nonneg check (amount_total is null or amount_total >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.infra_billing_discrepancy
    add constraint infra_discrepancy_type_nonempty check (length(trim(discrepancy_type)) > 0);
exception when duplicate_object then null;
end $$;

-- uploaded_by: align with other user FKs (ON UPDATE CASCADE)
do $$ begin
  alter table public.infra_invoice drop constraint if exists infra_invoice_uploaded_by_fkey;
  alter table public.infra_invoice
    add constraint infra_invoice_uploaded_by_fkey
    foreign key (uploaded_by) references public.users(user_id) on update cascade;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- Grants on RLS helpers (match 0004 style)
-- ---------------------------------------------------------------------------
grant execute on function public.is_infraops() to authenticated;
grant execute on function public.can_manage_infra() to authenticated;
grant execute on function public.can_view_infra(uuid) to authenticated;

-- Tighten storage write path to include project-scoped can_view_infra
drop policy if exists infra_invoices_storage_insert on storage.objects;
create policy infra_invoices_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'infra-invoices'
    and public.can_manage_infra()
    and public.can_view_infra((split_part(name, '/', 1))::uuid)
  );

drop policy if exists infra_invoices_storage_update on storage.objects;
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

drop policy if exists infra_invoices_storage_delete on storage.objects;
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
