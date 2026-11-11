import { Request, Response } from "express";
import { NotificationsService } from "../../../application/services/notifications-service.js";
import { guardedNotificationStream } from "../utils/guarded-notification-stream.js";
import { notificationStreamReader } from "../utils/notification-stream-reader.js";

export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  inbox = async (req: Request, res: Response) => {
    const data = await this.notificationsService.inbox(req.auth!.tenantId);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ data });
  };

  stream = async (req: Request, res: Response) => {
    await guardedNotificationStream(req,res,notificationStreamReader(req,res,this.notificationsService));
  };
}
