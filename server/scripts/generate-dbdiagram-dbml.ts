import fs from "fs";
import path from "path";

type ScalarField = {
  name: string;
  type: string;
  isOptional: boolean;
  isArray: boolean;
  attributes: string;
};

type RelationField = {
  name: string;
  targetModel: string;
  fields: string[];
  references: string[];
};

type ModelBlock = {
  name: string;
  scalarFields: ScalarField[];
  relationFields: RelationField[];
  uniques: string[][];
  indexes: string[][];
};

type EnumBlock = {
  name: string;
  values: string[];
};

const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
const outputPath = path.resolve(__dirname, "../../docs/SMART_ERD.dbml");

function splitBlocks(schema: string, kind: "model" | "enum") {
  const regex = new RegExp(`${kind}\\s+(\\w+)\\s+\\{([\\s\\S]*?)\\n\\}`, "g");
  return [...schema.matchAll(regex)];
}

function mapPrismaTypeToDbml(type: string): string {
  switch (type) {
    case "String":
      return "varchar";
    case "Int":
      return "int";
    case "Float":
      return "float";
    case "Boolean":
      return "boolean";
    case "DateTime":
      return "timestamp";
    case "Json":
      return "json";
    default:
      return type;
  }
}

function parseFieldType(rawType: string) {
  const isArray = rawType.endsWith("[]");
  const isOptional = rawType.endsWith("?");
  const baseType = rawType.replace(/[[\]?]/g, "");
  return { isArray, isOptional, baseType };
}

function parseList(attribute: string, key: string): string[] {
  const match = attribute.match(new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`));
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseUnnamedList(attribute: string): string[] {
  const match = attribute.match(/\[([^\]]+)\]/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseModel(body: string, name: string, modelNames: Set<string>): ModelBlock {
  const scalarFields: ScalarField[] = [];
  const relationFields: RelationField[] = [];
  const uniques: string[][] = [];
  const indexes: string[][] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    if (line.startsWith("@@unique(")) {
      const fields = parseUnnamedList(line);
      if (fields.length) uniques.push(fields);
      continue;
    }

    if (line.startsWith("@@index(")) {
      const fields = parseUnnamedList(line);
      if (fields.length) indexes.push(fields);
      continue;
    }

    if (line.startsWith("@@") || line.startsWith("@")) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const fieldName = parts[0];
    const rawType = parts[1];
    const attributes = parts.slice(2).join(" ");
    const { isArray, isOptional, baseType } = parseFieldType(rawType);

    if (modelNames.has(baseType)) {
      if (attributes.includes("@relation(")) {
        relationFields.push({
          name: fieldName,
          targetModel: baseType,
          fields: parseList(attributes, "fields"),
          references: parseList(attributes, "references"),
        });
      }
      continue;
    }

    if (attributes.includes("@relation(")) {
      relationFields.push({
        name: fieldName,
        targetModel: baseType,
        fields: parseList(attributes, "fields"),
        references: parseList(attributes, "references"),
      });
      continue;
    }

    scalarFields.push({
      name: fieldName,
      type: baseType,
      isOptional,
      isArray,
      attributes,
    });
  }

  return { name, scalarFields, relationFields, uniques, indexes };
}

function parseEnum(body: string, name: string): EnumBlock {
  const values = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));

  return { name, values };
}

function hasUniqueConstraint(model: ModelBlock, fieldNames: string[]) {
  if (fieldNames.length === 1) {
    const field = model.scalarFields.find((item) => item.name === fieldNames[0]);
    if (field?.attributes.includes("@unique")) return true;
  }

  return model.uniques.some(
    (uniqueFields) =>
      uniqueFields.length === fieldNames.length &&
      uniqueFields.every((field, index) => field === fieldNames[index])
  );
}

function formatField(field: ScalarField, enumNames: Set<string>) {
  if (field.isArray) return null;

  const dbmlType = mapPrismaTypeToDbml(field.type);
  const settings: string[] = [];

  if (field.attributes.includes("@id")) settings.push("pk");
  if (!field.isOptional && !field.attributes.includes("@default(")) settings.push("not null");
  if (field.attributes.includes("@unique")) settings.push("unique");

  const defaultMatch = field.attributes.match(/@default\((.+)\)/);
  if (defaultMatch) {
    const defaultValue = defaultMatch[1].trim();
    const isExpression = /\w+\(.*\)$/.test(defaultValue);
    const isEnumDefault = enumNames.has(field.type);
    if (!isExpression && !isEnumDefault) {
      settings.push(`default: ${defaultValue}`);
    }
  }

  const settingsText = settings.length ? ` [${settings.join(", ")}]` : "";
  return `  ${field.name} ${dbmlType}${settingsText}`;
}

function formatIndexes(model: ModelBlock) {
  const lines: string[] = [];

  for (const uniqueFields of model.uniques) {
    lines.push(`    (${uniqueFields.join(", ")}) [unique]`);
  }

  for (const indexFields of model.indexes) {
    lines.push(`    (${indexFields.join(", ")})`);
  }

  if (!lines.length) return "";

  return [`  indexes {`, ...lines, `  }`].join("\n");
}

function buildDbml(schema: string) {
  const modelMatches = splitBlocks(schema, "model");
  const modelNames = new Set(modelMatches.map((match) => match[1]));
  const models = modelMatches.map((match) => parseModel(match[2], match[1], modelNames));
  const enums = splitBlocks(schema, "enum").map((match) => parseEnum(match[2], match[1]));
  const enumNames = new Set(enums.map((enumBlock) => enumBlock.name));

  const tableBlocks = models.map((model) => {
    const fieldLines = model.scalarFields
      .map((field) => formatField(field, enumNames))
      .filter((line): line is string => Boolean(line));
    const indexBlock = formatIndexes(model);
    const content = indexBlock ? [...fieldLines, "", indexBlock] : fieldLines;
    return [`Table ${model.name} {`, ...content, `}`].join("\n");
  });

  const enumBlocks = enums.map((enumBlock) => {
    return [`Enum ${enumBlock.name} {`, ...enumBlock.values.map((value) => `  ${value}`), `}`].join("\n");
  });

  const refLines = models.flatMap((model) =>
    model.relationFields
      .filter((relation) => relation.fields.length > 0 && relation.references.length > 0)
      .map((relation) => {
        const operator = hasUniqueConstraint(model, relation.fields) ? "-" : ">";
        return relation.fields.map((field, index) => {
          const referenceField = relation.references[index] || relation.references[0];
          return `Ref: ${model.name}.${field} ${operator} ${relation.targetModel}.${referenceField}`;
        });
      })
  ).flat();

  return [
    `// Generated from server/prisma/schema.prisma`,
    `// Paste this file into dbdiagram.io`,
    "",
    ...enumBlocks,
    "",
    ...tableBlocks,
    "",
    ...refLines,
    "",
  ].join("\n");
}

const schema = fs.readFileSync(schemaPath, "utf8");
const dbml = buildDbml(schema);
fs.writeFileSync(outputPath, dbml, "utf8");

console.log(`DBML generated: ${outputPath}`);