-- Optional account allow-list enforcement on project billing.
-- When false (default): uploads are not restricted by account number.
-- When true: invoices must match allow-listed accounts or they are rejected.

alter table public.project
  add column if not exists enforce_billing_accounts boolean not null default false;

comment on column public.project.enforce_billing_accounts is
  'When true, invoice extracted account_id must match project_billing_account allow-list or upload is rejected.';
