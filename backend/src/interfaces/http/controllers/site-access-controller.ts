import type {Request,Response} from "express";
import {z} from "zod";
import {SiteAccessService} from "../../../application/services/site-access-service.js";
import {runWithSiteAccess} from "../../../infrastructure/auth/site-access-context.js";

export class SiteAccessController {
  constructor(private readonly service=new SiteAccessService()){}
  context=async(req:Request,res:Response)=>{
    res.setHeader("Cache-Control","private, no-store");
    res.json({data:await this.service.describe(req.auth!.tenantId,req.auth!.userId)});
  };
  assign=async(req:Request,res:Response)=>{
    res.setHeader("Cache-Control","private, no-store");
    const {siteId}=z.object({siteId:z.string().trim().min(1).nullable()}).strict().parse(req.body);
    const scope=await this.service.resolveSelectedScope(req.auth!.tenantId,req.auth!.userId,req.header("X-Fleetum-Site"));
    const data=await runWithSiteAccess(scope,()=>this.service.assign({tenantId:req.auth!.tenantId,actorUserId:req.auth!.userId,userId:req.params.id,siteId}));
    res.json({data});
  };
}
