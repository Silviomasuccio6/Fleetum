import express from "express";
import http from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";

// Bounded child-process regression for GHSA-27r3-jxmh-p828. No DB or provider.
const mode=process.argv[2],app=express();
app.use(express.json({limit:"256kb"}));
app.post("/probe",(req,res)=>res.json(req.body));
app.get("/alive",(_req,res)=>res.send("synthetic-alive"));
app.use((error,_req,res,_next)=>res.status(error.status??500).json({error:"invalid-body"}));
const server=app.listen(0,"127.0.0.1");await once(server,"listening");const port=server.address().port;
try {
 const json=Buffer.from(JSON.stringify({synthetic:"fleetum-dependency-probe"})),compressed=gzipSync(json);
 const body=mode==="plain"?json:mode==="valid"?compressed:Buffer.concat([compressed,Buffer.from([0]),Buffer.alloc(100*1024,88)]);
 const result=await new Promise((resolve,reject)=>{
  const req=http.request({host:"127.0.0.1",port,path:"/probe",method:"POST",agent:false,headers:{"Content-Type":mode==="charset"?"application/json; charset=utf-999":"application/json","Content-Length":body.length,...(mode==="plain"?{}:{"Content-Encoding":"gzip"})}},res=>{
   let text="";res.setEncoding("utf8");res.on("data",chunk=>text+=chunk);res.on("error",reject);res.on("end",()=>resolve({status:res.statusCode,body:text}));
  });req.on("error",reject);req.setTimeout(2000,()=>req.destroy(new Error("Local parser probe timeout")));req.end(body);
 });
 await new Promise(resolve=>setTimeout(resolve,200));
 const alive=await fetch(`http://127.0.0.1:${port}/alive`);if(await alive.text()!=="synthetic-alive")throw new Error("Parser process stopped responding");
 console.log(JSON.stringify(result));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
