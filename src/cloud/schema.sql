create table if not exists machines (
  machine_id text primary key,
  label text,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now()
);

create table if not exists scans (
  id bigserial primary key,
  barcode text not null,
  scanned_at timestamp not null,
  source text not null default 'global-listener',
  note text,
  machine_id text not null references machines(machine_id),
  imported_from text,
  created_at timestamptz not null default now(),
  unique(machine_id, barcode, scanned_at)
);

create index if not exists scans_scanned_at_idx on scans(scanned_at);
create index if not exists scans_machine_scanned_idx on scans(machine_id, scanned_at);
create index if not exists scans_barcode_day_idx on scans(barcode, scanned_at);
