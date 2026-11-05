import assert from "node:assert/strict";
import test from "node:test";
import {PDFDocument,PDFName,PDFString} from "pdf-lib";
import {validateCargosReceipt} from "../src/application/services/cargos-receipt-service.js";
test("receipt storage accepts an intact synthetic PDF and rejects malformed or oversized input",async()=>{
 const pdf=await PDFDocument.create();pdf.addPage().drawText("SYNTHETIC RECEIPT");const bytes=Buffer.from(await pdf.save()),before=bytes.toString("base64");await validateCargosReceipt(bytes);assert.equal(bytes.toString("base64"),before);
 for(const invalid of [Buffer.from("HTML instead of PDF"),Buffer.from("%PDF-invalid"),Buffer.alloc(2*1024*1024+1)])await assert.rejects(validateCargosReceipt(invalid));
});
test("receipt storage rejects PDF actions on the catalog and on pages",async()=>{
 for(const target of ["catalog","page"]){const pdf=await PDFDocument.create(),page=pdf.addPage();const action=pdf.context.obj({S:"JavaScript",JS:PDFString.of("synthetic-invalid-action")});
  if(target==="catalog")pdf.catalog.set(PDFName.of("OpenAction"),action);else page.node.set(PDFName.of("AA"),pdf.context.obj({O:action}));
  await assert.rejects(validateCargosReceipt(Buffer.from(await pdf.save())));
 }
});
