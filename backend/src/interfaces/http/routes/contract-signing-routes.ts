import {Router,type Request,type Response} from "express";
import rateLimit from "express-rate-limit";
import {z} from "zod";
import crypto from "node:crypto";
import {contractSigningService,type ContractSigningService} from "../../../application/services/contract-signing-service.js";
import {env} from "../../../shared/config/env.js";
import {AppError} from "../../../shared/errors/app-error.js";
import {requirePermissions} from "../middlewares/permissions.js";
import {getCookieValue} from "../utils/auth-cookies.js";
import {asyncHandler} from "./async-handler.js";
const token=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const documentHash=z.string().regex(/^[a-f0-9]{64}$/);
const secure=()=>env.NODE_ENV==="production";
export const signingCookieName=(id:string)=>`${secure()?"__Host-":""}fleetum_sign_${crypto.createHash("sha256").update(id).digest("hex").slice(0,20)}`;
const cookieOptions=()=>({httpOnly:true,secure:secure(),sameSite:"strict" as const,path:"/",maxAge:30*60*1000});
const actor=(req:Request)=>{if(!req.auth?.tenantId||!req.auth.userId)throw new AppError("Accesso richiesto",401,"UNAUTHORIZED");return{tenantId:req.auth.tenantId,userId:req.auth.userId};};
const pdf=(res:Response,bytes:Buffer,name:string)=>{res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`attachment; filename="${name}"`);res.send(bytes);};
export const contractSigningPrivateRoutes=(service:ContractSigningService=contractSigningService)=>{
 const router=Router();
 router.post("/:id/contract/signing/in-person",requirePermissions("vehicles:write"),asyncHandler(async(req,res)=>{
  const a=actor(req);z.object({}).strict().parse(req.body);const key=z.string().min(8).max(128).parse(req.headers["x-idempotency-key"]);
  res.status(202).json(await service.issue(a.tenantId,req.params.id,a.userId,{method:"IN_PERSON",idempotencyKey:key}));
 }));
 router.post("/:id/contract/signing/in-person/document",requirePermissions("vehicles:write"),asyncHandler(async(req,res)=>{
  const a=actor(req);z.object({requestId:z.string().min(1)}).strict().parse(req.body);
  const value=await service.inPersonDocument(a.tenantId,req.params.id,a.userId,getCookieValue(req,signingCookieName(req.body.requestId))??"");
  res.cookie(signingCookieName(value.requestId),value.proof,cookieOptions());pdf(res,value.bytes,"Contratto_da_firmare.pdf");
 }));
 router.post("/:id/contract/signing/in-person/confirm",requirePermissions("vehicles:write"),asyncHandler(async(req,res)=>{
  const a=actor(req),input=z.object({requestId:z.string().min(1),documentHash,confirmationId:z.string().uuid(),signatureDataUrl:z.string().max(400000),consent:z.literal(true),consentVersion:z.literal("in-person-v1")}).strict().parse(req.body);
  res.json(await service.inPersonConfirm(a.tenantId,req.params.id,a.userId,input,getCookieValue(req,signingCookieName(input.requestId))??"",{ip:req.ip??"",userAgent:String(req.headers["user-agent"]??"").slice(0,1000)}));
 }));
 router.use((_req,res,next)=>{res.setHeader("Cache-Control","private, no-store");next();});
 router.get("/:id/contract/signing",requirePermissions("vehicles:read"),asyncHandler(async(req,res)=>{const a=actor(req);res.setHeader("Cache-Control","private, no-store");res.json(await service.status(a.tenantId,req.params.id));}));
 router.post("/:id/contract/signing",requirePermissions("vehicles:write"),asyncHandler(async(req,res)=>{
  const a=actor(req),body=z.object({recipient:z.string().trim().email().max(254).optional()}).strict().parse(req.body);
  const key=z.string().min(8).max(128).parse(req.headers["x-idempotency-key"]);res.status(202).json(await service.issue(a.tenantId,req.params.id,a.userId,{...body,idempotencyKey:key}));
 }));
 router.post("/:id/contract/signing/revoke",requirePermissions("vehicles:write"),asyncHandler(async(req,res)=>{const a=actor(req);z.object({}).strict().parse(req.body);res.json(await service.revoke(a.tenantId,req.params.id,a.userId));}));
 router.get("/:id/contract/signing/versions/:requestId/pdf",requirePermissions("vehicles:read"),asyncHandler(async(req,res)=>{const a=actor(req);pdf(res,await service.versionPdf(a.tenantId,req.params.id,req.params.requestId),"Contratto_firmato_conservato.pdf");}));
 router.get("/:id/contract/signing/evidence.pdf",requirePermissions("vehicles:read"),asyncHandler(async(req,res)=>{const a=actor(req),value=await service.frozen(a.tenantId,req.params.id);if(!value||value.row.status!=="SIGNED")throw new AppError("Firma non disponibile",404,"NOT_FOUND");res.setHeader("Cache-Control","private, no-store");pdf(res,await service.evidencePdf(value.row),"Registrazione_firma_email.pdf");}));
 return router;
};
export const contractSigningPublicRoutes=(service:ContractSigningService=contractSigningService)=>{
 const router=Router();
 const reading=rateLimit({windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false,message:{error:"SIGNING_RATE_LIMIT",message:"Troppe richieste. Attendi e riprova."}});
 const codes=rateLimit({windowMs:15*60000,max:30,standardHeaders:true,legacyHeaders:false,message:{error:"SIGNING_RATE_LIMIT",message:"Troppe richieste di codice. Attendi e riprova."}});
 router.use((req,res,next)=>{
  res.setHeader("Cache-Control","private, no-store, max-age=0");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Robots-Tag","noindex, nofollow");
  if(req.method!=="POST"||req.headers.origin!==new URL(env.APP_URL).origin||!req.is("application/json"))return next(new AppError("Richiesta non consentita",403,"SIGNING_ORIGIN_INVALID"));
  next();
 });
 const proof=async(req:Request,raw:string)=>{const view=await service.resolve(raw);return getCookieValue(req,signingCookieName(view.id))??"";};
 router.post("/resolve",reading,asyncHandler(async(req,res)=>{const input=z.object({token}).strict().parse(req.body);res.json(await service.resolve(input.token));}));
 router.post("/document",reading,asyncHandler(async(req,res)=>{const input=z.object({token}).strict().parse(req.body);const value=await service.document(input.token,await proof(req,input.token));res.cookie(signingCookieName(value.requestId),value.proof,cookieOptions());pdf(res,value.bytes,value.filename);}));
 router.post("/otp",codes,asyncHandler(async(req,res)=>{const input=z.object({token,documentHash}).strict().parse(req.body);res.status(202).json(await service.requestOtp(input.token,input.documentHash,await proof(req,input.token)));}));
 router.post("/confirm",codes,asyncHandler(async(req,res)=>{
  const input=z.object({token,documentHash,code:z.string().regex(/^\d{6}$/),confirmationId:z.string().uuid(),consent:z.literal(true),consentVersion:z.literal("email-otp-v1")}).strict().parse(req.body);
  res.json(await service.confirm(input.token,input,await proof(req,input.token),{ip:req.ip??"",userAgent:String(req.headers["user-agent"]??"").slice(0,1000)}));
 }));
 router.post("/evidence",reading,asyncHandler(async(req,res)=>{const input=z.object({token}).strict().parse(req.body);pdf(res,await service.publicEvidence(input.token),"Registrazione_firma_email.pdf");}));
 return router;
};
