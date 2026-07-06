-- Add checkout-to-trial funnel event for first-party Platform Analytics.
ALTER TYPE "WebsiteEventType" ADD VALUE IF NOT EXISTS 'TRIAL_ACTIVATED';
