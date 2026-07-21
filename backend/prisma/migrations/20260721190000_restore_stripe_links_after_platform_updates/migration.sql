-- Platform license edits previously rewrote Stripe-managed subscriptions as local
-- and cleared their Stripe links. Recover only identifiers already received through
-- verified, successfully processed Stripe webhook events.
WITH customer_candidates AS (
  SELECT DISTINCT ON ("tenantId")
    "tenantId",
    CASE
      WHEN jsonb_typeof("payload" #> '{data,object,customer}') = 'string'
        THEN "payload" #>> '{data,object,customer}'
      WHEN jsonb_typeof("payload" #> '{data,object,customer}') = 'object'
        THEN "payload" #>> '{data,object,customer,id}'
      ELSE NULL
    END AS "stripeCustomerId"
  FROM "BillingEvent"
  WHERE "provider" = 'stripe'
    AND "status" = 'PROCESSED'
    AND "tenantId" IS NOT NULL
    AND (
      CASE
        WHEN jsonb_typeof("payload" #> '{data,object,customer}') = 'string'
          THEN "payload" #>> '{data,object,customer}'
        WHEN jsonb_typeof("payload" #> '{data,object,customer}') = 'object'
          THEN "payload" #>> '{data,object,customer,id}'
        ELSE NULL
      END
    ) LIKE 'cus_%'
  ORDER BY "tenantId", "createdAt" DESC
),
subscription_candidates AS (
  SELECT DISTINCT ON ("tenantId")
    "tenantId",
    CASE
      WHEN "payload" #>> '{data,object,object}' = 'subscription'
        THEN "payload" #>> '{data,object,id}'
      WHEN jsonb_typeof("payload" #> '{data,object,subscription}') = 'string'
        THEN "payload" #>> '{data,object,subscription}'
      WHEN jsonb_typeof("payload" #> '{data,object,subscription}') = 'object'
        THEN "payload" #>> '{data,object,subscription,id}'
      ELSE NULL
    END AS "stripeSubscriptionId"
  FROM "BillingEvent"
  WHERE "provider" = 'stripe'
    AND "status" = 'PROCESSED'
    AND "tenantId" IS NOT NULL
    AND (
      CASE
        WHEN "payload" #>> '{data,object,object}' = 'subscription'
          THEN "payload" #>> '{data,object,id}'
        WHEN jsonb_typeof("payload" #> '{data,object,subscription}') = 'string'
          THEN "payload" #>> '{data,object,subscription}'
        WHEN jsonb_typeof("payload" #> '{data,object,subscription}') = 'object'
          THEN "payload" #>> '{data,object,subscription,id}'
        ELSE NULL
      END
    ) LIKE 'sub_%'
  ORDER BY "tenantId", "createdAt" DESC
)
UPDATE "TenantSubscription" AS subscription
SET
  "provider" = 'stripe',
  "stripeCustomerId" = COALESCE(subscription."stripeCustomerId", customer_candidates."stripeCustomerId"),
  "stripeSubscriptionId" = COALESCE(subscription."stripeSubscriptionId", subscription_candidates."stripeSubscriptionId"),
  "updatedAt" = CURRENT_TIMESTAMP
FROM customer_candidates
LEFT JOIN subscription_candidates
  ON subscription_candidates."tenantId" = customer_candidates."tenantId"
WHERE subscription."tenantId" = customer_candidates."tenantId"
  AND subscription."provider" = 'local'
  AND customer_candidates."stripeCustomerId" IS NOT NULL;
