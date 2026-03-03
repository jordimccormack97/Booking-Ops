import OpenAI from "openai";
import type { ParsedBookingRequest } from "../types/booking";

export type AiDirectionsUsaExtraction = {
  isBookingRequest: boolean;
  confidence: number;
  title: string | null;
  clientOrBrand: string | null;
  eventDateText: string | null;
  startTimeText: string | null;
  endTimeText: string | null;
  timezone: string | null;
  location: string | null;
  notes: string[];
  minimumHours: number | null;
  rateQuoted: number | null;
  currency: "USD" | null;
  rateType: "half_day" | "full_day" | "hourly" | "flat" | null;
  financialConfidence: number | null;
};

export type AiDirectionsUsaExtractionWithContext = AiDirectionsUsaExtraction & {
  source: "directionsusa";
  messageId: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  dateReceived: string | null;
  jobType: "shoot" | "fitting" | "travel" | "other" | null;
  usageTerms: string[];
};

export type LegacyAiExtractionResult = {
  booking: ParsedBookingRequest;
  confidence: number;
  extracted: {
    rate_amount: number | null;
    rate_type: "half_day" | "full_day" | "hourly" | "flat" | null;
  };
};

function hasBookingKeywords(text: string) {
  return /\b(shoot|fitting|travel day|confirm(?:ed|ation)?|availability|hold|book(?:ing|ed)?)\b/i.test(text);
}

function hasDateMention(text: string) {
  return (
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(
      text,
    ) || /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(text)
  );
}

function extractRateAndType(text: string): { rateQuoted: number | null; rateType: AiDirectionsUsaExtraction["rateType"] } {
  const patterns: Array<{ regex: RegExp; rateType: AiDirectionsUsaExtraction["rateType"] }> = [
    { regex: /\$?\s*(\d+(?:\.\d+)?)\s*\/\s*hour\b/i, rateType: "hourly" },
    { regex: /\$?\s*(\d+(?:\.\d+)?)\s*per\s*hour\b/i, rateType: "hourly" },
    { regex: /\$?\s*(\d+(?:\.\d+)?)\s*for\s*half[\s-]?day\b/i, rateType: "half_day" },
    { regex: /\$?\s*(\d+(?:\.\d+)?)\s*half[\s-]?day\b/i, rateType: "half_day" },
    { regex: /\$?\s*(\d+(?:\.\d+)?)\s*for\s*full[\s-]?day\b/i, rateType: "full_day" },
    { regex: /\$?\s*(\d+(?:\.\d+)?)\s*full[\s-]?day\b/i, rateType: "full_day" },
    { regex: /\$?\s*(\d+(?:\.\d+)?)\s*\/\s*day\b/i, rateType: "full_day" },
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) {
      return { rateQuoted: parsed, rateType: pattern.rateType };
    }
  }
  return { rateQuoted: null, rateType: null };
}

