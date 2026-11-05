import crypto from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";

export const SIGNING_CONSENT_VERSION = "email-otp-v1";
export const SIGNING_CONSENT = "Confermo di avere letto il documento e di volerlo sottoscrivere tramite il codice inviato alla mia email.";
const PROOF_MS = 30 * 60 * 1000;

export const createSigningCrypto = (master: string) => {
  if (!/^[a-f0-9]{64}$/i.test(master)) throw new AppError("Firma tramite email da predisporre",503,"CONTRACT_SIGNING_UNAVAILABLE");
  const key = (purpose: string) => Buffer.from(crypto.hkdfSync("sha256",Buffer.from(master,"hex"),"fleetum:contract-signing:v1",purpose,32));
  const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
  const mac = (purpose: string,value: string) => crypto.createHmac("sha256",key(purpose)).update(value).digest("hex");
  const equal = (a: string,b: string) => /^[a-f0-9]{64}$/i.test(a)&&/^[a-f0-9]{64}$/i.test(b)&&crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
  return {
    hash, equal,
    token: () => crypto.randomBytes(32).toString("base64url"),
    validToken: (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,"base64url").toString("base64url")===value,
    code: () => String(crypto.randomInt(0,1000000)).padStart(6,"0"),
    seal(value: unknown,context: string) {
      const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key("queue"),iv,{authTagLength:16});
      cipher.setAAD(Buffer.from(context));const bytes=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
      return [iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),bytes.toString("base64url")].join(".");
    },
    open(value: string,context: string): Record<string,unknown> {
      if(value.length>8192)throw new Error("Invalid signing envelope");
      const [iv,tag,bytes]=value.split(".");const decipher=crypto.createDecipheriv("aes-256-gcm",key("queue"),Buffer.from(iv,"base64url"),{authTagLength:16});
      decipher.setAAD(Buffer.from(context));decipher.setAuthTag(Buffer.from(tag,"base64url"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes,"base64url")),decipher.final()]).toString("utf8"));
    },
    documentProof(id: string,sha: string,now: number) {
      const payload=Buffer.from(JSON.stringify({id,sha,nonce:crypto.randomBytes(32).toString("base64url"),at:now})).toString("base64url");
      return payload+"."+mac("document-proof",payload);
    },
    readProof(value: string,id: string,sha: string,now: number): {id:string;sha:string;nonce:string;at:number}|null {
      try {
        if(value.length>1024)return null;
        const [payload,signature,...rest]=value.split(".");if(rest.length||!equal(mac("document-proof",payload),signature))return null;
        const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
        if(data.id!==id||data.sha!==sha||!Number.isSafeInteger(data.at)||data.at>now||now-data.at>PROOF_MS||!/^[A-Za-z0-9_-]{43}$/.test(data.nonce))return null;
        return data;
      }catch{return null;}
    },
    otpDigest(input:{requestId:string;generation:number;documentHash:string;browserHash:string;code:string}) {
      return mac("otp",JSON.stringify([input.requestId,input.generation,input.documentHash,input.browserHash,input.code]));
    },
    evidenceMac: (value: string) => mac("evidence",value),
    auditHash: (value: string) => mac("audit",value)
  };
};
