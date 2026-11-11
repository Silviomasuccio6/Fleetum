import assert from "node:assert/strict";
import {test} from "node:test";
import {legacySiteCommandReason,hasAcceptedSiteCommandReceipt} from "../src/infrastructure/email/site-access-legacy.js";
for(const type of ["BOOKING_CONTRACT","RENTAL_EXTRA_CHARGE_NOTICE","SCHEDULED_REPORT"]){
  test(`${type} requires explicit authorization metadata`,()=>assert.equal(legacySiteCommandReason(type,{}),"SITE_LEGACY_REVIEW_REQUIRED"));
}
test("manual retries remain manual and cannot inherit worker authority",()=>{for(const reminderType of["MANUAL","MANUAL_RETRY"])assert.equal(legacySiteCommandReason("REMINDER_EMAIL",{reminderType}),"SITE_LEGACY_REVIEW_REQUIRED");});
test("system reminders and unrelated account/invoice commands keep their separate guards",()=>{for(const reminderType of["AUTOMATIC","AUTOMATIC_RETRY","ESCALATION"])assert.equal(legacySiteCommandReason("REMINDER_EMAIL",{reminderType}),null);for(const type of["SAAS_INVOICE_EMAIL","PASSWORD_RESET","USER_INVITE"])assert.equal(legacySiteCommandReason(type,{}),null);});
test("a present invalid authority is not silently converted to a legacy grant",()=>{assert.equal(legacySiteCommandReason("BOOKING_CONTRACT",{siteAuthorization:null}),null);assert.equal(legacySiteCommandReason("SCHEDULED_REPORT",{companyReportAuthorization:null}),null);});
test("only a nonempty persisted provider receipt excludes a pending row from reconciliation",()=>{assert.equal(hasAcceptedSiteCommandReceipt({emailProvider:"resend",providerMessageId:"synthetic-accepted"}),true);for(const value of[null,{}, {emailProvider:"resend",providerMessageId:" "},{emailProvider:"console",providerMessageId:"synthetic"}])assert.equal(hasAcceptedSiteCommandReceipt(value),false);});
