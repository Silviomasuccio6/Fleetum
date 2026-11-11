import multer from "multer";
import { PassThrough } from "node:stream";

// A bounded synthetic multipart stream exercises request teardown without a
// network peer, persistent storage, or a real user's upload.
const mode=process.argv[2],request=new PassThrough(),response=new PassThrough();
request.headers={"content-type":"multipart/form-data; boundary=fleetum-synthetic-boundary","transfer-encoding":"chunked"};
request.method="POST";
const parser=multer({storage:multer.memoryStorage(),...(mode==="async-abort"?{fileFilter:(_req,_file,callback)=>setTimeout(()=>callback(null,true),20)}:{})}).single("file");
const timeout=setTimeout(()=>{throw new Error("Synthetic upload teardown timeout");},2000);
try {
 const completed=new Promise(resolve=>parser(request,response,error=>resolve(error)));
 const opening='--fleetum-synthetic-boundary\r\nContent-Disposition: form-data; name="file"; filename="synthetic.txt"\r\nContent-Type: text/plain\r\n\r\n';
 request.write(opening+"synthetic-content");
 if(mode==="valid")request.end('\r\n--fleetum-synthetic-boundary--\r\n');
 else request.destroy(new Error("synthetic-upload-aborted"));
 const error=await completed;await new Promise(resolve=>setTimeout(resolve,50));
 if(mode==="valid"){
  if(error||request.file?.buffer?.toString()!=="synthetic-content")throw new Error("Valid synthetic upload changed");
 }else if(!error)throw new Error("Aborted upload did not reach error handling");
 console.log(JSON.stringify({mode,handled:true}));
}finally{clearTimeout(timeout);request.destroy();response.destroy();}
