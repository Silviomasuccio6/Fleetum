import fs from "node:fs";
import path from "node:path";

type PiiField = {
  model: string;
  field: string;
  type: string;
};

const resolveSchemaPath = () => {
  const candidates = [
    path.resolve(process.cwd(), "prisma/schema.prisma"),
    path.resolve(process.cwd(), "backend/prisma/schema.prisma")
  ];
  const schemaPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!schemaPath) {
    throw new Error("Prisma schema non trovato. Esegui dal root repo o da backend/.");
  }
  return schemaPath;
};

const parsePiiFields = (schema: string): PiiField[] => {
  const fields: PiiField[] = [];
  let currentModel: string | null = null;
  let nextFieldIsPii = false;

  for (const rawLine of schema.split("\n")) {
    const line = rawLine.trim();
    const modelMatch = line.match(/^model\s+(\w+)\s+\{$/);
    if (modelMatch) {
      currentModel = modelMatch[1];
      nextFieldIsPii = false;
      continue;
    }
    if (line === "}") {
      currentModel = null;
      nextFieldIsPii = false;
      continue;
    }
    if (!currentModel) continue;
    if (line === "/// @pii") {
      nextFieldIsPii = true;
      continue;
    }
    if (!nextFieldIsPii || !line || line.startsWith("//") || line.startsWith("@@")) continue;

    const [field, type] = line.split(/\s+/);
    fields.push({ model: currentModel, field, type });
    nextFieldIsPii = false;
  }

  return fields;
};

const main = () => {
  const schemaPath = resolveSchemaPath();
  const fields = parsePiiFields(fs.readFileSync(schemaPath, "utf8"));
  const grouped = fields.reduce<Record<string, PiiField[]>>((acc, field) => {
    acc[field.model] ??= [];
    acc[field.model].push(field);
    return acc;
  }, {});

  console.log("# Fleetum PII Field Report");
  console.log("");
  console.log(`Generated at: ${new Date().toISOString()}`);
  console.log(`Schema: ${schemaPath}`);
  console.log(`Total PII fields: ${fields.length}`);
  console.log("");
  console.log("| Model | Field | Type |");
  console.log("| --- | --- | --- |");
  for (const field of fields) {
    console.log(`| ${field.model} | ${field.field} | ${field.type} |`);
  }
  console.log("");
  console.log("## Summary By Model");
  console.log("");
  for (const [model, modelFields] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`- ${model}: ${modelFields.length}`);
  }
};

main();
