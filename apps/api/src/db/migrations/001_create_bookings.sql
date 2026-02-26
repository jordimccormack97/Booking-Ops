create table if not exists bookings (
  id text primary key,
  title text not null,
  startAt text not null,
  endAt text not null,
  location text not null,
  rateQuoted real not null,
  agencyEmail text not null,
  status text not null check (status in ('inquiry', 'hold', 'confirmed')),
  approvalToken text not null unique,
  calendarEventId text,
  createdAt text not null default (datetime('now'))
);
