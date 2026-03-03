import { extractMinimumHoursFromText, parseBookingEmail } from "../src/services/bookingParser";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const sample = `Booking Request
Title: Half Day Shoot
Date: 2026-03-12
Start Time: 9:00 AM
End Time: 1:00 PM
Location: Downtown Studio
Agency Email: bookings@directionsusa.com
Rate: $500 half day shoot`;

const parsed = parseBookingEmail(sample);
assert(parsed.success, "Expected parser success");
if (!parsed.success) {
  throw new Error(`Missing fields: ${parsed.missingFields.join(", ")}`);
}

assert(parsed.data.rateQuoted === 500, `Expected amount 500, got ${parsed.data.rateQuoted}`);
assert(parsed.data.duration === "half day", `Expected duration 'half day', got ${parsed.data.duration}`);
assert(parsed.data.rateType === "half_day", `Expected rateType 'half_day', got ${parsed.data.rateType}`);

const naturalLanguageSample = `Hello! Hope this finds you well. I have Reeds Jewelry shoot happening on March 11th in Wilmington from 3-7pm and wanted to see if you were available.
The rate is $500 for half day shoot.
Best,
brandin`;
const parsedNatural = parseBookingEmail(
  naturalLanguageSample,
  "bookings@directionsusa.com",
  "2026-03-01T10:00:00.000Z",
);
assert(parsedNatural.success, "Expected natural language parser success");
if (!parsedNatural.success) {
  throw new Error(`Natural sample missing fields: ${parsedNatural.missingFields.join(", ")}`);
}
assert(parsedNatural.data.rateQuoted === 500, `Expected natural amount 500, got ${parsedNatural.data.rateQuoted}`);
assert(
  parsedNatural.data.rateType === "half_day",
  `Expected natural rateType 'half_day', got ${parsedNatural.data.rateType}`,
);
assert(parsedNatural.data.location.toLowerCase() === "wilmington", "Expected location Wilmington");

const hourlySample = `Hello Jordi,
Date: 2026-04-09
Start Time: 10:00 AM
End Time: 2:00 PM
Location: Charlotte
Agency Email: bookings@directionsusa.com
The rate is $175/hour with a 3 hour minimum.`;
const parsedHourly = parseBookingEmail(hourlySample);
assert(parsedHourly.success, "Expected hourly parser success");
if (!parsedHourly.success) {
  throw new Error(`Hourly sample missing fields: ${parsedHourly.missingFields.join(", ")}`);
}
assert(parsedHourly.data.rateQuoted === 175, `Expected hourly amount 175, got ${parsedHourly.data.rateQuoted}`);
assert(parsedHourly.data.rateType === "hourly", `Expected rateType 'hourly', got ${parsedHourly.data.rateType}`);
const minimumHours = extractMinimumHoursFromText(hourlySample);
assert(minimumHours === 3, `Expected minimumHours 3, got ${String(minimumHours)}`);

console.log("Parser fixture test passed");
