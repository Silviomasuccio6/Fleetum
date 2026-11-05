import {Router} from "express";
import {z} from "zod";
import {requirePermissions} from "../middlewares/permissions.js";
import {asyncHandler} from "./async-handler.js";
import {AppError} from "../../../shared/errors/app-error.js";
import {contractRentalDetailsService as service} from "../../../application/services/contract-rental-details-service.js";
import {rentalTermsSchema} from "../../../application/services/contract-rental-terms.js";
export const contractRentalDetailsRoutes=()=>{
 const router=Router();
 router.use((req,res,next)=>{res.setHeader("Cache-Control","private, no-store");if(!req.auth?.tenantId||!req.auth.userId)return next(new AppError("Accesso richiesto",401,"UNAUTHORIZED"));next();});
 router.get("/:id/contract/rental-details",requirePermissions("vehicles:read"),asyncHandler(async(req,res)=>res.json(await service.read(req.auth!.tenantId!,req.params.id))));
 router.get("/:id/contract/rental-details/drivers",requirePermissions("vehicles:read"),asyncHandler(async(req,res)=>{
  const query=z.object({search:z.string().trim().min(2).max(100)}).strict().parse(req.query);
  res.json(await service.candidates(req.auth!.tenantId!,req.params.id,query.search));
 }));
 router.patch("/:id/contract/rental-details",requirePermissions("vehicles:write"),asyncHandler(async(req,res)=>{
  const input=z.object({revision:z.number().int().min(0).max(2147483646),terms:rentalTermsSchema}).strict().parse(req.body);
  res.json(await service.save(req.auth!.tenantId!,req.params.id,req.auth!.userId,input.revision,input.terms));
 }));
 return router;
};
