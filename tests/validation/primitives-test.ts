import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import type { ServerInstance } from "../../interfaces/server";
import { loadImpl } from "../../framework/impl-loader";

const server = loadImpl().server;
let instance: ServerInstance;

beforeAll(async () => {
  instance = await server.startWithCoreOnly("r4");
});

afterAll(async () => {
  await instance.stop();
});

async function validate(valueKey: string, value: unknown) {
  return instance.rest.operation("Parameters", "$validate", {
    resourceType: "Parameters",
    parameter: [
      {
        name: "resource",
        resource: {
          resourceType: "Parameters",
          parameter: [{ name: "x", [valueKey]: value }],
        },
      },
    ],
  });
}

describe("valueBoolean", () => {
  it.each([true, false])("accepts %p", async (v) => {
    expect(await validate("valueBoolean", v)).toBeValid();
  });
  it.each(["true"])("rejects %p", async (v) => {
    expect(await validate("valueBoolean", v)).toBeInvalid();
  });
});

describe("valueInteger", () => {
  it.each([12, -300, 2147483647, -2147483648])("accepts %p", async (v) => {
    expect(await validate("valueInteger", v)).toBeValid();
  });
  it.each([3.1, "42", 2147483648, -2147483649])("rejects %p", async (v) => {
    expect(await validate("valueInteger", v)).toBeInvalid();
  });
});

describe("valueUnsignedInt", () => {
  it.each([0, 1, 2147483647])("accepts %p", async (v) => {
    expect(await validate("valueUnsignedInt", v)).toBeValid();
  });
  it.each([-1, 9.2, 2147483648])("rejects %p", async (v) => {
    expect(await validate("valueUnsignedInt", v)).toBeInvalid();
  });
});

describe("valuePositiveInt", () => {
  it.each([1, 2147483647])("accepts %p", async (v) => {
    expect(await validate("valuePositiveInt", v)).toBeValid();
  });
  it.each([0, -1, 9.2, 2147483648])("rejects %p", async (v) => {
    expect(await validate("valuePositiveInt", v)).toBeInvalid();
  });
});

describe("valueDecimal", () => {
  it.each([12, 3.14, -62e3, 2147483648])("accepts %p", async (v) => {
    expect(await validate("valueDecimal", v)).toBeValid();
  });
  it.each(["9.2"])("rejects %p", async (v) => {
    expect(await validate("valueDecimal", v)).toBeInvalid();
  });
});

describe("valueDateTime", () => {
  it.each([
    "2018",
    "1973-06",
    "1905-08-23",
    "2015-02-07T13:28:17-05:00",
    "2015-02-07T13:28:17+05:00",
    "2017-01-01T00:00:00Z",
    "2017-01-01T00:00:00.000Z",
    "2017-01-01T00:00:00.000000000Z",
    "2015-02-07T13:28:17+14:00",
  ])("accepts %p", async (v) => {
    expect(await validate("valueDateTime", v)).toBeValid();
  });

  it.each([
    "201",
    "0000",
    "000a",
    "2000-0",
    "2000a01",
    "2000-0a",
    "2000-00",
    "2000-13",
    "2000-01-1",
    "2000-01-0a",
    "2000-01-00",
    "2000-01a01",
    "2024-02-31",
    "2024-01-35",
    "2023-02-29",
    "2015-02-07T25",
    "2015-02-07T15:",
    "2015-02-07T15:15",
    "2015-02-07T15:15:15",
    "2017-01-01T23:59:61Z",
    "2017-01-01T00:60:00Z",
    "2017-01-01T24:00:00Z",
    "2017-01-01T14a00:00Z",
    "2017-01-01T14:00a00Z",
    "2015-02-07T25:28:17Z",
    "2017-01-01T00:00:00a000Z",
    "2017-01-01T00:00:00.0000000000Z",
    "2017-01-01T00:00:00.000Y",
    "2015-02-07T13:28:17a05:00",
    "2015-02-07T13:28:17+24:00",
    "2015-02-07T13:28:17+14:01",
    "2015-02-07T13:28:17+14a00",
  ])("rejects %p", async (v) => {
    expect(await validate("valueDateTime", v)).toBeInvalid();
  });
});

describe("valueTime", () => {
  it.each(["12:03:00"])("accepts %p", async (v) => {
    expect(await validate("valueTime", v)).toBeValid();
  });
  it.each(["23:02", "2015-02-07T13:28:17"])("rejects %p", async (v) => {
    expect(await validate("valueTime", v)).toBeInvalid();
  });
});

describe("valueDate", () => {
  it.each(["2018", "1973-06", "1905-08-23", "2000-01-02"])("accepts %p", async (v) => {
    expect(await validate("valueDate", v)).toBeValid();
  });
});

