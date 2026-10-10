import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import morgan from "morgan";
import sharp from "sharp";
import { parseImportFile } from "../src/application/services/import-file-parser-service.js";

test("CSV imports preserve BOM, quoted commas and escaped quotes after the parser upgrade", async () => {
  const result = await parseImportFile(Buffer.from('\uFEFFtarga,marca,modello\r\nSYNTHETIC-01,"Demo, Motors","Test ""Plus"""\r\n\r\n'));
  assert.deepEqual(result.headers, ["targa", "marca", "modello"]);
  assert.deepEqual(result.rows, [{ targa: "SYNTHETIC-01", marca: "Demo, Motors", modello: 'Test "Plus"' }]);
});

test("ExcelJS still exports and reloads synthetic workbooks through the actual import service", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Synthetic");
  sheet.addRows([["targa", "marca", "modello"], ["SYNTHETIC-02", "Demo", "Example"]]);
  const result = await parseImportFile(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.deepEqual(result.headers, ["targa", "marca", "modello"]);
  assert.deepEqual(result.rows, [{ targa: "SYNTHETIC-02", marca: "Demo", modello: "Example" }]);
});

test("duplicate CSV prototype headers remain own properties and cannot replace record prototypes", () => {
  const [row] = parseCsv("__proto__,__proto__,name\nfirst,second,Synthetic\n", { columns: true, group_columns_by_name: true });
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.equal(Object.hasOwn(row, "__proto__"), true);
  assert.deepEqual(row.__proto__, ["first", "second"]);
  assert.equal(row.name, "Synthetic");
});

test("Morgan escapes injected quoted fields and Unicode separators in access-log tokens", () => {
  const value = 'synthetic"field\u2028next\u2029last';
  const request = { headers: { "user-agent": value } } as any;
  const token = (morgan as any)["req"](request, {}, "user-agent");
  assert.doesNotMatch(token, /(?<!\\)"/);
  assert.match(token, /\\"/);
  assert.equal(token.includes("\u2028"), false);
  assert.equal(token.includes("\u2029"), false);
  assert.match(token, /synthetic/);
});

test("patched Sharp loads native SVG rendering and preserves image output", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="#ff0000"/></svg>');
  const output = await sharp(svg).png().toBuffer();
  const decoded = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 3);
  assert.equal(decoded.info.height, 2);
  assert.deepEqual([...decoded.data.subarray(0, 3)], [255, 0, 0]);
});
