/** Validates bodies against contracts/backend.openapi.json component schemas (JSON Schema 2020-12). */
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";

const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../contracts/backend.openapi.json"), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: "backend", components: spec.components });

export function assertSchema(schemaName: string, body: unknown) {
  const validate = ajv.getSchema(`backend#/components/schemas/${schemaName}`);
  if (!validate) throw new Error(`No schema ${schemaName}`);
  if (!validate(body)) throw new Error(`${schemaName} invalid: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body).slice(0, 600)}`);
}
export const fixturesDir = path.resolve(__dirname, "../../../../fixtures");
export const readFixture = (f: string) => JSON.parse(fs.readFileSync(path.join(fixturesDir, f), "utf8"));
