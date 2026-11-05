import assert from "node:assert/strict";
import test from "node:test";
import {rentalTermsSchema,rentalTermsIssues} from "../src/application/services/contract-rental-terms.js";

import {syntheticTerms} from "./helpers/contract-rental-terms.js";
import {driverIssues} from "../src/application/services/contract-rental-drivers.js";
import {defaultContractTemplate} from "../src/application/services/booking-contract-service.js";

test("rental conditions retain integer cents and distinguish unspecified from zero",()=>{
 assert.equal(rentalTermsSchema.parse({...syntheticTerms,depositCents:0}).depositCents,0);
 assert.equal(rentalTermsSchema.parse({...syntheticTerms,depositCents:null}).depositCents,null);
 for(const amount of [-1,1.5,Number.MAX_SAFE_INTEGER])assert.equal(rentalTermsSchema.safeParse({...syntheticTerms,depositCents:amount}).success,false);
 assert.ok(rentalTermsIssues({...syntheticTerms,depositCents:null}).some(x=>x.includes("Cauzione")));
});
test("driver IDs must be distinct and malformed or excessive conditions are rejected",()=>{
 for(const data of [{...syntheticTerms,additionalDriverIds:[syntheticTerms.primaryDriverId]},{...syntheticTerms,additionalDriverIds:["x","x"]},{...syntheticTerms,paymentTerms:"x".repeat(4001)},{...syntheticTerms,unexpected:true}])assert.equal(rentalTermsSchema.safeParse(data).success,false);
 assert.deepEqual(rentalTermsIssues(syntheticTerms),[]);
 assert.ok(rentalTermsIssues(null).length>0);
});
test("identity expiry is inclusive of the return date in Rome, without assuming insurance eligibility",()=>{
 const driver:any={firstName:"Anna",lastName:"Test",dateOfBirth:new Date("1990-01-01"),residenceAddress:"Synthetic address",documentNumber:"TESTDOC",drivingLicenseNumber:"TESTLICENCE",drivingLicenseCategory:"B",documentExpiresAt:new Date("2030-11-05"),drivingLicenseExpiresAt:new Date("2030-11-05")};
 assert.deepEqual(driverIssues([driver],new Date("2030-11-05T17:00:00Z")),[]);
 assert.equal(driverIssues([driver],new Date("2030-11-06T09:00:00Z")).length,2);
 assert.ok(driverIssues([{...driver,drivingLicenseNumber:null}],new Date("2030-11-05T17:00:00Z")).some(value=>value.includes("identità")));
});
test("default contract separates designated drivers from corporate signers and does not claim qualified OTP",()=>{
 const content=defaultContractTemplate().content;
 assert.ok(content.includes("non sono automaticamente autorizzati alla guida"));
 assert.ok(content.includes("non è descritta come firma qualificata o avanzata"));
 assert.ok(content.includes("specifica approvazione"));
});
