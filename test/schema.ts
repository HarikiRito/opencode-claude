/**
 * Schema converter tests for opencode-claude — no live Claude CLI required.
 */
import assert from "node:assert/strict";

async function main() {
  const { jsonSchemaToZodShape } = await import("../src/proxy.ts");
  const { z } = await import("zod");

  const toJson = (shape: Record<string, unknown>) =>
    z.toJSONSchema(z.object(shape as Record<string, never>));

  // The real OpenCode `question` tool schema.
  const questionSchema = {
    type: "object",
    $schema: "http://json-schema.org/draft-07/schema#",
    properties: {
      questions: {
        type: "array",
        description: "Questions to ask",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "Complete question" },
            header: {
              type: "string",
              description: "Very short label (max 30 chars)",
            },
            options: {
              type: "array",
              description: "Available choices",
              items: {
                type: "object",
                properties: {
                  label: {
                    type: "string",
                    description: "Display text (1-5 words, concise)",
                  },
                  description: {
                    type: "string",
                    description: "Explanation of choice",
                  },
                },
                required: ["label", "description"],
              },
            },
            multiple: {
              type: "boolean",
              description: "Allow selecting multiple choices",
            },
            custom: {
              type: "boolean",
              description: "Allow typing a custom answer (default: true)",
            },
          },
          required: ["question", "header", "options"],
        },
      },
    },
    required: ["questions"],
  };

  {
    const shape = jsonSchemaToZodShape(questionSchema as Record<string, unknown>);
    const out = toJson(shape) as Record<string, unknown>;
    const questionsItems = (
      ((out.properties as Record<string, unknown>).questions as Record<string, unknown>)
        .items as Record<string, unknown>
    );
    const optionsItems = (
      (questionsItems.properties as Record<string, unknown>).options as Record<string, unknown>
    ).items as Record<string, unknown>;
    const label = (optionsItems.properties as Record<string, unknown>).label as Record<
      string,
      unknown
    >;

    assert.equal(label.type, "string", "options.items.properties.label is a string");
    assert.deepEqual(
      questionsItems.required,
      ["question", "header", "options"],
      "outer required preserved",
    );
    assert.deepEqual(
      optionsItems.required,
      ["label", "description"],
      "nested required preserved",
    );

    // Every description in the input must survive at the same path in the output.
    assert.equal(
      (out.properties as Record<string, unknown> as any).questions.description,
      "Questions to ask",
    );
    assert.equal(questionsItems.properties && (questionsItems.properties as any).question.description, "Complete question");
    assert.equal((questionsItems.properties as any).header.description, "Very short label (max 30 chars)");
    assert.equal((questionsItems.properties as any).options.description, "Available choices");
    assert.equal((optionsItems.properties as any).label.description, "Display text (1-5 words, concise)");
    assert.equal(
      (optionsItems.properties as any).description.description,
      "Explanation of choice",
    );
    assert.equal((questionsItems.properties as any).multiple.description, "Allow selecting multiple choices");

    const multiple = (questionsItems.properties as any).multiple;
    assert.equal(multiple.type, "boolean");
    assert.ok(
      !Array.isArray(questionsItems.required) ||
        !(questionsItems.required as string[]).includes("multiple"),
      "multiple is optional",
    );

    // Parsing direction: valid payload accepted, missing nested required field rejected.
    const validPayload = {
      questions: [
        {
          question: "Pick one",
          header: "Pick",
          options: [{ label: "A", description: "First option" }],
          multiple: false,
        },
      ],
    };
    assert.equal(z.object(shape as Record<string, never>).safeParse(validPayload).success, true);

    const invalidPayload = {
      questions: [
        {
          question: "Pick one",
          header: "Pick",
          options: [{ label: "A" }],
        },
      ],
    };
    assert.equal(
      z.object(shape as Record<string, never>).safeParse(invalidPayload).success,
      false,
      "options[].description is required",
    );
  }

  // $ref + $defs resolution, including a self-referential (cyclic) schema.
  {
    const refSchema = {
      type: "object",
      properties: {
        node: { $ref: "#/$defs/Node" },
      },
      required: ["node"],
      $defs: {
        Node: {
          type: "object",
          properties: {
            value: { type: "string" },
            child: { $ref: "#/$defs/Node" },
          },
          required: ["value"],
        },
      },
    };
    const shape = jsonSchemaToZodShape(refSchema as Record<string, unknown>);
    const out = toJson(shape) as any;
    assert.equal(out.properties.node.type, "object");
    assert.equal(out.properties.node.properties.value.type, "string");
    // Cyclic ref must terminate — child resolves to *something* JSON-schema-serializable.
    assert.ok(out.properties.node.properties.child !== undefined);
  }

  // Constraint preservation.
  {
    const schema = {
      type: "object",
      properties: {
        s: { type: "string", maxLength: 5 },
        arr: { type: "array", items: { type: "string" }, minItems: 1 },
        n: { type: "number", minimum: 3 },
        p: { type: "string", pattern: "^[a-z]+$" },
        mail: { type: "string", format: "email" },
        d: { type: "string", default: "hi" },
        e: { type: "string", enum: ["a", "b"] },
        c: { const: "fixed" },
      },
    };
    const shape = jsonSchemaToZodShape(schema as Record<string, unknown>);
    const out = toJson(shape) as any;
    assert.equal(out.properties.s.maxLength, 5);
    assert.equal(out.properties.arr.minItems, 1);
    assert.equal(out.properties.n.minimum, 3);
    assert.equal(out.properties.p.pattern, "^[a-z]+$");
    assert.equal(out.properties.mail.format, "email");
    assert.equal(out.properties.d.default, "hi");
    const enumValues = Array.isArray(out.properties.e.enum)
      ? out.properties.e.enum
      : (out.properties.e.anyOf ?? []).map((v: any) => v.const);
    assert.deepEqual([...enumValues].sort(), ["a", "b"]);
    assert.equal(out.properties.c.const, "fixed");
    assert.ok(!Array.isArray(out.required) || !out.required.includes("d"), "defaulted field stays optional");
  }

  // type array w/ null, nullable, oneOf, allOf, tuple items, prefixItems.
  {
    const schema = {
      type: "object",
      properties: {
        u: { type: ["string", "null"] },
        nul: { type: "string", nullable: true },
        one: { oneOf: [{ type: "string" }, { type: "number" }] },
        merged: {
          allOf: [
            { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
            { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
          ],
        },
        tup: { type: "array", items: [{ type: "string" }, { type: "number" }] },
        pre: { type: "array", prefixItems: [{ type: "string" }, { type: "boolean" }] },
      },
    };
    const shape = jsonSchemaToZodShape(schema as Record<string, unknown>);
    const out = toJson(shape) as any;
    const includesTypes = (node: any, ...types: string[]) => {
      const t = node.type;
      const found = Array.isArray(t) ? t : Array.isArray(node.anyOf) ? node.anyOf.map((v: any) => v.type) : [t];
      return types.every((x) => found.includes(x));
    };
    assert.ok(includesTypes(out.properties.u, "string", "null"), "string|null represented");
    assert.ok(includesTypes(out.properties.nul, "string", "null"), "nullable represented");
    assert.ok(includesTypes(out.properties.one, "string", "number"), "oneOf represented");
    assert.equal(out.properties.merged.properties.a.type, "string");
    assert.equal(out.properties.merged.properties.b.type, "number");
    assert.deepEqual(out.properties.merged.required.sort(), ["a", "b"]);
    assert.ok(Array.isArray(out.properties.tup.prefixItems) || Array.isArray(out.properties.tup.items));
    assert.ok(Array.isArray(out.properties.pre.prefixItems) || Array.isArray(out.properties.pre.items));
  }

  // Malformed schemas must never throw.
  {
    assert.doesNotThrow(() => {
      const shape = jsonSchemaToZodShape({
        type: "object",
        properties: null,
      } as unknown as Record<string, unknown>);
      toJson(shape);
    });
    assert.doesNotThrow(() => {
      const shape = jsonSchemaToZodShape({
        type: "object",
        properties: { bad: { $ref: "#/nope" } },
      } as Record<string, unknown>);
      toJson(shape);
    });
  }

  console.log("ok — opencode-claude schema tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
