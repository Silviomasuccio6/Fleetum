import {useEffect,useRef,useState} from "react";
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy,type PDFPageProxy} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc=workerUrl;
function DocumentPage({document,pageNumber,onRendered,zoom}:{document:PDFDocumentProxy;pageNumber:number;onRendered:()=>void;zoom:number}){
 const callback=useRef(onRendered);callback.current=onRendered;
 const canvas=useRef<HTMLCanvasElement>(null),container=useRef<HTMLDivElement>(null),[text,setText]=useState(""),[error,setError]=useState(false);
 useEffect(()=>{let disposed=false,page:PDFPageProxy|undefined,task:ReturnType<PDFPageProxy["render"]>|undefined;
  void(async()=>{try{page=await document.getPage(pageNumber);if(disposed||!canvas.current)return;const scale=Math.min(1.5,(container.current?.clientWidth??800)/page.getViewport({scale:1}).width),viewport=page.getViewport({scale}),ratio=Math.min(window.devicePixelRatio||1,2);
   const target=canvas.current;target.width=Math.ceil(viewport.width*ratio);target.height=Math.ceil(viewport.height*ratio);target.style.width="100%";target.style.height="auto";
   task=page.render({canvas:target,viewport,transform:[ratio,0,0,ratio,0,0]});await task.promise;if(!disposed)callback.current();
   const content=await page.getTextContent();if(!disposed)setText(content.items.map(item=>"str"in item?item.str:"").join(" "));
  }catch{if(!disposed)setError(true);}})();return()=>{disposed=true;task?.cancel();page?.cleanup();};
 },[document,pageNumber,zoom]);
 return <div ref={container} className="signing-pdf-page" style={{width:`${zoom}%`,maxWidth:"none"}}><p className="signing-pdf-page-label">Pagina {pageNumber} di {document.numPages}</p>{error?<p role="alert">Questa pagina non può essere mostrata. Scarica il PDF per leggerla.</p>:<canvas ref={canvas} role="img" aria-label={`Pagina ${pageNumber} del contratto`}/>}<div className="sr-only">{text}</div></div>;
}
export function SigningPdfReader({bytes,onReady}:{bytes:Uint8Array;onReady:()=>void}){
 const[zoom,setZoom]=useState(100);
 const[pageNumber,setPageNumber]=useState(1);
 const[document,setDocument]=useState<PDFDocumentProxy|null>(null),[error,setError]=useState(false);const callback=useRef(onReady);callback.current=onReady;
 useEffect(()=>{let disposed=false;const task=getDocument({data:bytes.slice(),isEvalSupported:false,useSystemFonts:true});void task.promise.then(doc=>{if(disposed)return;if(doc.numPages>100)throw new Error("Too many pages");setDocument(doc);}).catch(()=>{if(!disposed)setError(true);});return()=>{disposed=true;void task.destroy();};},[bytes]);
 return <div className="signing-pdf-reader" role="region" aria-label="Pagine del contratto" tabIndex={0}>{error?<p role="alert">Anteprima non disponibile. Scarica il PDF e contatta il noleggiatore se il problema persiste.</p>:!document?<p role="status">Preparazione delle pagine…</p>:<><div className="signing-pdf-navigation"><button type="button" disabled={pageNumber===1} onClick={()=>setPageNumber(n=>n-1)}>Precedente</button><span role="status">{pageNumber} / {document.numPages}</span><label className="sr-only" htmlFor="signing-document-zoom">Ingrandimento documento</label><select id="signing-document-zoom" value={zoom} onChange={event=>setZoom(Number(event.target.value))}><option value={100}>Adatta</option><option value={150}>150%</option><option value={200}>200%</option><option value={300}>300%</option></select><button type="button" disabled={pageNumber===document.numPages} onClick={()=>setPageNumber(n=>n+1)}>Successiva</button></div><DocumentPage key={pageNumber} document={document} pageNumber={pageNumber} zoom={zoom} onRendered={()=>callback.current()}/></>}</div>;
}
