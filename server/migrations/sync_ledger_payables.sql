create or replace function sync_payables_with_ledger() returns trigger as $$
begin
  if new.type = '收入' then
    update payables
      set paid = least(coalesce(paid, 0) + new.amount, amount),
          settled = (least(coalesce(paid, 0) + new.amount, amount) >= amount),
          history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'date', coalesce(new.date_time, new.date, ''),
              'user', coalesce(new.created_by, ''),
              'kind', '收款',
              'amount', new.amount,
              'partner', new.client,
              'doc', new.doc,
              'notes', coalesce(new.notes, ''),
              'method', coalesce(new.method, '')
            )
          )
    where doc = new.doc and type = '应收账款';
  elsif new.type in ('支出', '开支') then
    update payables
      set paid = least(coalesce(paid, 0) + new.amount, amount),
          settled = (least(coalesce(paid, 0) + new.amount, amount) >= amount),
          history = coalesce(history, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'date', coalesce(new.date_time, new.date, ''),
              'user', coalesce(new.created_by, ''),
              'kind', '付款',
              'amount', new.amount,
              'partner', new.client,
              'doc', new.doc,
              'notes', coalesce(new.notes, ''),
              'method', coalesce(new.method, '')
            )
          )
    where doc = new.doc and type = '应付账款';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_payables on ledger;
create trigger trg_sync_payables
after insert on ledger
for each row execute function sync_payables_with_ledger();
