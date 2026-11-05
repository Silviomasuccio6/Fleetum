import type {Prisma} from "@prisma/client";
import {prisma} from "../../infrastructure/database/prisma/client.js";
import {AppError} from "../../shared/errors/app-error.js";
import {rentalTermsSchema} from "./contract-rental-terms.js";
export async function resolveContractDrivers(tenantId:string,raw:unknown,db:Prisma.TransactionClient=prisma,strict=true){
 const parsed=rentalTermsSchema.safeParse(raw);if(!parsed.success)return[];
 const ids=[parsed.data.primaryDriverId,...parsed.data.additionalDriverIds].filter((id):id is string=>Boolean(id));
 if(!ids.length)return[];
 const people=await db.rentalCustomer.findMany({where:{tenantId,id:{in:ids},deletedAt:null,customerType:"PERSONA_FISICA"}});
 if(strict&&people.length!==ids.length)throw new AppError("Conducente non disponibile nell’anagrafica dell’azienda",422,"CONTRACT_DRIVER_UNAVAILABLE");
 return ids.map(id=>people.find(person=>person.id===id)).filter((person):person is typeof people[number]=>Boolean(person));
}
export function driverIssues(drivers:Awaited<ReturnType<typeof resolveContractDrivers>>,returnAt:Date){
 return drivers.flatMap((driver,index)=>{
  const day=(value:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
  const prefix=index===0?"Conducente principale":"Conducente aggiuntivo",issues:string[]=[];
  if(!driver.firstName.trim()||!driver.lastName.trim()||!driver.dateOfBirth||!driver.residenceAddress||!driver.documentNumber||!driver.drivingLicenseNumber||!driver.drivingLicenseCategory)issues.push(`${prefix}: completa identità, residenza, documento e patente in anagrafica`);
  if(!driver.drivingLicenseExpiresAt||day(driver.drivingLicenseExpiresAt)<day(returnAt))issues.push(`${prefix}: verifica la validità della patente fino al rientro`);
  if(!driver.documentExpiresAt||day(driver.documentExpiresAt)<day(returnAt))issues.push(`${prefix}: verifica la validità del documento fino al rientro`);
  return issues;
 });
}
