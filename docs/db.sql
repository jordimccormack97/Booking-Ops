create extension if not exists pgcrypto;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  client_name text not null,
  start_time text not null,
  end_time text not null,
  rate double precision not null,
  created_at timestamp with time zone not null default now()
);
