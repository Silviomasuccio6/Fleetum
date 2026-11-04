import type { Request, Response } from "express";

export const NOTIFICATION_POLL_MS = 20000;
export const NOTIFICATION_READ_TIMEOUT_MS = 10000;

// One poll at a time, bounded reads and idempotent disconnect cleanup. Injection
// is local to this utility's tests; no request or environment can change the SLA.
export const guardedNotificationStream = async (
  req: Pick<Request,"once"|"off">,
  res: Pick<Response,"once"|"off"|"setHeader"|"flushHeaders"|"write"|"end"|"writableEnded"|"destroyed">,
  read: () => Promise<unknown>,
  scheduling = {
    every: (callback: () => void) => { const timer=setInterval(callback,NOTIFICATION_POLL_MS); return () => clearInterval(timer); },
    deadline: (callback: () => void) => { const timer=setTimeout(callback,NOTIFICATION_READ_TIMEOUT_MS); return () => clearTimeout(timer); }
  }
) => {
  let active=true, busy=false, started=false;
  let cancelPoll: (()=>void) | undefined, cancelDeadline: (()=>void) | undefined;
  let rejectRead: ((error: Error)=>void) | undefined;
  const live = () => active && !res.destroyed && !res.writableEnded;
  const cleanup = () => {
    if (!active) return;
    active=false; cancelPoll?.(); cancelDeadline?.(); rejectRead?.(new Error("Notification stream closed"));
    req.off("aborted",disconnect); res.off("close",disconnect);
  };
  const disconnect = () => cleanup();
  const stop = () => {
    if (!live()) { cleanup(); return; }
    try { if (started) res.write(`data: ${JSON.stringify({data:[],reset:true})}\n\n`); }
    catch { /* A broken connection has no remaining recipient. */ }
    finally { cleanup(); res.end(); }
  };
  req.once("aborted",disconnect); res.once("close",disconnect);
  const poll = async (initial=false) => {
    if (!live() || busy) return;
    busy=true;
    let cancel=()=>{};
    try {
      const timeout=new Promise<never>((_resolve,reject)=>{
        rejectRead=reject;
        cancel=scheduling.deadline(()=>reject(new Error("Notification read timed out"))); cancelDeadline=cancel;
      });
      const data=await Promise.race([read(),timeout]);
      if (!live()) return;
      if (!started) {
        res.setHeader("Content-Type","text/event-stream");
        res.setHeader("Cache-Control","private, no-store");
        res.setHeader("Connection","keep-alive");
        res.flushHeaders?.(); started=true;
      }
      res.write(`data: ${JSON.stringify({data})}\n\n`);
    } catch(error) {
      if (initial && active && !started) {cleanup(); throw error;}
      stop();
    } finally { cancel(); cancelDeadline=undefined; rejectRead=undefined; busy=false; }
  };
  try {
    await poll(true);
    if (live()) cancelPoll=scheduling.every(()=>{void poll();});
  } catch(error) {cleanup(); throw error;}
  return cleanup;
};
