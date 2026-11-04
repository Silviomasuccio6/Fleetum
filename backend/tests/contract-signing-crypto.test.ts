import assert from "node:assert/strict";
import {test} from "node:test";
import {randomBytes} from "node:crypto";
import {createSigningCrypto} from "../src/application/services/contract-signing-crypto.js";
const crypto=createSigningCrypto(randomBytes(32).toString("hex"));
test("signing capabilities are opaque and canonical; hashes never contain the capability",()=>{
 const token=crypto.token();assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.equal(crypto.validToken(token),true);assert.equal(crypto.validToken(token+"="),false);assert.equal(crypto.validToken("short"),false);assert.match(crypto.hash(token),/^[a-f0-9]{64}$/);assert.ok(!crypto.hash(token).includes(token));
});
test("encrypted queue payload cannot be moved across tenant, request, queue or purpose",()=>{
 const sealed=crypto.seal({code:"001234"},"tenant/request/queue/OTP/1");assert.ok(!sealed.includes("001234"));assert.deepEqual(crypto.open(sealed,"tenant/request/queue/OTP/1"),{code:"001234"});
 for(const context of ["other/request/queue/OTP/1","tenant/other/queue/OTP/1","tenant/request/other/OTP/1","tenant/request/queue/INVITE/1","tenant/request/queue/OTP/2"])assert.throws(()=>crypto.open(sealed,context));
});
test("the document-read proof is browser-held, document-bound, time-limited and tamper-resistant",()=>{
 const proof=crypto.documentProof("request","0".repeat(64),1000);assert.equal(crypto.readProof(proof,"request","0".repeat(64),1001)?.id,"request");assert.equal(crypto.readProof(proof,"other","0".repeat(64),1001),null);assert.equal(crypto.readProof(proof,"request","1".repeat(64),1001),null);assert.equal(crypto.readProof(proof,"request","0".repeat(64),1000+30*60*1000+1),null);assert.equal(crypto.readProof(proof+"x","request","0".repeat(64),1001),null);
});
test("OTP hashes bind code, document, generation and browser and require the server key",()=>{
 const input={requestId:"request",generation:1,documentHash:"0".repeat(64),browserHash:"browser",code:"001234"};const digest=crypto.otpDigest(input);assert.match(digest,/^[a-f0-9]{64}$/);
 for(const change of [{generation:2},{documentHash:"1".repeat(64)},{browserHash:"other"},{code:"001235"}])assert.notEqual(crypto.otpDigest({...input,...change}),digest);
 assert.notEqual(createSigningCrypto(randomBytes(32).toString("hex")).otpDigest(input),digest);assert.equal(crypto.equal(digest,digest),true);assert.equal(crypto.equal(digest,"x"),false);
});
