# Booking-Ops

An AI-powered system that turns booking emails into calendar events and earnings forecasts for creative freelancers.

## What this does (MVP)
- Ingest booking-related emails from Gmail
- Extract structured booking details (date/time/location/rate) with AI
- Create “HOLD” or “CONFIRMED” events in Google Calendar
- Store booking + rate for earnings tracking
- Display an earnings dashboard and basic forecast

## Why it matters
Freelance creatives often manage bookings across email threads, texts, and calendars. Booking-Ops aims to centralize scheduling + income tracking in one workflow.

## Product direction
Modeling is the first vertical. The architecture is intentionally general so it can expand to photographers, videographers, designers, and other appointment-based creatives.

## Planned stack
- API: Node.js + TypeScript
- Dashboard: React + Vite + Tailwind
- DB: Supabase (Postgres)
- Integrations: Gmail API + Google Calendar API
- AI: OpenAI API

## Roadmap
See `docs/roadmap.md`.
