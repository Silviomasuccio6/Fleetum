import { Router } from "express";
import { UsersController } from "../controllers/users-controller.js";
import { SiteAccessController } from "../controllers/site-access-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const usersRoutes = (controller: UsersController) => {
  const router = Router();
  router.get("/", requirePermissions("users:read"), asyncHandler(controller.list));
  router.get("/roles", requirePermissions("users:read"), asyncHandler(controller.listRoles));
  router.post("/invite", requirePermissions("users:write"), asyncHandler(controller.invite));
  router.post("/", requirePermissions("users:write"), asyncHandler(controller.create));
  router.patch("/:id", requirePermissions("users:write"), asyncHandler(controller.update));
  router.patch("/:id/role", requirePermissions("users:write"), asyncHandler(controller.updateRole));
  router.patch("/:id/site", requirePermissions("users:write"), asyncHandler(new SiteAccessController().assign));
  router.delete("/:id", requirePermissions("users:write"), asyncHandler(controller.remove));
  return router;
};
