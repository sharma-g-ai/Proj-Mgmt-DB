-- Migration 0025 — reviewed-request acknowledgement (Spec 10 notification flow).
--
-- Lets a Manager-Lead see (and dismiss) that their submitted change request
-- was reviewed, since a Pending row simply disappearing from their view once
-- an Admin acts on it gave no feedback at all.

alter table public.project_change_request
  add column acknowledged_at timestamptz;

-- Lets the ORIGINAL REQUESTER acknowledge their own reviewed request, without
-- reopening pcr_update's RLS (Admin-only) to non-admins generally — mirrors
-- the existing security-definer carve-out pattern (fn_person_total_allocation_pct,
-- project_is_organizational).
create or replace function public.fn_acknowledge_change_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.project_change_request
     set acknowledged_at = now()
   where request_id = p_request
     and requested_by = auth.uid()
     and status in ('Approved', 'Rejected');
end;
$$;

grant execute on function public.fn_acknowledge_change_request(uuid) to authenticated;
