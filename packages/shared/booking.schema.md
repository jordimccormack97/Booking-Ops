# Booking Data Schema

This schema defines the canonical structure for all booking data
throughout the Booking-Ops system.

All services (AI extraction, API, database, dashboard) must conform
to this structure.

---

## Booking Object (v1)

```json
{
  "id": "uuid",
  "source": "DirectionsUSA",
  "status": "INQUIRY | HOLD | CONFIRMED | CANCELED",
  "client_name": "string",
  "job_title": "string",
  "start_time": "ISO-8601 timestamp",
  "end_time": "ISO-8601 timestamp",
  "timezone": "America/New_York",
  "location": "string",
  "rate": 0,
  "rate_type": "day | hour | flat",
  "notes": "string",
  "confidence": 0.0,
  "created_at": "ISO-8601 timestamp",
  "updated_at": "ISO-8601 timestamp"
}
