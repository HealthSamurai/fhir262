import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { loadImpl } from "../../framework/impl-loader";
import type { ServerInstance } from "../../interfaces/server";

const server = loadImpl().server;
let instance: ServerInstance;

beforeAll(async () => {
  instance = await server.startWithCoreOnly("r4");
});

afterAll(async () => {
  await instance.stop();
});

function buildResource(valueKey: string, value: unknown) {
  return {
    resourceType: "Parameters",
    parameter: [{ name: "x", [valueKey]: value }],
  };
}

function buildInput(valueKey: string, value: unknown) {
  return {
    resourceType: "Parameters",
    parameter: [{ name: "resource", resource: buildResource(valueKey, value) }],
  };
}

async function validate(valueKey: string, value: unknown) {
  return instance.rest.operation("Parameters", "$validate", buildInput(valueKey, value));
}

describe("valueBoolean", () => {
  it.each([true, false])("accepts %p", async (v) => {
    expect(await validate("valueBoolean", v)).toBeValid();
  });

  it.each(["true"])("rejects %p", async (v) => {
    expect(await validate("valueBoolean", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(boolean)", async () => {
    const res = await validate("valueBoolean", "true");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(boolean)");
  });
});

describe("valueInteger", () => {
  it.each([12, -300, 2147483647, -2147483648])("accepts %p", async (v) => {
    expect(await validate("valueInteger", v)).toBeValid();
  });

  it.each([3.1, "42", 2147483648, -2147483649])("rejects %p", async (v) => {
    expect(await validate("valueInteger", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(integer)", async () => {
    const res = await validate("valueInteger", 3.1);
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(integer)");
  });
});

describe("valueUnsignedInt", () => {
  it.each([0, 1, 2147483647])("accepts %p", async (v) => {
    expect(await validate("valueUnsignedInt", v)).toBeValid();
  });

  it.each([-1, 9.2, 2147483648])("rejects %p", async (v) => {
    expect(await validate("valueUnsignedInt", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(unsignedInt)", async () => {
    const res = await validate("valueUnsignedInt", -1);
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(unsignedInt)");
  });
});

describe("valuePositiveInt", () => {
  it.each([1, 2147483647])("accepts %p", async (v) => {
    expect(await validate("valuePositiveInt", v)).toBeValid();
  });

  it.each([0, -1, 9.2, 2147483648])("rejects %p", async (v) => {
    expect(await validate("valuePositiveInt", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(positiveInt)", async () => {
    const res = await validate("valuePositiveInt", 0);
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(positiveInt)");
  });
});

describe("valueDecimal", () => {
  it.each([12, 3.14, -62e3, 2147483648])("accepts %p", async (v) => {
    expect(await validate("valueDecimal", v)).toBeValid();
  });

  it.each(["9.2"])("rejects %p", async (v) => {
    expect(await validate("valueDecimal", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(decimal)", async () => {
    const res = await validate("valueDecimal", "9.2");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(decimal)");
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

  it("rejection issue points at Parameters.parameter[0].value.ofType(dateTime)", async () => {
    const res = await validate("valueDateTime", "201");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(dateTime)");
  });
});

describe("valueTime", () => {
  it.each(["12:03:00"])("accepts %p", async (v) => {
    expect(await validate("valueTime", v)).toBeValid();
  });

  it.each(["23:02", "2015-02-07T13:28:17"])("rejects %p", async (v) => {
    expect(await validate("valueTime", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(time)", async () => {
    const res = await validate("valueTime", "23:02");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(time)");
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

  it("rejection issue points at Parameters.parameter[0].value.ofType(instant)", async () => {
    const res = await validate("valueInstant", "2015-02-07T13:28:17.239");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(instant)");
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

  it.each([""])("rejects %p", async (v) => {
    expect(await validate("valueUri", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(uri)", async () => {
    const res = await validate("valueUri", "");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(uri)");
  });
});

describe("valueId", () => {
  it.each(["user-name", "a.b.c.d.e.f.g.h.i.j.k"])("accepts %p", async (v) => {
    expect(await validate("valueId", v)).toBeValid();
  });

  it.each([""])("rejects %p", async (v) => {
    expect(await validate("valueId", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(id)", async () => {
    const res = await validate("valueId", "");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(id)");
  });
});

describe("valueOid", () => {
  it.each(["urn:oid:1.2.3.4.5"])("accepts %p", async (v) => {
    expect(await validate("valueOid", v)).toBeValid();
  });

  it.each([""])("rejects %p", async (v) => {
    expect(await validate("valueOid", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(oid)", async () => {
    const res = await validate("valueOid", "");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(oid)");
  });
});

describe("valueUuid", () => {
  it.each(["urn:uuid:c757873d-ec9a-4326-a141-556f43239520"])("accepts %p", async (v) => {
    expect(await validate("valueUuid", v)).toBeValid();
  });

  it.each([""])("rejects %p", async (v) => {
    expect(await validate("valueUuid", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(uuid)", async () => {
    const res = await validate("valueUuid", "");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(uuid)");
  });
});

describe("valueString", () => {
  it.each(["text", "text \n text"])("accepts %p", async (v) => {
    expect(await validate("valueString", v)).toBeValid();
  });

  it.each([""])("rejects %p", async (v) => {
    expect(await validate("valueString", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(string)", async () => {
    const res = await validate("valueString", "");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(string)");
  });
});

describe("valueCode", () => {
  it.each(["text", "text text"])("accepts %p", async (v) => {
    expect(await validate("valueCode", v)).toBeValid();
  });

  it.each([""])("rejects %p", async (v) => {
    expect(await validate("valueCode", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(code)", async () => {
    const res = await validate("valueCode", "");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(code)");
  });
});

describe("valueBase64Binary", () => {
  it.each(["TWFu", "SGVsbG8gV29ybGQ=", "QUJDREVGRw=="])("accepts %p", async (v) => {
    expect(await validate("valueBase64Binary", v)).toBeValid();
  });

  it.each([""])("rejects %p", async (v) => {
    expect(await validate("valueBase64Binary", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(base64Binary)", async () => {
    const res = await validate("valueBase64Binary", "");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(base64Binary)");
  });
});

describe("valueMarkdown", () => {
  it.each(["**Bold Text**", "\nCode block\n"])("accepts %p", async (v) => {
    expect(await validate("valueMarkdown", v)).toBeValid();
  });

  it.each([""])("rejects %p", async (v) => {
    expect(await validate("valueMarkdown", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(markdown)", async () => {
    const res = await validate("valueMarkdown", "");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(markdown)");
  });
});

describe("valueCanonical", () => {
  it.each([
    "http://example.org/fhir/ValueSet/valueset-example",
    "http://example.org/fhir/ValueSet/valueset-example|1.2.3#definition",
  ])("accepts %p", async (v) => {
    expect(await validate("valueCanonical", v)).toBeValid();
  });

  it.each([""])("rejects %p", async (v) => {
    expect(await validate("valueCanonical", v)).toBeInvalid();
  });

  it("rejection issue points at Parameters.parameter[0].value.ofType(canonical)", async () => {
    const res = await validate("valueCanonical", "");
    expect(res).toHaveIssueWithExpression("Parameters.parameter[0].value.ofType(canonical)");
  });
});
