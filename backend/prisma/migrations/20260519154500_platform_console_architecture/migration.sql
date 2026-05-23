CREATE TYPE "WebsiteEventType" AS ENUM (
  'PAGE_VIEW',
  'CTA_CLICK',
  'DEMO_FORM_VIEW',
  'DEMO_FORM_SUBMIT',
  'SIGNUP_VIEW',
  'SIGNUP_STARTED',
  'SIGNUP_COMPLETED',
  'LOGIN_CLICK',
  'PRICING_VIEW'
);

CREATE TYPE "DemoLeadStatus" AS ENUM (
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'WON',
  'LOST',
  'SPAM'
);

CREATE TABLE "WebsiteEvent" (
  "id" TEXT NOT NULL,
  "eventType" "WebsiteEventType" NOT NULL,
  "path" TEXT NOT NULL,
  "referrer" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "deviceType" TEXT,
  "browser" TEXT,
  "country" TEXT,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "sessionId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebsiteEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemoLead" (
  "id" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "fleetSize" TEXT,
  "message" TEXT,
  "source" TEXT NOT NULL DEFAULT 'fleetum.it',
  "status" "DemoLeadStatus" NOT NULL DEFAULT 'NEW',
  "referrer" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "emailQueueId" TEXT,
  "emailDeliveryStatus" TEXT,
  "contactedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DemoLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteEvent_eventType_createdAt_idx" ON "WebsiteEvent"("eventType", "createdAt");
CREATE INDEX "WebsiteEvent_path_createdAt_idx" ON "WebsiteEvent"("path", "createdAt");
CREATE INDEX "WebsiteEvent_createdAt_idx" ON "WebsiteEvent"("createdAt");

CREATE INDEX "DemoLead_status_createdAt_idx" ON "DemoLead"("status", "createdAt");
CREATE INDEX "DemoLead_email_idx" ON "DemoLead"("email");
CREATE INDEX "DemoLead_createdAt_idx" ON "DemoLead"("createdAt");
