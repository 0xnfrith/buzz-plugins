import { parse, validate } from "graphql";
import { describe, expect, test } from "vitest";
import { DOCUMENTS } from "../../src/linear/queries";
// @ts-expect-error plain ES module without declarations
import { loadSchema } from "../fake-linear/schema.mjs";

const schema = loadSchema();

describe("every document the plugin sends is valid against Linear's published schema", () => {
  for (const [name, source] of Object.entries(DOCUMENTS)) {
    test(name, () => {
      const document = parse(source);
      expect(validate(schema, document).map((error) => error.message)).toEqual([]);
      const operations = document.definitions.filter((d) => d.kind === "OperationDefinition");
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({ name: { value: name } });
    });
  }
});
