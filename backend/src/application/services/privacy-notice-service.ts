import { prisma } from "../../infrastructure/database/prisma/client.js";

const ACTIVE_NOTICE = {
  version: "2026-05-05",
  title: "Informativa privacy gestionale",
  summary:
    "Informativa applicativa su dati clienti, conducenti, contratti, documenti, allegati, booking, manutenzioni e log di sicurezza.",
  publishedAt: new Date("2026-05-05T00:00:00.000Z"),
  content: [
    "Il gestionale tratta dati anagrafici, contatti, dati fiscali, prenotazioni, contratti, firme, patente, documenti, allegati, dati veicolo, log tecnici e audit di sicurezza.",
    "I dati sono usati per gestire noleggi, contratti, clienti, veicoli, manutenzioni, scadenze, comunicazioni operative, sicurezza applicativa e obblighi amministrativi.",
    "I dati vengono conservati per il tempo necessario alle finalita operative, contrattuali, fiscali e di sicurezza. I tempi definitivi devono essere validati dal titolare/DPO.",
    "Gli interessati possono richiedere accesso, rettifica, cancellazione, limitazione, portabilita e opposizione secondo la normativa applicabile."
  ].join("\n\n")
};

export class PrivacyNoticeService {
  async ensureActiveNotice() {
    await prisma.privacyNotice.updateMany({
      where: { isActive: true, version: { not: ACTIVE_NOTICE.version } },
      data: { isActive: false }
    });

    return prisma.privacyNotice.upsert({
      where: { version: ACTIVE_NOTICE.version },
      create: { ...ACTIVE_NOTICE, isActive: true },
      update: { ...ACTIVE_NOTICE, isActive: true }
    });
  }

  async getCurrentForUser(tenantId?: string, userId?: string) {
    const notice = await this.ensureActiveNotice();
    const acceptance =
      tenantId && userId
        ? await prisma.privacyAcceptance.findUnique({
            where: { tenantId_userId_version: { tenantId, userId, version: notice.version } },
            select: { acceptedAt: true, source: true }
          })
        : null;

    return {
      notice: {
        id: notice.id,
        version: notice.version,
        title: notice.title,
        summary: notice.summary,
        content: notice.content,
        publishedAt: notice.publishedAt.toISOString()
      },
      accepted: Boolean(acceptance),
      acceptedAt: acceptance?.acceptedAt?.toISOString() ?? null,
      source: acceptance?.source ?? null
    };
  }

  async accept(input: {
    tenantId: string;
    userId: string;
    source?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const notice = await this.ensureActiveNotice();
    const acceptance = await prisma.privacyAcceptance.upsert({
      where: {
        tenantId_userId_version: {
          tenantId: input.tenantId,
          userId: input.userId,
          version: notice.version
        }
      },
      create: {
        tenantId: input.tenantId,
        userId: input.userId,
        noticeId: notice.id,
        version: notice.version,
        source: input.source ?? "banner",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        acceptedAt: new Date()
      },
      update: {
        source: input.source ?? "banner",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        acceptedAt: new Date()
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: "PRIVACY_NOTICE_ACCEPTED",
        resource: "PrivacyNotice",
        resourceId: notice.id,
        details: {
          version: notice.version,
          acceptanceId: acceptance.id,
          source: acceptance.source,
          acceptedAt: acceptance.acceptedAt.toISOString()
        }
      }
    });

    return {
      accepted: true,
      version: notice.version,
      acceptedAt: acceptance.acceptedAt.toISOString()
    };
  }
}