function extractMinimumHours(text: string): number | null {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*hour\s*minimum\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extracts structured booking/financial data from DirectionsUSA emails.
 */
export async function extractDirectionsUsaBooking(
  emailText: string,
  context: {
    messageId: string;
    threadId: string;
    subject: string | null;
    from: string | null;
    dateReceived: string | null;
  },
): Promise<AiDirectionsUsaExtractionWithContext | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const client = new OpenAI({ apiKey });
  const finalModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
  console.log("[AI MODEL]", {
    envModel: process.env.OPENAI_MODEL,
    finalModel,
  });

  const schema = {
    name: "directionsusa_booking_event_extraction",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        isBookingRequest: { type: "boolean" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        title: { type: ["string", "null"] },
        clientOrBrand: { type: ["string", "null"] },
        eventDateText: { type: ["string", "null"] },
        startTimeText: { type: ["string", "null"] },
        endTimeText: { type: ["string", "null"] },
        timezone: { type: ["string", "null"] },
        location: { type: ["string", "null"] },
        notes: { type: "array", items: { type: "string" } },
        minimumHours: { type: ["number", "null"] },
        rateQuoted: { type: ["number", "null"] },
        currency: { type: ["string", "null"], enum: ["USD", null] },
        rateType: { type: ["string", "null"], enum: ["half_day", "full_day", "hourly", "flat", null] },
        financialConfidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
      },
      required: [
        "isBookingRequest",
        "confidence",
        "title",
        "clientOrBrand",
        "eventDateText",
        "startTimeText",
        "endTimeText",
        "timezone",
        "location",
        "notes",
        "minimumHours",
        "rateQuoted",
        "currency",
        "rateType",
        "financialConfidence",
      ],
    },
  } as const;

  const resp = await client.chat.completions.create({
    model: finalModel,
    messages: [
      {
        role: "system",
        content:
          [
            "Extract booking request details and optional finance details from DirectionsUSA email text.",
            "Return only JSON matching the schema.",
            "Set isBookingRequest=true for emails mentioning shoot, fitting, travel day, confirmation, or availability checks.",
            "Set isBookingRequest=true when a specific date is mentioned.",
            "Set timezone to America/New_York if unknown.",
            "Extract rate patterns such as $175/hour, $500 half day, $750 full day, $XXX per hour, $XXX for half day, $XXX for full day, and $XXX/day.",
            "For hourly rates set rateType=hourly and rateQuoted to the numeric hourly amount.",
            "Extract minimumHours from phrases like '3 hour minimum' or '2 hour minimum'.",
            "Set rateQuoted to null unless a numeric amount is explicitly present (e.g. $500, USD 500, 500/day, 500 per hour).",
            "If no explicit numeric rate is present, financialConfidence must be null.",
            "Do not guess missing financial amounts.",
          ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          context,
          emailText,
        }),
      },
    ],
    response_format: { type: "json_schema", json_schema: schema },
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) return null;
  const parsed = JSON.parse(content) as AiDirectionsUsaExtraction;
  const regexRate = extractRateAndType(emailText);
  const regexMinimumHours = extractMinimumHours(emailText);
  const isBookingByRules = hasBookingKeywords(emailText) || hasDateMention(emailText);
  const rateQuoted = parsed.rateQuoted ?? regexRate.rateQuoted;
  const rateType = parsed.rateType ?? regexRate.rateType;

  return {
    source: "directionsusa",
    messageId: context.messageId,
    threadId: context.threadId,
    subject: context.subject,
    from: context.from,
    dateReceived: context.dateReceived,
    isBookingRequest: parsed.isBookingRequest || isBookingByRules,
    confidence: parsed.confidence,
    title: parsed.title,
    clientOrBrand: parsed.clientOrBrand,
    eventDateText: parsed.eventDateText,
    startTimeText: parsed.startTimeText,
    endTimeText: parsed.endTimeText,
    timezone: parsed.timezone ?? "America/New_York",
    location: parsed.location,
    notes: parsed.notes ?? [],
    minimumHours: parsed.minimumHours ?? regexMinimumHours,
    rateQuoted,
    currency: parsed.currency,
    rateType,
    financialConfidence: rateQuoted === null ? null : parsed.financialConfidence ?? parsed.confidence,
    jobType: null,
    usageTerms: [],
  };
}

/**
 * Backward-compatible wrapper used by existing booking ingest pipeline.
 */
export async function extractBookingWithAi(
  emailText: string,
  fallbackAgencyEmail?: string,
  fallbackMessageDate?: string,
): Promise<LegacyAiExtractionResult | null> {
  const extracted = await extractDirectionsUsaBooking(emailText, {
    messageId: "unknown",
    threadId: "unknown",
    subject: null,
    from: fallbackAgencyEmail ?? null,
    dateReceived: fallbackMessageDate ?? null,
  });
  if (!extracted || extracted.rateQuoted === null || !fallbackAgencyEmail) return null;

  const startAt = fallbackMessageDate ?? new Date().toISOString();
  const endAt = new Date(new Date(startAt).getTime() + 4 * 60 * 60 * 1000).toISOString();
  return {
    booking: {
      title: extracted.clientOrBrand || extracted.subject || "Booking Request",
      startAt,
      endAt,
      location: extracted.location || "TBD",
      duration: extracted.rateType ? extracted.rateType.replace("_", " ") : "unknown",
      rateType: extracted.rateType ?? "flat",
      rateQuoted: extracted.rateQuoted,
      agencyEmail: fallbackAgencyEmail,
    },
    confidence: extracted.confidence,
    extracted: {
      rate_amount: extracted.rateQuoted,
      rate_type: extracted.rateType,
    },
  };
}
