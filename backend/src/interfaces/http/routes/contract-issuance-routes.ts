import {Router} from 'express';
import {z} from 'zod';
import {contractIssuanceService} from '../../../application/services/contract-issuance-service.js';
import {requirePermissions} from '../middlewares/permissions.js';
import {asyncHandler} from './async-handler.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),cents=z.number().int().min(0).max(100000000);
export function contractIssuanceRoutes(){
 const router=Router();router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
 router.get('/:id/contract/conversion',requirePermissions('vehicles:read'),asyncHandler(async(req,res)=>{res.json(await contractIssuanceService.preflight(req.auth!.tenantId,req.params.id));}));
 router.post('/:id/contract/convert',requirePermissions('vehicles:write'),asyncHandler(async(req,res)=>{const body=z.object({reviewHash:hash}).strict().parse(req.body),result=await contractIssuanceService.convert(req.auth!.tenantId,req.params.id,req.auth!.userId,body.reviewHash);res.status(result.duplicate?200:201).json(result);}));
 router.post('/:id/contract/revision',requirePermissions('vehicles:write'),asyncHandler(async(req,res)=>{const body=z.object({expectedRevision:z.number().int().min(0)}).strict().parse(req.body);res.json(await contractIssuanceService.startRevision(req.auth!.tenantId,req.params.id,req.auth!.userId,body.expectedRevision));}));
 router.put('/:id/contract/agreed-price',requirePermissions('vehicles:write','rental-payments:charge'),asyncHandler(async(req,res)=>{const body=z.object({listCents:cents,discountCents:cents,reason:z.string().trim().min(3).max(500),reviewHash:hash}).strict().refine(v=>v.discountCents<=v.listCents,'Lo sconto supera il prezzo di listino').parse(req.body);res.json(await contractIssuanceService.agreePrice(req.auth!.tenantId,req.params.id,req.auth!.userId,body));}));
 return router;
}
