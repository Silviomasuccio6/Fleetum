import multer from "multer";
import rateLimit from "express-rate-limit";
import {cargosReceiptService} from "../../../application/services/cargos-receipt-service.js";
import {siteAccessForTenant} from "../../../infrastructure/auth/site-access-context.js";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { ContractCargosService, sealCargosCredentials, cargosStorageReady } from "../../../application/services/contract-cargos-service.js";
import { CARGOS_FIELDS } from "../../../application/services/cargos-protocol.js";
import { assertCompanyResourceView } from "../../../infrastructure/auth/company-resource-access.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

const agency=z.object({id:z.string().trim().min(1).max(30),name:z.string().trim().min(1).max(70),placeCode:z.string().regex(/^\d{9}$/),address:z.string().trim().min(4).max(150),phone:z.string().regex(/^\d{4,20}$/)}).strict();
const configuration=z.object({enabled:z.boolean(),credentials:z.object({username:z.string().trim().min(1).max(100).refine(v=>!v.includes(":")&&!/[\u0000-\u001f\u007f]/u.test(v)),password:z.string().min(1).max(300),apiKey:z.string().regex(/^[\x21-\x7e]{48,256}$/)}).strict().optional(),agencies:z.record(z.string().min(1).max(100),agency).refine(v=>Object.keys(v).length<=100)}).strict();
const draft=z.object({record:z.record(z.string().max(100),z.string().max(150)).refine(v=>Object.keys(v).every(key=>CARGOS_FIELDS.some(f=>f.key===key)))}).strict();
const actor=(req:Request)=>{if(!req.auth?.tenantId||!req.auth.userId)throw new AppError("Accesso richiesto",401,"UNAUTHORIZED");return{tenantId:req.auth.tenantId,userId:req.auth.userId};};
const administrator=(req:Request)=>{const result=actor(req);if(!req.auth!.roles.includes("ADMIN"))throw new AppError("Operazione riservata all'amministratore aziendale",403,"FORBIDDEN");assertCompanyResourceView(result.tenantId);return result;};
export const contractCargosRoutes=(service=new ContractCargosService())=>{
 const router=Router();
 const canManage=(req:Request)=>{const scope=siteAccessForTenant(req.auth!.tenantId!);return req.auth!.roles.includes("ADMIN")&&(!scope||scope.canViewAllSites&&scope.allSites);};
 const decorated=(req:Request,value:object)=>({...value,canManageReceipts:canManage(req)});
 const precheckLimit=rateLimit({windowMs:60000,max:10,keyGenerator:req=>`${req.auth!.tenantId}:${req.auth!.userId}:${req.params.id}`,standardHeaders:true,legacyHeaders:false});
 const receiptUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:6,parts:7,fieldSize:1024}}).single("file");
 router.use((_req,res,next)=>{res.setHeader("Cache-Control","private, no-store");next();});
 router.get("/:id/cargos/history",requirePermissions("vehicles:read"),asyncHandler(async(req,res)=>{
  const a=actor(req),query=z.object({cursor:z.string().min(1).max(100).optional()}).strict().parse(req.query);res.json(await service.history(a.tenantId,req.params.id,query.cursor));
 }));
 router.post("/:id/cargos/check",requirePermissions("vehicles:write"),precheckLimit,asyncHandler(async(req,res)=>{
  const a=actor(req),input=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
  res.json(decorated(req,await service.validate(a.tenantId,req.params.id,a.userId,input.sourceHash)));
 }));
 router.post("/:id/cargos/receipts",requirePermissions("vehicles:write"),(req,_res,next)=>{try{administrator(req);next();}catch(error){next(error);}},precheckLimit,receiptUpload,asyncHandler(async(req,res)=>{
  const a=administrator(req),key=z.string().uuid().parse(req.headers["x-idempotency-key"]);
  const input=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),transactionId:z.string().trim().min(1).max(250).refine(value=>!/[\u0000-\u001f\u007f]/u.test(value)),protocol:z.string().trim().min(1).max(100).refine(value=>!/[\u0000-\u001f\u007f]/u.test(value)),receiptDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+"T00:00:00Z");return!Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value&&date.getTime()<=Date.now();}),kind:z.enum(["ARCHIVE","CONFIRM_PORTAL"]),verifiedOnPortal:z.literal("true")}).strict().parse(req.body);
  if(!req.file||req.file.mimetype!=="application/pdf")throw new AppError("Allega la ricevuta PDF scaricata dal portale",422,"CARGOS_RECEIPT_REQUIRED");
  res.status(201).json(decorated(req,await cargosReceiptService.save(a.tenantId,req.params.id,a.userId,{...input,verifiedOnPortal:true,idempotencyKey:key},req.file.buffer)));
 }));
 router.get("/:id/cargos/receipts/:receiptId/pdf",requirePermissions("vehicles:read"),asyncHandler(async(req,res)=>{
  const a=administrator(req),receiptId=z.string().uuid().parse(req.params.receiptId);
  const bytes=await cargosReceiptService.download(a.tenantId,req.params.id,a.userId,receiptId);
  res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",'attachment; filename="Ricevuta_CARGOS.pdf"');res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Content-Security-Policy","sandbox");res.send(bytes);
 }));
 router.get("/cargos/configuration",requirePermissions("vehicles:read"),asyncHandler(async(req,res)=>{
  const{tenantId}=administrator(req);const row=await prisma.tenantCargosConnection.findUnique({where:{tenantId}});
  res.json({encryptionReady:cargosStorageReady(),enabled:row?.enabled??false,credentialsPresent:Boolean(row?.credentialsEncrypted),agencies:row?.agencies??{}});
 }));
 router.patch("/cargos/configuration",requirePermissions("vehicles:write"),asyncHandler(async(req,res)=>{
  const{tenantId}=administrator(req);if(!cargosStorageReady())throw new AppError("Collegamento CARGOS da predisporre in sicurezza",503,"CARGOS_STORAGE_UNAVAILABLE");const input=configuration.parse(req.body);const siteIds=Object.keys(input.agencies);
  if(input.enabled&&!siteIds.length)throw new AppError("Configura almeno una sede",400,"CARGOS_AGENCY_REQUIRED");
  const sites=await prisma.site.count({where:{id:{in:siteIds},tenantId,isActive:true,deletedAt:null}});if(sites!==siteIds.length)throw new AppError("Una sede non è disponibile",400,"CARGOS_AGENCY_INVALID");
  const previous=await prisma.tenantCargosConnection.findUnique({where:{tenantId}});
  if(!previous&&!input.credentials)throw new AppError("Inserisci le credenziali CARGOS dell'azienda",400,"CARGOS_CREDENTIALS_REQUIRED");
  const encrypted=input.credentials?sealCargosCredentials(tenantId,input.credentials):previous!.credentialsEncrypted;
  await prisma.tenantCargosConnection.upsert({where:{tenantId},create:{tenantId,enabled:input.enabled,agencies:input.agencies,credentialsEncrypted:encrypted},update:{enabled:input.enabled,agencies:input.agencies,credentialsEncrypted:encrypted}});
  res.json({encryptionReady:true,enabled:input.enabled,credentialsPresent:true,agencies:input.agencies});
 }));
 router.get("/:id/cargos",requirePermissions("vehicles:read"),asyncHandler(async(req,res)=>{const a=actor(req);res.json(decorated(req,await service.preflight(a.tenantId,req.params.id,a.userId)));}));
 router.patch("/:id/cargos/draft",requirePermissions("vehicles:write"),asyncHandler(async(req,res)=>{const a=actor(req);res.json(decorated(req,await service.saveDraft(a.tenantId,req.params.id,a.userId,draft.parse(req.body).record)));}));
 router.post("/:id/cargos/transmit",requirePermissions("vehicles:write"),asyncHandler(async(req,res)=>{
  const a=actor(req);const input=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);res.json(await service.transmit(a.tenantId,req.params.id,a.userId,input.sourceHash));
 }));
 return router;
};
