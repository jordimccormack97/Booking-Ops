# SaaS Booking Automation Platform

An AI-powered booking automation system that:
- Ingests booking requests via Gmail
- Detects calendar conflicts
- Creates provisional holds
- Sends approval emails
- Confirms events automatically
- Tracks revenue via dashboard

## Architecture
```text
Gmail Inbox (Requests/Replies)
            |
            v
  +------------------------+
  | API Routes (Bun/HTTP)  |
  +------------------------+
            |
            v
  +------------------------+
  | Agent Workflow Service |
  +------------------------+
    |        |         |
    |        |         +--> Gmail Service (read/send)
    |        +------------> Calendar Service (freebusy/events)
    +---------------------> Booking Service (SQLite)
            |
            v
    Worker: Email Approval Watcher
            |
            v
   Web Dashboard (bookings/revenue)
```

## Booking Lifecycle
```text
[Email Received]
      |
      v
   inquiry
      |
      +-- conflict found --> inquiry (await manual decision)
      |
      +-- no conflict --> hold (Booking Holds calendar event)
                            |
                            v
                       confirmed (primary calendar + agency confirmation)
                            |
                            v
                          canceled (optional terminal state)
```

## Tech Stack
- Bun
- React
- Tailwind CSS
- shadcn/ui
- Google Gmail API
- Google Calendar API
- SQLite

## Key Features
- Email-first ingestion for booking requests
- Automatic conflict detection via Google Calendar FreeBusy
- Provisional hold creation on a dedicated holds calendar
- Token-based approval flow with autonomous reply watcher (`YES` replies)
- Idempotent booking confirmation workflow
- Revenue and booking visibility in the frontend dashboard
- Structured logs for workflow observability

## Screenshots
- `docs/screenshots/dashboard-overview.png` (placeholder)
- `docs/screenshots/ingest-workflow.png` (placeholder)
- `docs/screenshots/approval-flow.png` (placeholder)

## Future Roadmap
- Multi-tenant team workspaces and RBAC
- Retry queues + dead-letter handling for external API failures
- Rich analytics (forecasting, conversion rates, utilization)
- Billing/subscription and usage metering
- Webhook/event bus integrations for external CRMs and finance tools