describe("valueInstant", () => {
  it.each(["2015-02-07T13:28:17.239+02:00", "2017-01-01T00:00:00Z"])("accepts %p", async (v) => {
    expect(await validate("valueInstant", v)).toBeValid();
  });

  it.each([
    "2015-02-07T13:28:17.239",
    "2015-02-07T13:28+02:00",
    "201",
    "2018",
    "0000",
    "2018-",
    "2018-06",
    "1973-06",
    "1905-08-23",
    "000a",
    "2000-0",
    "2000a01",
    "2000-0a",
    "2000-00",
    "2000-13",
    "2000-01-1",
    "2000-01-0a",
    "2000-01-00",
    "2000-01a01",
    "2024-02-31",
    "2024-01-35",
    "2023-02-29",
    "2015-02-07T25",
    "2015-02-07T15:",
    "2015-02-07T15:15",
    "2015-02-07T15:15:15",
    "2017-01-01T23:59:61Z",
    "2017-01-01T00:60:00Z",
    "2017-01-01T24:00:00Z",
    "2017-01-01T14a00:00Z",
    "2017-01-01T14:00a00Z",
    "2015-02-07T25:28:17Z",
    "2017-01-01T00:00:00a000Z",
    "2017-01-01T00:00:00.0000000000Z",
    "2017-01-01T00:00:00.000Y",
    "2015-02-07T13:28:17a05:00",
    "2015-02-07T13:28:17+24:00",
    "2015-02-07T13:28:17+14:01",
    "2015-02-07T13:28:17+14a00",
  ])("rejects %p", async (v) => {
    expect(await validate("valueInstant", v)).toBeInvalid();
  });
});

describe("valueUrl", () => {
  it.each([
    "mailto:a@example.com",
    "http://example.com",
    "http://example.com:1337/hello?name=joe",
  ])("accepts %p", async (v) => {
    expect(await validate("valueUrl", v)).toBeValid();
  });
});

describe("valueUri", () => {
  it.each([
    "ftp://ftp.example.org/file.txt",
    "mailto:user@example.com",
    "tel:+1234567890",
  ])("accepts %p", async (v) => {
    expect(await validate("valueUri", v)).toBeValid();
  });
  it.each([""])("rejects empty string", async (v) => {
    expect(await validate("valueUri", v)).toBeInvalid();
  });
});

describe("valueId", () => {
  it.each(["user-name", "a.b.c.d.e.f.g.h.i.j.k"])("accepts %p", async (v) => {
    expect(await validate("valueId", v)).toBeValid();
  });
  it.each([""])("rejects empty string", async (v) => {
    expect(await validate("valueId", v)).toBeInvalid();
  });
});

describe("valueOid", () => {
  it.each(["urn:oid:1.2.3.4.5"])("accepts %p", async (v) => {
    expect(await validate("valueOid", v)).toBeValid();
  });
  it.each([""])("rejects empty string", async (v) => {
    expect(await validate("valueOid", v)).toBeInvalid();
  });
});

describe("valueUuid", () => {
  it.each(["urn:uuid:c757873d-ec9a-4326-a141-556f43239520"])("accepts %p", async (v) => {
    expect(await validate("valueUuid", v)).toBeValid();
  });
  it.each([""])("rejects empty string", async (v) => {
    expect(await validate("valueUuid", v)).toBeInvalid();
  });
});

describe("valueString", () => {
  it.each(["text", "text \n text"])("accepts %p", async (v) => {
    expect(await validate("valueString", v)).toBeValid();
  });
  it.each([""])("rejects empty string", async (v) => {
    expect(await validate("valueString", v)).toBeInvalid();
  });
});

describe("valueCode", () => {
  it.each(["text", "text text"])("accepts %p", async (v) => {
    expect(await validate("valueCode", v)).toBeValid();
  });
  it.each([""])("rejects empty string", async (v) => {
    expect(await validate("valueCode", v)).toBeInvalid();
  });
});

describe("valueBase64Binary", () => {
  it.each(["TWFu", "SGVsbG8gV29ybGQ=", "QUJDREVGRw=="])("accepts %p", async (v) => {
    expect(await validate("valueBase64Binary", v)).toBeValid();
  });
  it.each([""])("rejects empty string", async (v) => {
    expect(await validate("valueBase64Binary", v)).toBeInvalid();
  });
});

describe("valueMarkdown", () => {
  it.each(["**Bold Text**", "\nCode block\n"])("accepts %p", async (v) => {
    expect(await validate("valueMarkdown", v)).toBeValid();
  });
  it.each([""])("rejects empty string", async (v) => {
    expect(await validate("valueMarkdown", v)).toBeInvalid();
  });
});

describe("valueCanonical", () => {
  it.each([
    "http://example.org/fhir/ValueSet/valueset-example",
    "http://example.org/fhir/ValueSet/valueset-example|1.2.3#definition",
  ])("accepts %p", async (v) => {
    expect(await validate("valueCanonical", v)).toBeValid();
  });
  it.each([""])("rejects empty string", async (v) => {
    expect(await validate("valueCanonical", v)).toBeInvalid();
  });
});
