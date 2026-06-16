import { Request, Response } from "express";
import dns from "node:dns/promises";
import net from "node:net";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { ManageStoppagesUseCases } from "../../../application/usecases/stoppages/manage-stoppages-usecases.js";
import { SendReminderUseCase } from "../../../application/usecases/reminders/send-reminder-usecase.js";
import { getSlaThresholdForPriority } from "../../../application/services/sla-policy.js";
import { StoppageOpsRepository } from "../../../domain/repositories/stoppage-ops-repository.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { stoppageStatusLabel } from "../../../shared/utils/stoppage-status-label.js";
import { stoppageSchema } from "../validators/stoppage-validators.js";
import { listQuerySchema } from "../validators/common.js";

const optionalDateTimeQuery = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized === "undefined" || normalized === "null") return undefined;
  if (Number.isNaN(new Date(normalized).getTime())) return undefined;
  return normalized;
}, z.string().datetime().optional());

const calendarEventTypeSchema = z.enum(["EVENT", "TASK", "APPOINTMENT"]);
const calendarEventVisibilitySchema = z.enum(["default", "private", "public"]);
const calendarEventAvailabilitySchema = z.enum(["BUSY", "FREE"]);
const hexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colore evento non valido");

const calendarEventInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional().nullable(),
    start: z.string().datetime(),
    end: z.string().datetime(),
    allDay: z.boolean().optional().default(false),
    location: z.string().trim().max(180).optional().nullable(),
    attendees: z.array(z.string().trim().max(160)).optional().default([]),
    reminder: z.number().int().min(0).max(10080).optional().default(30),
    visibility: calendarEventVisibilitySchema.optional().default("default"),
    availability: calendarEventAvailabilitySchema.optional().default("BUSY"),
    type: calendarEventTypeSchema.optional().default("EVENT"),
    color: hexColorSchema.optional().default("#1a73e8"),
    calendarId: z.string().trim().min(1).max(80).optional().default("default")
  })
  .superRefine((value, ctx) => {
    const start = new Date(value.start);
    const end = new Date(value.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Intervallo evento non valido (fine <= inizio).",
        path: ["end"]
      });
    }
  });

const calendarEventPatchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  location: z.string().trim().max(180).optional().nullable(),
  attendees: z.array(z.string().trim().max(160)).optional(),
  reminder: z.number().int().min(0).max(10080).optional(),
  visibility: calendarEventVisibilitySchema.optional(),
  availability: calendarEventAvailabilitySchema.optional(),
  type: calendarEventTypeSchema.optional(),
  color: hexColorSchema.optional(),
  calendarId: z.string().trim().min(1).max(80).optional()
});

const calendarRangeQuerySchema = z.object({
  dateFrom: optionalDateTimeQuery,
  dateTo: optionalDateTimeQuery
});
const appleCalendarPrivacySchema = z.enum(["masked", "full"]);
const googleCalendarSyncInputSchema = z.object({
  dateFrom: optionalDateTimeQuery,
  dateTo: optionalDateTimeQuery,
  privacy: appleCalendarPrivacySchema.optional().default("masked")
});
const googleCalendarCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  state: z.string().trim().min(20).optional(),
  error: z.string().trim().optional(),
  error_description: z.string().trim().optional()
});
const appleCalendarImportSchema = z.object({
  feedUrl: z.string().trim().url().max(2000),
  dateFrom: optionalDateTimeQuery,
  dateTo: optionalDateTimeQuery
});
const listStatusFilterSchema = z.enum(["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED", "CLOSED", "CANCELED", "OPEN_ACTIVE"]);

const CALENDAR_FEED_TOKEN_TYPE = "calendar_feed";
const CALENDAR_FEED_EXPIRES_IN = "180d";
const APPLE_CALENDAR_TIMEZONE = "Europe/Rome";
const GOOGLE_CALENDAR_OAUTH_STATE_TYPE = "google_calendar_sync";
const GOOGLE_CALENDAR_SETTINGS_ACTION = "SETTINGS_GOOGLE_CALENDAR";
const GOOGLE_CALENDAR_OAUTH_SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email";
const GOOGLE_CALENDAR_OAUTH_TIMEOUT_MS = 12000;
const GOOGLE_CALENDAR_APP_SOURCE = "gestione-fermi-google-calendar";
const EXTERNAL_FEED_MAX_BYTES = 2 * 1024 * 1024;
const EXTERNAL_FEED_ALLOWED_CONTENT_TYPES = ["text/calendar", "text/plain", "application/octet-stream"];
const GOOGLE_SYNC_MARKER_PREFIX = "[GF_GCAL_ID:";
const APPLE_SYNC_MARKER_PREFIX = "[GF_ACAL_UID:";
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;

type StoppageListItem = {
  id: string;
  openedAt: string | Date;
  status: string;
  priority?: string | null;
  vehicle?: {
    plate?: string | null;
    brand?: string | null;
    model?: string | null;
  } | null;
  site?: { name?: string | null } | null;
  workshop?: { name?: string | null } | null;
};

type StoppageListResponse = {
  data: StoppageListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
};

type ClosureChecklistPayload = {
  photosUploaded?: boolean;
  finalCauseSet?: boolean;
  finalCostSet?: boolean;
  operatorSigned?: boolean;
};

type FinalCostPayload = {
  actualTotalCost?: number;
};

type CostApprovalDecisionPayload = {
  approved?: boolean;
};

type PartsOrderPayload = {
  etaDate?: string;
  [key: string]: unknown;
};

type EscalationLevel = "LEVEL_1" | "LEVEL_2" | "LEVEL_3";

type SlaEscalationRow = {
  id: string;
  plate?: string | null;
  site?: string | null;
  workshop?: string | null;
  priority?: string | null;
  status: string;
  daysOpen: number;
  thresholdDays: number;
  escalation: EscalationLevel | null;
};

const asObject = <T extends Record<string, unknown>>(value: unknown): Partial<T> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<T>) : {};

const isActiveStoppage = (item: StoppageListItem) => item.status !== "CLOSED" && item.status !== "CANCELED";

const ipv4ToInt = (ip: string) => {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
};

const isPrivateIpv4 = (ip: string) => {
  const value = ipv4ToInt(ip);
  if (value === null) return true;
  return (
    value <= 0x00ffffff || // 0.0.0.0/8
    (value >= 0x0a000000 && value <= 0x0affffff) || // 10.0.0.0/8
    (value >= 0x64400000 && value <= 0x647fffff) || // 100.64.0.0/10
    (value >= 0x7f000000 && value <= 0x7fffffff) || // 127.0.0.0/8
    (value >= 0xa9fe0000 && value <= 0xa9feffff) || // 169.254.0.0/16
    (value >= 0xac100000 && value <= 0xac1fffff) || // 172.16.0.0/12
    (value >= 0xc0a80000 && value <= 0xc0a8ffff) || // 192.168.0.0/16
    (value >= 0xc6120000 && value <= 0xc613ffff) || // 198.18.0.0/15
    value >= 0xe0000000 // 224.0.0.0/4 multicast/reserved
  );
};

const isPrivateIpv6 = (ip: string) => {
  const normalized = ip.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique-local
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) return isPrivateIpv4(mapped);
  }
  return false;
};

const isPrivateOrReservedAddress = (ip: string) => {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
};

const resolveSafeExternalFeedUrl = async (rawUrl: string) => {
  const normalizedInput = rawUrl.trim().replace(/^webcal:/i, "https:");
  let parsed: URL;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    throw new AppError("URL feed non valida", 400, "INVALID_FEED_URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AppError("Protocollo feed non supportato", 400, "INVALID_FEED_PROTOCOL");
  }

  if (parsed.username || parsed.password) {
    throw new AppError("Credenziali nel feed URL non consentite", 400, "INVALID_FEED_URL");
  }

  const host = parsed.hostname.trim().toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) {
    throw new AppError("Host feed non consentito", 400, "INVALID_FEED_HOST");
  }

  if (net.isIP(host) && isPrivateOrReservedAddress(host)) {
    throw new AppError("Feed URL punta a un indirizzo non consentito", 400, "EXTERNAL_FEED_FORBIDDEN_HOST");
  }

  try {
    const resolved = await dns.lookup(host, { all: true, verbatim: true });
    if (!resolved.length || resolved.some((entry) => isPrivateOrReservedAddress(entry.address))) {
      throw new AppError("Feed URL punta a un indirizzo non consentito", 400, "EXTERNAL_FEED_FORBIDDEN_HOST");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Host feed non risolvibile", 400, "EXTERNAL_FEED_UNRESOLVABLE_HOST");
  }

  return parsed.toString();
};

type CalendarFeedTokenPayload = {
  tokenType: typeof CALENDAR_FEED_TOKEN_TYPE;
  tenantId: string;
  userId: string;
  iat?: number;
  exp?: number;
};

type AppleCalendarEvent = {
  id: string;
  source: "custom";
  title: string;
  description?: string;
  location?: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  googleEventId?: string | null;
  appleUid?: string | null;
};

type AppleCalendarPrivacyMode = z.infer<typeof appleCalendarPrivacySchema>;
type GoogleCalendarStatePayload = {
  tokenType: typeof GOOGLE_CALENDAR_OAUTH_STATE_TYPE;
  tenantId: string;
  userId: string;
  dateFrom: string;
  dateTo: string;
  privacy: AppleCalendarPrivacyMode;
  iat?: number;
  exp?: number;
};

type GoogleCalendarOAuthTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleCalendarUserInfoResponse = {
  email?: string;
};

type GoogleCalendarConnection = {
  refreshToken: string;
  accountEmail: string | null;
  scope: string | null;
};

type GoogleCalendarApiEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: {
    date?: string;
    dateTime?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

const escapeIcsText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const toIcsTimestamp = (value: Date) => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const toIcsDate = (value: Date) => value.toISOString().slice(0, 10).replace(/-/g, "");
const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const foldIcsLine = (line: string) => {
  const limit = 72;
  if (line.length <= limit) return line;

  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
  return chunks.map((chunk, index) => (index === 0 ? chunk : ` ${chunk}`)).join("\r\n");
};

export class StoppagesController {
  constructor(
    private readonly useCases: ManageStoppagesUseCases,
    private readonly reminderUseCase: SendReminderUseCase,
    private readonly opsRepository: StoppageOpsRepository
  ) {}

  private readonly allowedTransitions: Record<string, string[]> = {
    OPEN: ["IN_PROGRESS", "WAITING_PARTS", "SOLICITED", "CANCELED"],
    IN_PROGRESS: ["WAITING_PARTS", "SOLICITED", "CLOSED", "CANCELED"],
    WAITING_PARTS: ["IN_PROGRESS", "SOLICITED", "CLOSED", "CANCELED"],
    SOLICITED: ["IN_PROGRESS", "WAITING_PARTS", "CLOSED", "CANCELED"],
    CLOSED: [],
    CANCELED: []
  };

  private escalationLevel(daysOpen: number, thresholdDays: number) {
    if (daysOpen >= thresholdDays + 7) return "LEVEL_3";
    if (daysOpen >= thresholdDays + 3) return "LEVEL_2";
    if (daysOpen >= thresholdDays + 1) return "LEVEL_1";
    return null;
  }

  private async logEvent(
    tenantId: string,
    stoppageId: string,
    userId: string | undefined,
    type: string,
    message: string,
    payload?: Record<string, unknown>
  ) {
    await this.opsRepository.createEvent({ tenantId, stoppageId, userId, type, message, payload });
  }

  private async ensureClosureChecklist(
    tenantId: string,
    stoppageId: string,
    userId?: string
  ) {
    const checklist = await this.opsRepository.findLatestEventByType(tenantId, stoppageId, "CLOSURE_CHECKLIST");
    const c = asObject<ClosureChecklistPayload>(checklist?.payload);
    const complete = Boolean(c?.photosUploaded && c?.finalCauseSet && c?.finalCostSet && c?.operatorSigned);
    if (complete) return;

    await this.opsRepository.createEvent({
      tenantId,
      stoppageId,
      userId,
      type: "CLOSURE_CHECKLIST",
      message: "Checklist chiusura auto-completata in fase di chiusura",
      payload: {
        photosUploaded: true,
        finalCauseSet: true,
        finalCostSet: true,
        operatorSigned: true,
        notes: "Auto-completata dal sistema durante la chiusura fermo."
      }
    });
  }

  private getMarkedValue(raw: string, prefix: string) {
    const start = raw.indexOf(prefix);
    if (start < 0) return null;
    const markerStart = start + prefix.length;
    const markerEnd = raw.indexOf("]", markerStart);
    if (markerEnd < 0) return null;
    const value = raw.slice(markerStart, markerEnd).trim();
    return value || null;
  }

  private parseSyncMetadata(description: string | null | undefined) {
    const raw = (description ?? "").trim();
    if (!raw) {
      return {
        cleanDescription: "",
        googleEventId: null as string | null,
        appleUid: null as string | null
      };
    }

    const googleEventId = this.getMarkedValue(raw, GOOGLE_SYNC_MARKER_PREFIX);
    const appleUid = this.getMarkedValue(raw, APPLE_SYNC_MARKER_PREFIX);
    const cleanDescription = raw
      .replace(/\[GF_GCAL_ID:[^\]\r\n]+\]/g, "")
      .replace(/\[GF_ACAL_UID:[^\]\r\n]+\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      cleanDescription,
      googleEventId,
      appleUid
    };
  }

  private buildMarkedDescription(
    description: string | null | undefined,
    input: { googleEventId?: string | null; appleUid?: string | null }
  ) {
    const meta = this.parseSyncMetadata(description);
    const markers: string[] = [];
    const googleEventId = input.googleEventId ?? meta.googleEventId;
    const appleUid = input.appleUid ?? meta.appleUid;
    if (googleEventId) markers.push(`${GOOGLE_SYNC_MARKER_PREFIX}${googleEventId}]`);
    if (appleUid) markers.push(`${APPLE_SYNC_MARKER_PREFIX}${appleUid}]`);
    return [meta.cleanDescription, ...markers].filter(Boolean).join("\n\n");
  }

  private decodeIcsText(value: string) {
    return value
      .replace(/\\n/gi, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\")
      .trim();
  }

  private parseIcsDate(raw: string) {
    const value = raw.trim();
    if (!value) return null;

    if (/^\d{8}$/.test(value)) {
      const year = Number(value.slice(0, 4));
      const month = Number(value.slice(4, 6));
      const day = Number(value.slice(6, 8));
      return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    }

    if (/^\d{8}T\d{6}Z$/.test(value)) {
      const year = Number(value.slice(0, 4));
      const month = Number(value.slice(4, 6));
      const day = Number(value.slice(6, 8));
      const hour = Number(value.slice(9, 11));
      const minute = Number(value.slice(11, 13));
      const second = Number(value.slice(13, 15));
      return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    }

    if (/^\d{8}T\d{6}$/.test(value)) {
      const year = Number(value.slice(0, 4));
      const month = Number(value.slice(4, 6));
      const day = Number(value.slice(6, 8));
      const hour = Number(value.slice(9, 11));
      const minute = Number(value.slice(11, 13));
      const second = Number(value.slice(13, 15));
      return new Date(year, month - 1, day, hour, minute, second);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private parseIcsEvents(payload: string) {
    const normalized = payload.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rawLines = normalized.split("\n");
    const lines: string[] = [];
    for (const rawLine of rawLines) {
      if ((rawLine.startsWith(" ") || rawLine.startsWith("\t")) && lines.length) {
        lines[lines.length - 1] += rawLine.slice(1);
      } else {
        lines.push(rawLine);
      }
    }

    const events: Array<{
      uid: string;
      title: string;
      description: string;
      location: string;
      startAt: Date;
      endAt: Date;
      allDay: boolean;
    }> = [];

    let current: {
      uid?: string;
      title?: string;
      description?: string;
      location?: string;
      startRaw?: string;
      endRaw?: string;
      allDay?: boolean;
    } | null = null;

    for (const line of lines) {
      if (line === "BEGIN:VEVENT") {
        current = {};
        continue;
      }

      if (line === "END:VEVENT") {
        if (!current?.uid || !current.startRaw) {
          current = null;
          continue;
        }

        const startAt = this.parseIcsDate(current.startRaw);
        if (!startAt) {
          current = null;
          continue;
        }

        const parsedEnd = current.endRaw ? this.parseIcsDate(current.endRaw) : null;
        const allDay = Boolean(current.allDay);
        const fallbackEnd = allDay ? new Date(startAt.getTime() + 24 * 60 * 60 * 1000) : new Date(startAt.getTime() + 60 * 60 * 1000);
        const endAt = parsedEnd && parsedEnd > startAt ? parsedEnd : fallbackEnd;
        const normalizedEnd = allDay ? new Date(endAt.getTime() - 60 * 1000) : endAt;

        events.push({
          uid: current.uid,
          title: current.title?.trim() || "Evento Apple",
          description: current.description?.trim() || "",
          location: current.location?.trim() || "",
          startAt,
          endAt: normalizedEnd > startAt ? normalizedEnd : fallbackEnd,
          allDay
        });
        current = null;
        continue;
      }

      if (!current) continue;
      const sep = line.indexOf(":");
      if (sep < 0) continue;
      const keyPart = line.slice(0, sep);
      const valuePart = this.decodeIcsText(line.slice(sep + 1));
      const key = keyPart.toUpperCase();

      if (key === "UID") current.uid = valuePart;
      else if (key === "SUMMARY") current.title = valuePart;
      else if (key === "DESCRIPTION") current.description = valuePart;
      else if (key === "LOCATION") current.location = valuePart;
      else if (key.startsWith("DTSTART")) {
        current.startRaw = valuePart;
        current.allDay = key.includes("VALUE=DATE");
      } else if (key.startsWith("DTEND")) {
        current.endRaw = valuePart;
      }
    }

    return events;
  }

  private mapCustomCalendarEvent(row: any) {
    const meta = this.parseSyncMetadata(row.description ?? "");
    return {
      id: row.id,
      title: row.title,
      description: meta.cleanDescription,
      start: row.startAt.toISOString(),
      end: row.endAt.toISOString(),
      allDay: Boolean(row.allDay),
      location: row.location ?? "",
      attendees: Array.isArray(row.attendees) ? row.attendees.filter((item: unknown) => typeof item === "string") : [],
      reminder: Number.isFinite(row.reminder) ? row.reminder : 30,
      visibility: row.visibility ?? "default",
      availability: row.availability ?? "BUSY",
      type: row.type ?? "EVENT",
      color: row.color ?? "#1a73e8",
      calendarId: row.calendarId ?? "default",
      source: "custom" as const
    };
  }

  private parseCalendarRange(query: Request["query"]) {
    const parsed = calendarRangeQuerySchema.parse(query);
    const dateFrom = parsed.dateFrom ? new Date(parsed.dateFrom) : new Date(Date.now() - 30 * 86400000);
    const dateTo = parsed.dateTo ? new Date(parsed.dateTo) : new Date(Date.now() + 90 * 86400000);
    return { dateFrom, dateTo };
  }

  private redactSensitiveText(value: string) {
    return value.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[telefono]").trim();
  }

  private async loadAppleCalendarEvents(
    tenantId: string,
    userId: string,
    dateFrom: Date,
    dateTo: Date,
    privacyMode: AppleCalendarPrivacyMode
  ): Promise<AppleCalendarEvent[]> {
    const customRows = await prisma.calendarEvent.findMany({
      where: {
        tenantId,
        userId,
        startAt: { lte: dateTo },
        endAt: { gte: dateFrom }
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }]
    });

    const customEvents: AppleCalendarEvent[] = customRows.map((row) => {
      const meta = this.parseSyncMetadata(row.description ?? "");
      return {
        id: row.id,
        source: "custom",
        title: this.redactSensitiveText(row.title || "Evento calendario"),
        description: privacyMode === "full" ? meta.cleanDescription : "",
        location: privacyMode === "full" ? (row.location ?? "") : "",
        startAt: row.startAt,
        endAt: row.endAt,
        allDay: Boolean(row.allDay),
        googleEventId: meta.googleEventId,
        appleUid: meta.appleUid
      };
    });

    return customEvents.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  }

  private buildAppleCalendarIcs(events: AppleCalendarEvent[], tenantId: string, privacyMode: AppleCalendarPrivacyMode) {
    const generatedAt = new Date();
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Fleetum//Apple Calendar Export//IT",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeIcsText(`Fleetum ${tenantId}`)}`,
      `X-WR-TIMEZONE:${APPLE_CALENDAR_TIMEZONE}`
    ];

    for (const event of events) {
      const eventStart = event.startAt;
      const eventEnd = event.endAt > event.startAt ? event.endAt : new Date(event.startAt.getTime() + 60 * 60 * 1000);
      const uid = `${event.source}-${event.id}@gestionefermi.local`;

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${toIcsTimestamp(generatedAt)}`);
      lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(event.title)}`));

      if (event.allDay) {
        const endExclusive = new Date(Date.UTC(eventEnd.getUTCFullYear(), eventEnd.getUTCMonth(), eventEnd.getUTCDate() + 1));
        lines.push(`DTSTART;VALUE=DATE:${toIcsDate(eventStart)}`);
        lines.push(`DTEND;VALUE=DATE:${toIcsDate(endExclusive)}`);
      } else {
        lines.push(`DTSTART:${toIcsTimestamp(eventStart)}`);
        lines.push(`DTEND:${toIcsTimestamp(eventEnd)}`);
      }

      if (event.location) lines.push(foldIcsLine(`LOCATION:${escapeIcsText(event.location)}`));
      if (event.description) lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(event.description)}`));
      if (privacyMode === "masked") lines.push("CLASS:PRIVATE");
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    return `${lines.join("\r\n")}\r\n`;
  }

  private ensureGoogleOAuthConfigured() {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new AppError("Google Workspace non configurato sul backend", 503, "GOOGLE_OAUTH_NOT_CONFIGURED");
    }
  }

  private issueGoogleCalendarStateToken(payload: Omit<GoogleCalendarStatePayload, "tokenType">) {
    return jwt.sign(
      {
        tokenType: GOOGLE_CALENDAR_OAUTH_STATE_TYPE,
        tenantId: payload.tenantId,
        userId: payload.userId,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        privacy: payload.privacy
      } satisfies GoogleCalendarStatePayload,
      env.JWT_SECRET,
      { expiresIn: "15m" }
    );
  }

  private readGoogleCalendarStateToken(rawState: string) {
    try {
      const payload = jwt.verify(rawState, env.JWT_SECRET) as GoogleCalendarStatePayload;
      if (
        payload.tokenType !== GOOGLE_CALENDAR_OAUTH_STATE_TYPE ||
        !payload.tenantId ||
        !payload.userId ||
        !payload.dateFrom ||
        !payload.dateTo ||
        !payload.privacy
      ) {
        throw new AppError("State Google Calendar non valido", 401, "GOOGLE_STATE_INVALID");
      }
      return payload;
    } catch {
      throw new AppError("State Google Calendar non valido", 401, "GOOGLE_STATE_INVALID");
    }
  }

  private buildGoogleCalendarAuthUrl(stateToken: string) {
    this.ensureGoogleOAuthConfigured();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
    url.searchParams.set("redirect_uri", env.GOOGLE_WORKSPACE_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_CALENDAR_OAUTH_SCOPE);
    url.searchParams.set("state", stateToken);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent select_account");
    return url.toString();
  }

  private async fetchGoogleJson<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_CALENDAR_OAUTH_TIMEOUT_MS);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const data = (await response.json().catch(() => ({}))) as T & {
        error?: string | { message?: string };
        error_description?: string;
        message?: string;
      };

      if (!response.ok) {
        const providerError = typeof data.error === "string" ? data.error : data.error?.message;
        throw new AppError(
          data.error_description || providerError || data.message || `Google API error (${response.status})`,
          502,
          "GOOGLE_API_ERROR"
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new AppError("Timeout comunicazione Google API", 504, "GOOGLE_API_TIMEOUT");
      }
      throw new AppError("Errore comunicazione Google API", 502, "GOOGLE_API_NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchText(url: string, init?: RequestInit): Promise<string> {
    const safeUrl = await resolveSafeExternalFeedUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_CALENDAR_OAUTH_TIMEOUT_MS);

    try {
      const response = await fetch(safeUrl, { ...init, signal: controller.signal, redirect: "error" });
      if (!response.ok) {
        throw new AppError(`Errore download feed (${response.status})`, 502, "EXTERNAL_FEED_ERROR");
      }

      const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType && !EXTERNAL_FEED_ALLOWED_CONTENT_TYPES.some((allowed) => contentType.includes(allowed))) {
        throw new AppError("Content-Type feed non supportato", 400, "EXTERNAL_FEED_CONTENT_TYPE_INVALID");
      }

      const contentLength = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(contentLength) && contentLength > EXTERNAL_FEED_MAX_BYTES) {
        throw new AppError("Feed troppo grande", 413, "EXTERNAL_FEED_TOO_LARGE");
      }

      const raw = Buffer.from(await response.arrayBuffer());
      if (raw.length > EXTERNAL_FEED_MAX_BYTES) {
        throw new AppError("Feed troppo grande", 413, "EXTERNAL_FEED_TOO_LARGE");
      }

      return raw.toString("utf8");
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new AppError("Timeout download feed esterno", 504, "EXTERNAL_FEED_TIMEOUT");
      }
      throw new AppError("Errore rete su feed esterno", 502, "EXTERNAL_FEED_NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async exchangeGoogleCalendarCode(code: string) {
    this.ensureGoogleOAuthConfigured();
    const tokenResponse = await this.fetchGoogleJson<GoogleCalendarOAuthTokenResponse>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: env.GOOGLE_WORKSPACE_REDIRECT_URI,
        grant_type: "authorization_code"
      }).toString()
    });

    if (!tokenResponse.access_token) {
      throw new AppError(
        tokenResponse.error_description ?? "Access token Google non ricevuto",
        401,
        "GOOGLE_TOKEN_EXCHANGE_FAILED"
      );
    }

    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token ?? null,
      scope: tokenResponse.scope ?? null
    };
  }

  private async refreshGoogleCalendarAccessToken(refreshToken: string) {
    this.ensureGoogleOAuthConfigured();
    let tokenResponse: GoogleCalendarOAuthTokenResponse;
    try {
      tokenResponse = await this.fetchGoogleJson<GoogleCalendarOAuthTokenResponse>("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          refresh_token: refreshToken,
          grant_type: "refresh_token"
        }).toString()
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError("Refresh token Google non valido", 401, "GOOGLE_TOKEN_REFRESH_FAILED");
      }
      throw error;
    }

    if (!tokenResponse.access_token) {
      throw new AppError(tokenResponse.error_description ?? "Refresh token Google non valido", 401, "GOOGLE_TOKEN_REFRESH_FAILED");
    }

    return {
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope ?? null
    };
  }

  private async fetchGoogleCalendarAccountEmail(accessToken: string) {
    const response = await this.fetchGoogleJson<GoogleCalendarUserInfoResponse>("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.email?.toLowerCase().trim() ?? null;
  }

  private async loadGoogleCalendarConnection(tenantId: string, userId: string): Promise<GoogleCalendarConnection | null> {
    const row = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        userId,
        resource: "integrations",
        action: GOOGLE_CALENDAR_SETTINGS_ACTION
      },
      orderBy: { createdAt: "desc" }
    });

    const details = row?.details as Record<string, unknown> | null | undefined;
    if (!details || typeof details !== "object") return null;
    if (details.connected === false) return null;

    const refreshToken = typeof details.refreshToken === "string" ? details.refreshToken.trim() : "";
    if (!refreshToken) return null;

    return {
      refreshToken,
      accountEmail: typeof details.accountEmail === "string" ? details.accountEmail : null,
      scope: typeof details.scope === "string" ? details.scope : null
    };
  }

  private async saveGoogleCalendarConnection(tenantId: string, userId: string, input: { refreshToken: string; accountEmail?: string | null; scope?: string | null }) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: GOOGLE_CALENDAR_SETTINGS_ACTION,
        resource: "integrations",
        details: {
          connected: true,
          refreshToken: input.refreshToken,
          accountEmail: input.accountEmail ?? null,
          scope: input.scope ?? null,
          updatedAt: new Date().toISOString()
        } as any
      }
    });
  }

  private async clearGoogleCalendarConnection(tenantId: string, userId: string) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: GOOGLE_CALENDAR_SETTINGS_ACTION,
        resource: "integrations",
        details: {
          connected: false,
          refreshToken: null,
          accountEmail: null,
          updatedAt: new Date().toISOString()
        } as any
      }
    });
  }

  private buildGoogleExternalEventId(tenantId: string, userId: string, eventId: string) {
    return `${tenantId}:${userId}:${eventId}`;
  }

  private mapCalendarEventToGooglePayload(
    event: AppleCalendarEvent,
    tenantId: string,
    userId: string,
    input: { includeManagedMarker?: boolean } = {}
  ) {
    const eventStart = event.startAt;
    const eventEnd = event.endAt > event.startAt ? event.endAt : new Date(event.startAt.getTime() + 60 * 60 * 1000);
    const includeManagedMarker = input.includeManagedMarker ?? true;
    const externalId = includeManagedMarker ? this.buildGoogleExternalEventId(tenantId, userId, event.id) : null;

    const payload: Record<string, unknown> = {
      summary: event.title,
      description: event.description || undefined,
      location: event.location || undefined
    };

    if (externalId) {
      payload.extendedProperties = {
        private: {
          gestioneFermiEventId: externalId,
          gestioneFermiTenantId: tenantId,
          gestioneFermiUserId: userId
        }
      };
    }

    if (event.allDay) {
      const endExclusive = new Date(Date.UTC(eventEnd.getUTCFullYear(), eventEnd.getUTCMonth(), eventEnd.getUTCDate() + 1));
      payload.start = { date: toIsoDate(eventStart) };
      payload.end = { date: toIsoDate(endExclusive) };
    } else {
      payload.start = { dateTime: eventStart.toISOString(), timeZone: APPLE_CALENDAR_TIMEZONE };
      payload.end = { dateTime: eventEnd.toISOString(), timeZone: APPLE_CALENDAR_TIMEZONE };
    }

    return { payload, externalId };
  }

  private async findGoogleEventByExternalId(accessToken: string, externalId: string): Promise<string | null> {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("privateExtendedProperty", `gestioneFermiEventId=${externalId}`);

    const response = await this.fetchGoogleJson<{ items?: Array<{ id?: string }> }>(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const id = response.items?.[0]?.id;
    return typeof id === "string" && id.trim() ? id : null;
  }

  private async patchGoogleCalendarEventById(accessToken: string, googleEventId: string, payload: Record<string, unknown>) {
    const patchUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`);
    patchUrl.searchParams.set("sendUpdates", "none");
    await this.fetchGoogleJson<Record<string, unknown>>(patchUrl.toString(), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  private async upsertGoogleCalendarEvent(accessToken: string, tenantId: string, userId: string, event: AppleCalendarEvent) {
    const { payload, externalId } = this.mapCalendarEventToGooglePayload(event, tenantId, userId, {
      includeManagedMarker: !event.googleEventId
    });

    if (event.googleEventId) {
      await this.patchGoogleCalendarEventById(accessToken, event.googleEventId, payload);
      return;
    }

    if (!externalId) {
      throw new AppError("Evento Google non valido per sincronizzazione", 400, "GOOGLE_SYNC_INVALID_EVENT");
    }
    const existingId = await this.findGoogleEventByExternalId(accessToken, externalId);

    if (existingId) {
      await this.patchGoogleCalendarEventById(accessToken, existingId, payload);
      return;
    }

    const insertUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    insertUrl.searchParams.set("sendUpdates", "none");
    await this.fetchGoogleJson<Record<string, unknown>>(insertUrl.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  private async listGoogleCalendarEventsInRange(accessToken: string, dateFrom: Date, dateTo: Date) {
    const all: GoogleCalendarApiEvent[] = [];
    let pageToken: string | null = null;

    do {
      const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("maxResults", "2500");
      url.searchParams.set("timeMin", dateFrom.toISOString());
      url.searchParams.set("timeMax", dateTo.toISOString());
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const page = await this.fetchGoogleJson<{ items?: GoogleCalendarApiEvent[]; nextPageToken?: string }>(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      all.push(...(page.items ?? []));
      pageToken = page.nextPageToken ?? null;
    } while (pageToken);

    return all;
  }

  private parseGoogleEventRange(event: GoogleCalendarApiEvent) {
    const startDate = event.start?.date;
    const endDate = event.end?.date;
    if (startDate) {
      const startAt = new Date(`${startDate}T00:00:00`);
      const endExclusive = endDate ? new Date(`${endDate}T00:00:00`) : new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
      const endAt = new Date(endExclusive.getTime() - 60 * 1000);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
      return {
        startAt,
        endAt: endAt > startAt ? endAt : new Date(startAt.getTime() + 24 * 60 * 60 * 1000 - 60 * 1000),
        allDay: true
      };
    }

    const startDateTime = event.start?.dateTime;
    const endDateTime = event.end?.dateTime;
    if (!startDateTime) return null;
    const startAt = new Date(startDateTime);
    const endAtRaw = endDateTime ? new Date(endDateTime) : new Date(startAt.getTime() + 60 * 60 * 1000);
    const endAt = endAtRaw > startAt ? endAtRaw : new Date(startAt.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
    return {
      startAt,
      endAt,
      allDay: false
    };
  }

  private async pullGoogleCalendarEventsToLocal(tenantId: string, userId: string, accessToken: string, dateFrom: Date, dateTo: Date) {
    const remoteEvents = await this.listGoogleCalendarEventsInRange(accessToken, dateFrom, dateTo);
    const existingRows = await prisma.calendarEvent.findMany({
      where: {
        tenantId,
        userId,
        startAt: { lte: dateTo },
        endAt: { gte: dateFrom },
        description: { contains: GOOGLE_SYNC_MARKER_PREFIX }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });

    const existingByGoogleId = new Map<string, (typeof existingRows)[number]>();
    for (const row of existingRows) {
      const marker = this.parseSyncMetadata(row.description ?? "").googleEventId;
      if (!marker || existingByGoogleId.has(marker)) continue;
      existingByGoogleId.set(marker, row);
    }

    let imported = 0;
    let updated = 0;
    let removed = 0;

    for (const remoteEvent of remoteEvents) {
      const googleEventId = remoteEvent.id?.trim();
      if (!googleEventId) continue;

      const managedByGestionale = remoteEvent.extendedProperties?.private?.gestioneFermiEventId;
      if (managedByGestionale) continue;

      const existing = existingByGoogleId.get(googleEventId);
      if (remoteEvent.status === "cancelled") {
        if (existing) {
          await prisma.calendarEvent.delete({ where: { id: existing.id } });
          removed += 1;
        }
        continue;
      }

      const parsedRange = this.parseGoogleEventRange(remoteEvent);
      if (!parsedRange) continue;
      if (parsedRange.endAt < dateFrom || parsedRange.startAt > dateTo) continue;

      const descriptionWithMarker = this.buildMarkedDescription(remoteEvent.description ?? "", {
        googleEventId
      });
      const title = this.redactSensitiveText((remoteEvent.summary ?? "").trim() || "Evento Google");
      const location = (remoteEvent.location ?? "").trim();

      if (existing) {
        await prisma.calendarEvent.update({
          where: { id: existing.id },
          data: {
            title,
            description: descriptionWithMarker,
            location: location || null,
            startAt: parsedRange.startAt,
            endAt: parsedRange.endAt,
            allDay: parsedRange.allDay
          }
        });
        updated += 1;
      } else {
        await prisma.calendarEvent.create({
          data: {
            tenantId,
            userId,
            title,
            description: descriptionWithMarker,
            location: location || null,
            startAt: parsedRange.startAt,
            endAt: parsedRange.endAt,
            allDay: parsedRange.allDay,
            attendees: [] as any,
            reminder: 30,
            visibility: "default",
            availability: "BUSY",
            type: "EVENT",
            color: "#1a73e8",
            calendarId: "work"
          }
        });
        imported += 1;
      }
    }

    return { imported, updated, removed };
  }

  private async pushLocalCalendarEventsToGoogle(
    tenantId: string,
    userId: string,
    accessToken: string,
    dateFrom: Date,
    dateTo: Date,
    privacyMode: AppleCalendarPrivacyMode
  ) {
    const events = await this.loadAppleCalendarEvents(tenantId, userId, dateFrom, dateTo, privacyMode);
    for (const event of events) {
      await this.upsertGoogleCalendarEvent(accessToken, tenantId, userId, event);
    }
    return { pushed: events.length };
  }

  private async syncGoogleCalendarEvents(
    tenantId: string,
    userId: string,
    accessToken: string,
    dateFrom: Date,
    dateTo: Date,
    privacyMode: AppleCalendarPrivacyMode
  ) {
    const pushed = await this.pushLocalCalendarEventsToGoogle(tenantId, userId, accessToken, dateFrom, dateTo, privacyMode);
    const pulled = await this.pullGoogleCalendarEventsToLocal(tenantId, userId, accessToken, dateFrom, dateTo);
    return {
      synced: pushed.pushed,
      pushed: pushed.pushed,
      imported: pulled.imported,
      updated: pulled.updated,
      removed: pulled.removed
    };
  }

  private buildGoogleCalendarCallbackHtml(payload: {
    status: "success" | "error";
    message?: string;
    synced?: number;
    pushed?: number;
    imported?: number;
    updated?: number;
    removed?: number;
    accountEmail?: string | null;
  }) {
    const safePayload = JSON.stringify({ source: GOOGLE_CALENDAR_APP_SOURCE, ...payload }).replace(/</g, "\\u003c");
    const safeOrigin = JSON.stringify("*");

    return `<!doctype html>
<html lang="it">
<head><meta charset="utf-8"><title>Google Calendar Sync</title></head>
<body>
<script>
(() => {
  const payload = ${safePayload};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, ${safeOrigin});
    }
  } catch {}
  setTimeout(() => window.close(), 120);
})();
</script>
</body>
</html>`;
  }

  private issueCalendarFeedToken(tenantId: string, userId: string) {
    const token = jwt.sign({ tokenType: CALENDAR_FEED_TOKEN_TYPE, tenantId, userId }, env.JWT_SECRET, {
      expiresIn: CALENDAR_FEED_EXPIRES_IN as jwt.SignOptions["expiresIn"]
    });
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null;
    return { token, expiresAt };
  }

  private readCalendarFeedToken(rawToken: string) {
    try {
      const payload = jwt.verify(rawToken, env.JWT_SECRET) as CalendarFeedTokenPayload;
      if (payload.tokenType !== CALENDAR_FEED_TOKEN_TYPE || !payload.tenantId || !payload.userId) {
        throw new AppError("Token feed calendario non valido", 401, "UNAUTHORIZED");
      }
      return payload;
    } catch {
      throw new AppError("Token feed calendario non valido", 401, "UNAUTHORIZED");
    }
  }

  listCustomCalendarEvents = async (req: Request, res: Response) => {
    const query = z
      .object({
        dateFrom: optionalDateTimeQuery,
        dateTo: optionalDateTimeQuery
      })
      .parse(req.query);

    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 30 * 86400000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date(Date.now() + 30 * 86400000);

    const rows = await prisma.calendarEvent.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        startAt: { lte: dateTo },
        endAt: { gte: dateFrom }
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }]
    });

    res.json({ data: rows.map((row) => this.mapCustomCalendarEvent(row)) });
  };

  createCustomCalendarEvent = async (req: Request, res: Response) => {
    const input = calendarEventInputSchema.parse(req.body);

    const created = await prisma.calendarEvent.create({
      data: {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        title: input.title,
        description: input.description ?? null,
        startAt: new Date(input.start),
        endAt: new Date(input.end),
        allDay: Boolean(input.allDay),
        location: input.location ?? null,
        attendees: input.attendees as any,
        reminder: input.reminder,
        visibility: input.visibility,
        availability: input.availability,
        type: input.type,
        color: input.color,
        calendarId: input.calendarId
      }
    });

    res.status(201).json({ data: this.mapCustomCalendarEvent(created) });
  };

  updateCustomCalendarEvent = async (req: Request, res: Response) => {
    const patch = calendarEventPatchSchema.parse(req.body);
    const eventId = z.string().trim().min(1).parse(req.params.eventId);

    const existing = await prisma.calendarEvent.findFirst({
      where: { id: eventId, tenantId: req.auth!.tenantId, userId: req.auth!.userId }
    });

    if (!existing) throw new AppError("Evento calendario non trovato", 404, "NOT_FOUND");

    const nextStart = patch.start ? new Date(patch.start) : existing.startAt;
    const nextEnd = patch.end ? new Date(patch.end) : existing.endAt;

    if (Number.isNaN(nextStart.getTime()) || Number.isNaN(nextEnd.getTime()) || nextEnd <= nextStart) {
      throw new AppError("Intervallo evento non valido", 400, "BAD_REQUEST");
    }

    const existingMeta = this.parseSyncMetadata(existing.description ?? "");
    const nextDescription =
      patch.description !== undefined
        ? this.buildMarkedDescription(patch.description ?? "", {
            googleEventId: existingMeta.googleEventId,
            appleUid: existingMeta.appleUid
          })
        : undefined;

    const updated = await prisma.calendarEvent.update({
      where: { id: eventId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: nextDescription || null } : {}),
        ...(patch.start !== undefined ? { startAt: nextStart } : {}),
        ...(patch.end !== undefined ? { endAt: nextEnd } : {}),
        ...(patch.allDay !== undefined ? { allDay: patch.allDay } : {}),
        ...(patch.location !== undefined ? { location: patch.location ?? null } : {}),
        ...(patch.attendees !== undefined ? { attendees: patch.attendees as any } : {}),
        ...(patch.reminder !== undefined ? { reminder: patch.reminder } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.availability !== undefined ? { availability: patch.availability } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.calendarId !== undefined ? { calendarId: patch.calendarId } : {})
      }
    });

    res.json({ data: this.mapCustomCalendarEvent(updated) });
  };

  deleteCustomCalendarEvent = async (req: Request, res: Response) => {
    const eventId = z.string().trim().min(1).parse(req.params.eventId);
    const removed = await prisma.calendarEvent.deleteMany({
      where: { id: eventId, tenantId: req.auth!.tenantId, userId: req.auth!.userId }
    });

    if (!removed.count) throw new AppError("Evento calendario non trovato", 404, "NOT_FOUND");
    res.status(204).send();
  };

  list = async (req: Request, res: Response) => {
    const query = listQuerySchema
      .extend({
        status: z.preprocess((value) => (value === "" ? undefined : value), listStatusFilterSchema.optional())
      })
      .parse(req.query);
    const siteId = typeof req.query.siteId === "string" ? req.query.siteId : undefined;
    const workshopId = typeof req.query.workshopId === "string" ? req.query.workshopId : undefined;
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
    const result = await this.useCases.list(req.auth!.tenantId, {
      search: query.search,
      status: query.status,
      siteId,
      workshopId,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      ...pagination
    });
    res.json({ ...result, page: query.page, pageSize: query.pageSize });
  };

  getById = async (req: Request, res: Response) => {
    const item = await this.useCases.getById(req.auth!.tenantId, req.params.id);
    if (!item) throw new AppError("Fermo non trovato", 404, "NOT_FOUND");
    res.json(item);
  };

  create = async (req: Request, res: Response) => {
    const input = stoppageSchema.parse(req.body);
    const result = await this.useCases.create(req.auth!.tenantId, {
      ...input,
      openedAt: new Date(input.openedAt),
      closedAt: input.closedAt ? new Date(input.closedAt) : null,
      createdByUserId: req.auth!.userId
    });

    await this.logEvent(req.auth!.tenantId, (result as any).id, req.auth?.userId, "CREATED", "Fermo creato", {
      status: (result as any).status
    });

    res.status(201).json(result);
  };

  update = async (req: Request, res: Response) => {
    const input = stoppageSchema.partial().parse(req.body);
    const result = await this.useCases.update(req.auth!.tenantId, req.params.id, {
      ...input,
      ...(input.openedAt ? { openedAt: new Date(input.openedAt) } : {}),
      ...(input.closedAt ? { closedAt: new Date(input.closedAt) } : {})
    });

    await this.logEvent(req.auth!.tenantId, req.params.id, req.auth?.userId, "UPDATED", "Fermo aggiornato", input as any);
    res.json(result);
  };

  updateStatus = async (req: Request, res: Response) => {
    const status = stoppageSchema.shape.status.parse(req.body.status);
    if (!status) throw new AppError("Stato non valido", 422, "VALIDATION_ERROR");
    if (status === "CLOSED") {
      await this.ensureClosureChecklist(req.auth!.tenantId, req.params.id, req.auth?.userId);
    }

    const result = await this.useCases.update(req.auth!.tenantId, req.params.id, { status });

    await this.logEvent(
      req.auth!.tenantId,
      req.params.id,
      req.auth?.userId,
      "STATUS_CHANGED",
      `Stato aggiornato a ${stoppageStatusLabel(status)}`,
      {
      status
      }
    );
    res.json(result);
  };

  remove = async (req: Request, res: Response) => {
    await this.useCases.delete(req.auth!.tenantId, req.params.id);
    await this.logEvent(req.auth!.tenantId, req.params.id, req.auth?.userId, "DELETED", "Fermo eliminato");
    res.status(204).send();
  };

  sendManualReminder = async (req: Request, res: Response) => {
    const result = await this.reminderUseCase.manualEmail(req.auth!.tenantId, req.params.id);
    await this.logEvent(req.auth!.tenantId, req.params.id, req.auth?.userId, "REMINDER_MANUAL", "Reminder manuale richiesto");
    res.json(result);
  };

  whatsappLink = async (req: Request, res: Response) => {
    const stoppage = (await this.useCases.getById(req.auth!.tenantId, req.params.id)) as any;
    if (!stoppage) throw new AppError("Fermo non trovato", 404, "NOT_FOUND");
    const number = (stoppage.workshopWhatsappSnapshot || stoppage.workshop?.whatsapp || "").replace(/\D/g, "");
    if (!number) throw new AppError("Numero WhatsApp officina mancante", 400, "VALIDATION_ERROR");

    const message = [
      "Richiesta aggiornamento fermo",
      `Targa: ${stoppage.vehicle.plate}`,
      `Veicolo: ${stoppage.vehicle.brand} ${stoppage.vehicle.model}`,
      `Sede: ${stoppage.site.name}`,
      `Motivo: ${stoppage.reason}`,
      `Stato: ${stoppageStatusLabel(stoppage.status)}`
    ].join("\\n");

    const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    res.json({ url });
  };

  listEvents = async (req: Request, res: Response) => {
    const events = await this.opsRepository.listEvents(req.auth!.tenantId, req.params.id, 100);
    res.json({ data: events });
  };

  workflowTransition = async (req: Request, res: Response) => {
    const payload = z
      .object({
        toStatus: z.enum(["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED", "CLOSED", "CANCELED"]),
        note: z.string().max(500).optional(),
        closureSummary: z.string().optional()
      })
      .parse(req.body);

    const current = (await this.useCases.getById(req.auth!.tenantId, req.params.id)) as any;
    if (!current) throw new AppError("Fermo non trovato", 404, "NOT_FOUND");
    if (current.status === payload.toStatus) throw new AppError("Il fermo è già in questo stato", 400, "VALIDATION_ERROR");

    const allowed = this.allowedTransitions[current.status] ?? [];
    if (!allowed.includes(payload.toStatus)) {
      throw new AppError(`Transizione non consentita da ${stoppageStatusLabel(current.status)} a ${stoppageStatusLabel(payload.toStatus)}`, 422, "VALIDATION_ERROR");
    }

    if (payload.toStatus === "CLOSED") {
      await this.ensureClosureChecklist(req.auth!.tenantId, req.params.id, req.auth?.userId);
    }

    const updated = await this.useCases.update(req.auth!.tenantId, req.params.id, { status: payload.toStatus });

    await this.logEvent(
      req.auth!.tenantId,
      req.params.id,
      req.auth?.userId,
      "WORKFLOW_TRANSITION",
      `Transizione workflow: ${stoppageStatusLabel(current.status)} -> ${stoppageStatusLabel(payload.toStatus)}`,
      { from: current.status, to: payload.toStatus, note: payload.note ?? null }
    );

    res.json(updated);
  };

  slaOverview = async (req: Request, res: Response) => {
    type SlaRow = {
      id: string;
      plate: string | null | undefined;
      site: string | null | undefined;
      workshop: string | null | undefined;
      status: string;
      priority: string | null | undefined;
      daysOpen: number;
      thresholdDays: number;
      remainingDays: number;
      breached: boolean;
    };

    const now = new Date();
    const rows = (await this.useCases.list(req.auth!.tenantId, { skip: 0, take: 500, sortDir: "desc" })) as StoppageListResponse;
    const active = rows.data.filter(isActiveStoppage);
    const data: SlaRow[] = active.map((item) => {
      const daysOpen = Math.floor((now.getTime() - new Date(item.openedAt).getTime()) / 86400000);
      const thresholdDays = getSlaThresholdForPriority(item.priority);
      const remainingDays = thresholdDays - daysOpen;
      const breached = remainingDays < 0;
      return {
        id: item.id,
        plate: item.vehicle?.plate,
        site: item.site?.name,
        workshop: item.workshop?.name,
        status: item.status,
        priority: item.priority,
        daysOpen,
        thresholdDays,
        remainingDays,
        breached
      };
    });

    res.json({
      kpis: {
        totalActive: data.length,
        breached: data.filter((x) => x.breached).length,
        expiringSoon: data.filter((x) => !x.breached && x.remainingDays <= 2).length
      },
      data: data.sort((a, b) => a.remainingDays - b.remainingDays)
    });
  };

  assignmentSuggestions = async (req: Request, res: Response) => {
    const [users, openStoppages] = await Promise.all([
      this.opsRepository.listActiveUsers(req.auth!.tenantId),
      this.opsRepository.listOpenStoppagesForAssignment(req.auth!.tenantId)
    ]);

    const workloads = users.map((user) => {
      const assigned = openStoppages.filter((x) => x.assignedToUserId === user.id);
      const weightedLoad = assigned.reduce((acc, item) => acc + (item.priority === "CRITICAL" ? 4 : item.priority === "HIGH" ? 3 : item.priority === "MEDIUM" ? 2 : 1), 0);
      return {
        userId: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        assignedCount: assigned.length,
        weightedLoad
      };
    });

    const suggestions = workloads.sort((a, b) => a.weightedLoad - b.weightedLoad).slice(0, 5);
    res.json({ data: workloads, suggestions });
  };

  calendar = async (req: Request, res: Response) => {
    const query = z
      .object({
        dateFrom: optionalDateTimeQuery,
        dateTo: optionalDateTimeQuery
      })
      .parse(req.query);
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 30 * 86400000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date(Date.now() + 30 * 86400000);

    const rows = await this.opsRepository.listCalendarRows(req.auth!.tenantId, dateFrom, dateTo);

    const events = rows.map((row) => ({
      id: row.id,
      title: `${row.vehicle.plate} · ${stoppageStatusLabel(row.status)}`,
      start: row.openedAt.toISOString(),
      end: (row.closedAt ?? new Date()).toISOString(),
      allDay: false,
      status: row.status,
      priority: row.priority,
      site: row.site.name,
      workshop: row.workshop.name
    }));
    res.json({ data: events });
  };

  appleCalendarFeedInfo = async (req: Request, res: Response) => {
    const query = z
      .object({
        dateFrom: optionalDateTimeQuery,
        dateTo: optionalDateTimeQuery,
        privacy: appleCalendarPrivacySchema.optional()
      })
      .parse(req.query);

    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 30 * 86400000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date(Date.now() + 90 * 86400000);
    const privacyMode = query.privacy ?? "masked";
    const { token, expiresAt } = this.issueCalendarFeedToken(req.auth!.tenantId, req.auth!.userId);

    const feedQuery = new URLSearchParams({
      token,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      privacy: privacyMode
    });

    const httpUrl = `${env.BACKEND_PUBLIC_URL}/api/calendar/apple/feed.ics?${feedQuery.toString()}`;
    const webcalUrl = httpUrl.replace(/^http/i, "webcal");

    res.json({
      data: {
        httpUrl,
        webcalUrl,
        expiresAt,
        privacy: privacyMode
      }
    });
  };

  appleCalendarFeedPublic = async (req: Request, res: Response) => {
    const query = z
      .object({
        token: z.string().trim().min(20),
        dateFrom: optionalDateTimeQuery,
        dateTo: optionalDateTimeQuery,
        privacy: appleCalendarPrivacySchema.optional()
      })
      .parse(req.query);

    const feedToken = this.readCalendarFeedToken(query.token);
    const tenant = await prisma.tenant.findFirst({
      where: { id: feedToken.tenantId, deletedAt: null, isActive: true },
      select: { id: true }
    });
    if (!tenant) throw new AppError("Feed calendario non disponibile", 403, "FORBIDDEN");

    const user = await prisma.user.findFirst({
      where: { id: feedToken.userId, tenantId: feedToken.tenantId, deletedAt: null, status: "ACTIVE" },
      select: { id: true }
    });
    if (!user) throw new AppError("Feed calendario non disponibile", 403, "FORBIDDEN");

    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 30 * 86400000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date(Date.now() + 90 * 86400000);
    const privacyMode = query.privacy ?? "masked";
    const events = await this.loadAppleCalendarEvents(feedToken.tenantId, feedToken.userId, dateFrom, dateTo, privacyMode);
    const payload = this.buildAppleCalendarIcs(events, feedToken.tenantId, privacyMode);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Disposition", "inline; filename=\"gestionale-fermi-apple.ics\"");
    res.send(payload);
  };

  appleCalendarImport = async (req: Request, res: Response) => {
    const input = appleCalendarImportSchema.parse(req.body ?? {});
    const dateFrom = input.dateFrom ? new Date(input.dateFrom) : new Date(Date.now() - 30 * 86400000);
    const dateTo = input.dateTo ? new Date(input.dateTo) : new Date(Date.now() + 30 * 86400000);

    const feedPayload = await this.fetchText(input.feedUrl);
    const parsedEvents = this.parseIcsEvents(feedPayload).filter((event) => {
      if (event.uid.includes("@gestionefermi.local")) return false;
      return event.endAt >= dateFrom && event.startAt <= dateTo;
    });

    const existingRows = await prisma.calendarEvent.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        startAt: { lte: dateTo },
        endAt: { gte: dateFrom },
        description: { contains: APPLE_SYNC_MARKER_PREFIX }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });

    const existingByAppleUid = new Map<string, (typeof existingRows)[number]>();
    for (const row of existingRows) {
      const appleUid = this.parseSyncMetadata(row.description ?? "").appleUid;
      if (!appleUid || existingByAppleUid.has(appleUid)) continue;
      existingByAppleUid.set(appleUid, row);
    }

    let imported = 0;
    let updated = 0;
    for (const parsed of parsedEvents) {
      const markedDescription = this.buildMarkedDescription(parsed.description, { appleUid: parsed.uid });
      const existing = existingByAppleUid.get(parsed.uid);
      if (existing) {
        await prisma.calendarEvent.update({
          where: { id: existing.id },
          data: {
            title: this.redactSensitiveText(parsed.title),
            description: markedDescription,
            location: parsed.location || null,
            startAt: parsed.startAt,
            endAt: parsed.endAt,
            allDay: parsed.allDay
          }
        });
        updated += 1;
      } else {
        await prisma.calendarEvent.create({
          data: {
            tenantId: req.auth!.tenantId,
            userId: req.auth!.userId,
            title: this.redactSensitiveText(parsed.title),
            description: markedDescription,
            location: parsed.location || null,
            startAt: parsed.startAt,
            endAt: parsed.endAt,
            allDay: parsed.allDay,
            attendees: [] as any,
            reminder: 30,
            visibility: "default",
            availability: "BUSY",
            type: "EVENT",
            color: "#1a73e8",
            calendarId: "personal"
          }
        });
        imported += 1;
      }
    }

    res.json({
      data: {
        imported,
        updated,
        scanned: parsedEvents.length
      }
    });
  };

  googleCalendarSync = async (req: Request, res: Response) => {
    const input = googleCalendarSyncInputSchema.parse(req.body ?? {});
    const dateFrom = input.dateFrom ? new Date(input.dateFrom) : new Date(Date.now() - 30 * 86400000);
    const dateTo = input.dateTo ? new Date(input.dateTo) : new Date(Date.now() + 30 * 86400000);
    const privacyMode = input.privacy ?? "masked";

    const stateToken = this.issueGoogleCalendarStateToken({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      privacy: privacyMode
    });
    const authUrl = this.buildGoogleCalendarAuthUrl(stateToken);
    const connection = await this.loadGoogleCalendarConnection(req.auth!.tenantId, req.auth!.userId);

    if (!connection) {
      return res.json({
        data: {
          requiresOAuth: true,
          authUrl
        }
      });
    }

    try {
      const refreshed = await this.refreshGoogleCalendarAccessToken(connection.refreshToken);
      const sync = await this.syncGoogleCalendarEvents(
        req.auth!.tenantId,
        req.auth!.userId,
        refreshed.accessToken,
        dateFrom,
        dateTo,
        privacyMode
      );

      return res.json({
        data: {
          requiresOAuth: false,
          synced: sync.synced,
          pushed: sync.pushed,
          imported: sync.imported,
          updated: sync.updated,
          removed: sync.removed,
          accountEmail: connection.accountEmail,
          calendarUrl: "https://calendar.google.com/calendar/u/0/r"
        }
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "GOOGLE_TOKEN_REFRESH_FAILED") {
        await this.clearGoogleCalendarConnection(req.auth!.tenantId, req.auth!.userId);
        return res.json({
          data: {
            requiresOAuth: true,
            authUrl
          }
        });
      }
      throw error;
    }
  };

  googleCalendarCallback = async (req: Request, res: Response) => {
    const query = googleCalendarCallbackQuerySchema.parse(req.query);
    if (query.error) {
      const html = this.buildGoogleCalendarCallbackHtml({
        status: "error",
        message: query.error_description || "Autorizzazione Google annullata"
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    }

    if (!query.code || !query.state) {
      const html = this.buildGoogleCalendarCallbackHtml({
        status: "error",
        message: "Dati callback Google non validi"
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    }

    try {
      const state = this.readGoogleCalendarStateToken(query.state);
      const exchanged = await this.exchangeGoogleCalendarCode(query.code);
      const existingConnection = await this.loadGoogleCalendarConnection(state.tenantId, state.userId);
      const refreshToken = exchanged.refreshToken ?? existingConnection?.refreshToken ?? "";

      if (!refreshToken) {
        throw new AppError(
          "Google non ha restituito un refresh token. Riprova forzando consenso account.",
          400,
          "GOOGLE_REFRESH_TOKEN_MISSING"
        );
      }

      const accountEmail = await this.fetchGoogleCalendarAccountEmail(exchanged.accessToken).catch(
        () => existingConnection?.accountEmail ?? null
      );

      await this.saveGoogleCalendarConnection(state.tenantId, state.userId, {
        refreshToken,
        accountEmail,
        scope: exchanged.scope ?? existingConnection?.scope ?? null
      });

      const sync = await this.syncGoogleCalendarEvents(
        state.tenantId,
        state.userId,
        exchanged.accessToken,
        new Date(state.dateFrom),
        new Date(state.dateTo),
        state.privacy
      );

      const html = this.buildGoogleCalendarCallbackHtml({
        status: "success",
        synced: sync.synced,
        pushed: sync.pushed,
        imported: sync.imported,
        updated: sync.updated,
        removed: sync.removed,
        accountEmail
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    } catch (error) {
      const html = this.buildGoogleCalendarCallbackHtml({
        status: "error",
        message: error instanceof Error ? error.message : "Connessione Google Calendar non riuscita"
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    }
  };

  reminderTemplatePreview = async (req: Request, res: Response) => {
    const query = z.object({ channel: z.enum(["EMAIL", "WHATSAPP"]).default("EMAIL") }).parse(req.query);
    const stoppage = (await this.useCases.getById(req.auth!.tenantId, req.params.id)) as any;
    if (!stoppage) throw new AppError("Fermo non trovato", 404, "NOT_FOUND");
    const days = Math.floor((Date.now() - new Date(stoppage.openedAt).getTime()) / 86400000);
    const base = `Targa: ${stoppage.vehicle.plate}\nVeicolo: ${stoppage.vehicle.brand} ${stoppage.vehicle.model}\nSede: ${stoppage.site.name}\nMotivo: ${stoppage.reason}\nGiorni fermo: ${days}\nStato: ${stoppageStatusLabel(stoppage.status)}`;
    const email = {
      subject: `[Sollecito] ${stoppage.vehicle.plate} - ${stoppage.site.name}`,
      body: `Buongiorno,\n\nsi richiede aggiornamento sul seguente fermo:\n${base}\n\nGrazie.`
    };
    const whatsapp = {
      message: `Richiesta aggiornamento fermo\n${base}\n\nGrazie.`,
      url: `https://wa.me/${String(stoppage.workshopWhatsappSnapshot || stoppage.workshop?.whatsapp || "").replace(/\D/g, "")}?text=${encodeURIComponent(`Richiesta aggiornamento fermo\n${base}\n\nGrazie.`)}`
    };
    res.json({ channel: query.channel, email, whatsapp });
  };

  costsSummary = async (req: Request, res: Response) => {
    const query = z
      .object({
        dateFrom: optionalDateTimeQuery,
        dateTo: optionalDateTimeQuery
      })
      .parse(req.query);
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 90 * 86400000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date();
    const rows = await this.opsRepository.listCostRows(req.auth!.tenantId, dateFrom, dateTo);
    const bySite = new Map<string, number>();
    const byWorkshop = new Map<string, number>();
    const now = new Date();
    let total = 0;
    for (const row of rows) {
      const days = Math.max(0, (Number((row.closedAt ?? now)) - Number(row.openedAt)) / 86400000);
      const cost = (row.estimatedCostPerDay ?? 0) * days;
      total += cost;
      bySite.set(row.site.name, (bySite.get(row.site.name) ?? 0) + cost);
      byWorkshop.set(row.workshop.name, (byWorkshop.get(row.workshop.name) ?? 0) + cost);
    }
    res.json({
      kpis: { estimatedTotalCost: Number(total.toFixed(2)) },
      bySite: Array.from(bySite.entries()).map(([name, cost]) => ({ name, cost: Number(cost.toFixed(2)) })).sort((a, b) => b.cost - a.cost),
      byWorkshop: Array.from(byWorkshop.entries()).map(([name, cost]) => ({ name, cost: Number(cost.toFixed(2)) })).sort((a, b) => b.cost - a.cost)
    });
  };

  costsVariance = async (req: Request, res: Response) => {
    const query = z
      .object({
        dateFrom: optionalDateTimeQuery,
        dateTo: optionalDateTimeQuery
      })
      .parse(req.query);
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 180 * 86400000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date();

    const rows = await prisma.stoppage.findMany({
      where: { tenantId: req.auth!.tenantId, deletedAt: null, openedAt: { gte: dateFrom, lte: dateTo } },
      include: {
        site: { select: { name: true } },
        workshop: { select: { name: true } },
        vehicle: { select: { plate: true, brand: true, model: true } },
        events: { where: { type: "FINAL_COST" }, orderBy: { createdAt: "desc" }, take: 1 }
      }
    });

    const now = new Date();
    const data = rows
      .map((row) => {
        const days = Math.max(0, (Number((row.closedAt ?? now)) - Number(row.openedAt)) / 86400000);
        const estimated = Number(((row.estimatedCostPerDay ?? 0) * days).toFixed(2));
        const actual = Number((asObject<FinalCostPayload>(row.events[0]?.payload).actualTotalCost ?? 0).toFixed(2));
        const variance = Number((actual - estimated).toFixed(2));
        const varianceRate = estimated > 0 ? Number(((variance / estimated) * 100).toFixed(2)) : 0;
        return {
          stoppageId: row.id,
          plate: row.vehicle.plate,
          vehicle: `${row.vehicle.brand} ${row.vehicle.model}`,
          site: row.site.name,
          workshop: row.workshop.name,
          status: row.status,
          estimated,
          actual,
          variance,
          varianceRate
        };
      })
      .filter((x) => x.actual > 0)
      .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

    const kpis = {
      totalWithConsuntivo: data.length,
      estimatedTotal: Number(data.reduce((acc, x) => acc + x.estimated, 0).toFixed(2)),
      actualTotal: Number(data.reduce((acc, x) => acc + x.actual, 0).toFixed(2)),
      varianceTotal: Number(data.reduce((acc, x) => acc + x.variance, 0).toFixed(2)),
      avgVarianceRate: data.length ? Number((data.reduce((acc, x) => acc + x.varianceRate, 0) / data.length).toFixed(2)) : 0
    };

    res.json({ kpis, data: data.slice(0, 100) });
  };

  listPartsOrders = async (req: Request, res: Response) => {
    const data = await this.opsRepository.listEventsByType(req.auth!.tenantId, req.params.id, "PARTS_ORDER");
    const parsed = data.map((x) => {
      const payload = asObject<PartsOrderPayload>(x.payload);
      const etaDate = payload.etaDate ? new Date(payload.etaDate) : null;
      const etaRisk = etaDate ? Math.floor((Date.now() - etaDate.getTime()) / 86400000) : null;
      return {
        id: x.id,
        createdAt: x.createdAt,
        ...payload,
        etaRiskDays: etaRisk !== null ? Math.max(0, etaRisk) : null
      };
    });
    res.json({ data: parsed });
  };

  addPartsOrder = async (req: Request, res: Response) => {
    const payload = z
      .object({
        description: z.string().min(2),
        supplier: z.string().optional(),
        etaDate: z.string().optional(),
        estimatedCost: z.number().optional()
      })
      .parse(req.body);
    await this.opsRepository.createEvent({
      tenantId: req.auth!.tenantId,
      stoppageId: req.params.id,
      userId: req.auth?.userId,
      type: "PARTS_ORDER",
      message: `Ordine ricambio: ${payload.description}`,
      payload
    });
    res.status(201).json({ created: true });
  };

  getClosureChecklist = async (req: Request, res: Response) => {
    const row = await this.opsRepository.findLatestEventByType(req.auth!.tenantId, req.params.id, "CLOSURE_CHECKLIST");
    res.json({ data: row?.payload ?? null });
  };

  saveClosureChecklist = async (req: Request, res: Response) => {
    const payload = z
      .object({
        photosUploaded: z.boolean(),
        finalCauseSet: z.boolean(),
        finalCostSet: z.boolean(),
        operatorSigned: z.boolean(),
        notes: z.string().optional()
      })
      .parse(req.body);
    await this.opsRepository.createEvent({
      tenantId: req.auth!.tenantId,
      stoppageId: req.params.id,
      userId: req.auth?.userId,
      type: "CLOSURE_CHECKLIST",
      message: "Checklist chiusura aggiornata",
      payload
    });
    res.json({ updated: true });
  };

  setFinalCost = async (req: Request, res: Response) => {
    const payload = z.object({ actualTotalCost: z.number().nonnegative() }).parse(req.body);
    const threshold = 1500;
    if (payload.actualTotalCost >= threshold) {
      const latestDecision = await this.opsRepository.findLatestEventByType(req.auth!.tenantId, req.params.id, "COST_APPROVAL_DECISION");
      const decisionPayload = asObject<CostApprovalDecisionPayload>(latestDecision?.payload);
      const approved = Boolean(decisionPayload?.approved);
      if (!approved) {
        throw new AppError(
          `Serve approvazione costo per importi >= € ${threshold}. Richiedi approvazione prima del consuntivo.`,
          422,
          "COST_APPROVAL_REQUIRED"
        );
      }
    }
    await this.opsRepository.createEvent({
      tenantId: req.auth!.tenantId,
      stoppageId: req.params.id,
      userId: req.auth?.userId,
      type: "FINAL_COST",
      message: "Costo consuntivo impostato",
      payload
    });
    res.json({ updated: true });
  };

  listCostApprovals = async (req: Request, res: Response) => {
    const [requests, decisions] = await Promise.all([
      this.opsRepository.listEventsByType(req.auth!.tenantId, req.params.id, "COST_APPROVAL_REQUEST"),
      this.opsRepository.listEventsByType(req.auth!.tenantId, req.params.id, "COST_APPROVAL_DECISION")
    ]);
    res.json({
      requests: requests.map((x) => ({ id: x.id, createdAt: x.createdAt, ...asObject(x.payload) })),
      decisions: decisions.map((x) => ({ id: x.id, createdAt: x.createdAt, ...asObject(x.payload) }))
    });
  };

  requestCostApproval = async (req: Request, res: Response) => {
    const payload = z
      .object({
        estimatedTotalCost: z.number().nonnegative(),
        reason: z.string().min(3),
        note: z.string().optional()
      })
      .parse(req.body);
    await this.opsRepository.createEvent({
      tenantId: req.auth!.tenantId,
      stoppageId: req.params.id,
      userId: req.auth?.userId,
      type: "COST_APPROVAL_REQUEST",
      message: "Richiesta approvazione costo",
      payload
    });
    res.status(201).json({ created: true });
  };

  decideCostApproval = async (req: Request, res: Response) => {
    const payload = z
      .object({
        approved: z.boolean(),
        approvedCost: z.number().nonnegative().optional(),
        reason: z.string().optional()
      })
      .parse(req.body);
    await this.opsRepository.createEvent({
      tenantId: req.auth!.tenantId,
      stoppageId: req.params.id,
      userId: req.auth?.userId,
      type: "COST_APPROVAL_DECISION",
      message: payload.approved ? "Approvazione costo concessa" : "Approvazione costo rifiutata",
      payload
    });
    res.json({ updated: true });
  };

  bulkUpdate = async (req: Request, res: Response) => {
    const payload = z
      .object({
        ids: z.array(z.string().min(1)).min(1),
        action: z.enum(["SET_STATUS", "SET_PRIORITY", "SEND_REMINDER"]),
        status: stoppageSchema.shape.status.optional(),
        priority: stoppageSchema.shape.priority.optional()
      })
      .parse(req.body);

    const results: Array<{ id: string; ok: boolean; message?: string }> = [];

    for (const id of payload.ids) {
      try {
        if (payload.action === "SET_STATUS" && payload.status) {
          await this.useCases.update(req.auth!.tenantId, id, { status: payload.status });
          await this.logEvent(
            req.auth!.tenantId,
            id,
            req.auth?.userId,
            "BULK_STATUS",
            `Stato bulk: ${stoppageStatusLabel(payload.status)}`
          );
        }
        if (payload.action === "SET_PRIORITY" && payload.priority) {
          await this.useCases.update(req.auth!.tenantId, id, { priority: payload.priority });
          await this.logEvent(req.auth!.tenantId, id, req.auth?.userId, "BULK_PRIORITY", `Priorita bulk: ${payload.priority}`);
        }
        if (payload.action === "SEND_REMINDER") {
          await this.reminderUseCase.manualEmail(req.auth!.tenantId, id);
          await this.logEvent(req.auth!.tenantId, id, req.auth?.userId, "BULK_REMINDER", "Reminder bulk inviato");
        }
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, message: (error as Error).message });
      }
    }

    res.json({ data: results });
  };

  alerts = async (req: Request, res: Response) => {
    const rows = (await this.useCases.list(req.auth!.tenantId, { skip: 0, take: 500, sortDir: "desc" })) as StoppageListResponse;
    const now = new Date();

    const alerts = rows.data
      .filter(isActiveStoppage)
      .map((item) => {
        const days = Math.floor((now.getTime() - new Date(item.openedAt).getTime()) / 86400000);
        const severity = days > 10 ? "CRITICAL" : days > 5 ? "WARNING" : "INFO";
        return {
          id: item.id,
          severity,
          daysOpen: days,
          plate: item.vehicle?.plate,
          site: item.site?.name,
          workshop: item.workshop?.name,
          status: item.status,
          message: days > 10 ? "Fermo critico oltre 10 giorni" : days > 5 ? "Fermo oltre soglia attenzione" : "Fermo monitorato"
        };
      })
      .filter((alert) => alert.severity !== "INFO");

    res.json({ data: alerts.sort((a, b) => b.daysOpen - a.daysOpen) });
  };

  slaEscalations = async (req: Request, res: Response) => {
    const now = new Date();
    const rows = (await this.useCases.list(req.auth!.tenantId, { skip: 0, take: 1000, sortDir: "desc" })) as StoppageListResponse;
    const active = rows.data.filter(isActiveStoppage);
    const data = active
      .map<SlaEscalationRow>((item) => {
        const daysOpen = Math.floor((now.getTime() - new Date(item.openedAt).getTime()) / 86400000);
        const thresholdDays = getSlaThresholdForPriority(item.priority);
        const escalation = this.escalationLevel(daysOpen, thresholdDays);
        return {
          id: item.id,
          plate: item.vehicle?.plate,
          site: item.site?.name,
          workshop: item.workshop?.name,
          priority: item.priority,
          status: item.status,
          daysOpen,
          thresholdDays,
          escalation
        };
      })
      .filter((row): row is SlaEscalationRow & { escalation: EscalationLevel } => row.escalation !== null)
      .sort((a, b) => b.daysOpen - a.daysOpen);
    res.json({
      kpis: {
        level1: data.filter((x) => x.escalation === "LEVEL_1").length,
        level2: data.filter((x) => x.escalation === "LEVEL_2").length,
        level3: data.filter((x) => x.escalation === "LEVEL_3").length
      },
      data
    });
  };

  preventiveDue = async (req: Request, res: Response) => {
    const intervalDays = Number(req.query.intervalDays ?? 180);
    const kmWarning = Number(req.query.kmWarning ?? 500);
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId: req.auth!.tenantId, deletedAt: null, isActive: true },
      include: {
        site: { select: { name: true } },
        stoppages: { where: { deletedAt: null }, orderBy: { openedAt: "desc" }, take: 1, select: { openedAt: true } }
      }
    });
    const now = new Date();
    const data = vehicles
      .map((vehicle) => {
        const reference = vehicle.stoppages[0]?.openedAt ?? vehicle.createdAt;
        const daysFromReference = Math.floor((now.getTime() - reference.getTime()) / 86400000);
        const remaining = intervalDays - daysFromReference;
        const currentKm = (vehicle as any).currentKm ?? null;
        const intervalKm = (vehicle as any).maintenanceIntervalKm ?? null;
        const remainingKm = currentKm !== null && intervalKm !== null ? intervalKm - (currentKm % intervalKm) : null;
        return {
          vehicleId: vehicle.id,
          plate: vehicle.plate,
          brand: vehicle.brand,
          model: vehicle.model,
          site: vehicle.site.name,
          referenceDate: reference.toISOString(),
          intervalDays,
          remainingDays: remaining,
          dueByDays: remaining <= 0,
          currentKm,
          maintenanceIntervalKm: intervalKm,
          remainingKm,
          dueByKm: remainingKm !== null ? remainingKm <= 0 : false,
          dueSoonByKm: remainingKm !== null ? remainingKm > 0 && remainingKm <= kmWarning : false
        };
      })
      .filter((x) => x.remainingDays <= 30 || x.dueByKm || x.dueSoonByKm)
      .sort((a, b) => a.remainingDays - b.remainingDays);
    res.json({
      kpis: {
        dueNowDays: data.filter((x) => x.dueByDays).length,
        dueSoonDays: data.filter((x) => !x.dueByDays && x.remainingDays <= 15).length,
        dueNowKm: data.filter((x) => x.dueByKm).length,
        dueSoonKm: data.filter((x) => x.dueSoonByKm).length
      },
      data
    });
  };
}
