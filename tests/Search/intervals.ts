import { describe, it, beforeAll, afterAll } from "@jest/globals";
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

type Bundle = {
  resourceType: "Bundle";
  entry?: { resource: { id: string; resourceType: string } }[];
};

const idsOf = (b: unknown): string[] =>
  ((b as Bundle).entry ?? []).map((e) => e.resource.id);

const cleanup = async (type: string, ids: string[]) => {
  for (const id of ids) await instance.rest.delete(type, id);
};

type ResourceRange =
  | { name: string; type: "date" | "dateTime" | "instant"; value: string }
  | { name: string; type: "Period"; start?: string; end?: string }
  | { name: string; type: "Timing"; event: string[] };

const ObservationTemplate = (range: ResourceRange) => {
  const base = {
    resourceType: "Observation",
    status: "final",
    code: { text: "fhir262-search-prefix-test" },
  };
  switch (range.type) {
    case "dateTime":
      return { ...base, effectiveDateTime: range.value };
    case "instant":
      return { ...base, effectiveInstant: range.value };
    case "Period": {
      const period: { start?: string; end?: string } = {};
      if (range.start !== undefined) period.start = range.start;
      if (range.end !== undefined) period.end = range.end;
      return { ...base, effectivePeriod: period };
    }
    case "Timing":
      return { ...base, effectiveTiming: { event: range.event } };
    case "date":
      throw new Error(`ObservationTemplate does not support type "date"`);
  }
};

const PatientTemplate = (range: ResourceRange) => {
  if (range.type !== "date") {
    throw new Error(`PatientTemplate only supports type "date", got "${range.type}"`);
  }
  return { resourceType: "Patient", birthDate: range.value };
};

const requests = [
    // By precision level
    { name: "year", value: "2028" },
    { name: "year-month", value: "2028-05" },
    { name: "year-month-day", value: "2028-05-15" },
    { name: "hours-minutes", value: "2028-05-15T14:30" },
    { name: "seconds", value: "2028-05-15T14:30:45" },
    { name: "fractional-seconds", value: "2028-05-15T14:30:45.123" },

    // Timezone variants
    { name: "tz-zulu", value: "2028-05-15T14:30:00Z" },
    // { name: "tz-positive-offset", value: "2028-05-15T14:30:00+05:30" },
    // { name: "tz-negative-offset", value: "2028-05-15T14:30:00-08:00" },
    // { name: "tz-zero-offset-non-z", value: "2028-05-15T14:30:00+00:00" },
    { name: "tz-fractional-with-tz", value: "2028-05-15T14:30:00.123456Z" },

    // Minimums
    { name: "min-earliest-utc", value: "2028-01-01T00:00:00Z" },
    { name: "min-earliest-with-millis", value: "2028-01-01T00:00:00.000Z" },
    // { name: "min-earliest-furthest-east", value: "2028-01-01T00:00:00+14:00" },
    { name: "min-first-day", value: "2028-01-01" },
    { name: "min-first-month", value: "2028-01" },
    { name: "min-midnight-hour-min", value: "2028-01-01T00:00" },

    // Maximums
    { name: "max-last-second-utc", value: "2028-12-31T23:59:59Z" },
    { name: "max-last-millisecond", value: "2028-12-31T23:59:59.999Z" },
    { name: "max-sub-ms-precision", value: "2028-12-31T23:59:59.999999999Z" },
    // { name: "max-latest-furthest-west", value: "2028-12-31T23:59:59-12:00" },
    { name: "max-last-day", value: "2028-12-31" },
    { name: "max-last-month", value: "2028-12" },
    { name: "max-end-of-day-hour-min", value: "2028-12-31T23:59" },

    // Leap-year corner cases
    { name: "leap-day", value: "2028-02-29" },
    { name: "leap-day-start", value: "2028-02-29T00:00:00Z" },
    { name: "leap-day-end", value: "2028-02-29T23:59:59.999Z" },
    { name: "day-after-leap-day", value: "2028-03-01" },

    // Same instant in different timezones
    { name: "same-instant-utc", value: "2028-07-01T12:00:00Z" },
    // { name: "same-instant-western-offset", value: "2028-07-01T08:00:00-04:00" },
    // { name: "same-instant-eastern-half-hour", value: "2028-07-01T17:30:00+05:30" },
]


const rangesInteractWithPrefixesTable = [
    {
        name: "resource before request with gap",
        rangeVisual: `
             |--[P]--|
|--[R]--|
`,
        modifierExpectation: { null: false, eq: false, ne: true, gt: false, ge: false, lt: true, le: true, sa: false, eb: true, ap: false },
        tests: [
            {
                name: "tests for type: dateTime, Period, Timing, instant using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    // dateTime
                    { name: "datetime-year", type: "dateTime", value: "2026" },
                    { name: "datetime-year-month", type: "dateTime", value: "2026-06" },
                    { name: "datetime-year-month-day", type: "dateTime", value: "2026-06-15" },
                    { name: "datetime-hours-minutes", type: "dateTime", value: "2026-06-15T12:30:00+00:00" },
                    { name: "datetime-seconds", type: "dateTime", value: "2026-06-15T12:30:45+00:00" },
                    { name: "datetime-fractional-seconds", type: "dateTime", value: "2026-06-15T12:30:45.123+00:00" },
                    { name: "datetime-timezone-utc", type: "dateTime", value: "2026-06-15T12:30:45Z" },
                    { name: "datetime-timezone-positive", type: "dateTime", value: "2026-06-15T12:30:45+05:30" },
                    { name: "datetime-timezone-negative", type: "dateTime", value: "2026-06-15T12:30:45-08:00" },

                    // instant
                    { name: "instant-utc", type: "instant", value: "2026-06-15T12:30:45Z" },
                    { name: "instant-millis", type: "instant", value: "2026-06-15T12:30:45.123Z" },
                    { name: "instant-nanos", type: "instant", value: "2026-06-15T12:30:45.123456789Z" },
                    { name: "instant-timezone-positive", type: "instant", value: "2026-06-15T12:30:45+05:30" },
                    { name: "instant-timezone-negative", type: "instant", value: "2026-06-15T12:30:45-08:00" },

                    // Period — one per structural shape (precision, mixed, open)
                    { name: "period-day-precision", type: "Period", start: "2026-06-01", end: "2026-06-30" },
                    { name: "period-coarse-precision", type: "Period", start: "2026", end: "2026-12" },
                    { name: "period-precise-datetime", type: "Period", start: "2026-06-15T10:00:00Z", end: "2026-06-15T11:00:00Z" },
                    { name: "period-open-start", type: "Period", end: "2026-12-31" },
                ],
                requests: requests

            },
            {
                name: "tests for type: date using patient (birthdate)",
                resource: "Patient",
                sp: "birthdate",
                resourceTemplate: PatientTemplate,
                resourceRanges: [
                    { name: "date-year", type: "date", value: "2026" },
                    { name: "date-year-month", type: "date", value: "2026-06" },
                    { name: "date-year-month-day", type: "date", value: "2026-06-15" },
                ],
                requests: requests
            },
        ]
    },
    {
        name: "resource before request touching start",
        rangeVisual: `
        |--[P]--|
|--[R]--|
`,
        modifierExpectation: { null: false, eq: false, ne: true, gt: false, ge: false, lt: true, le: true, sa: false, eb: false, ap: false },
        tests: [
            {
                name: "tests for type: Period using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision-start", type: "Period", start: "2027-06-01", end: "2028-01-01T00:00:00Z" },
                    { name: "period-coarse-precision-start", type: "Period", start: "2027", end: "2028-01-01T00:00:00Z" },
                    { name: "period-precise-datetime-start", type: "Period", start: "2027-12-31T12:00:00Z", end: "2028-01-01T00:00:00Z" },
                    { name: "period-open-start", type: "Period", end: "2028-01-01T00:00:00Z" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                    { name: "min-earliest-utc", value: "2028-01-01T00:00:00Z" },
                    { name: "min-earliest-with-millis", value: "2028-01-01T00:00:00.000Z" },
                    { name: "min-first-day", value: "2028-01-01" },
                    { name: "min-first-month", value: "2028-01" },
                    { name: "min-midnight-hour-min", value: "2028-01-01T00:00" },
                ],
            },
        ],
    },
    {
        name: "resource overlaps request start",
        rangeVisual: `
    |--[P]--|
|--[R]--|
`,
        modifierExpectation: { null: false, eq: false, ne: true, gt: false, ge: false, lt: true, le: true, sa: false, eb: false, ap: false },
        tests: [
            {
                name: "tests for type: Period using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision", type: "Period", start: "2027-06-01", end: "2028-06-15" },
                    { name: "period-coarse-precision", type: "Period", start: "2027", end: "2028-06" },
                    { name: "period-precise-datetime", type: "Period", start: "2027-12-31T12:00:00Z", end: "2028-11-30T12:00:00Z" },
                    { name: "period-open-start", type: "Period", end: "2028-06-15" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource fully covers request",
        rangeVisual: `
    |--[P]--|
|--[R]------|
`,
        modifierExpectation: { null: false, eq: false, ne: true, gt: false, ge: false, lt: true, le: true, sa: false, eb: false, ap: false },
        tests: [
            {
                name: "tests for type: Period using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision", type: "Period", start: "2027-06-01", end: "2028-12-31" },
                    { name: "period-coarse-precision", type: "Period", start: "2027", end: "2028-12" },
                    { name: "period-precise-datetime", type: "Period", start: "2027-12-31T12:00:00Z", end: "2028-12-31T23:59:59.999Z" },
                    { name: "period-open-start", type: "Period", end: "2028-12-31" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource covers request and more",
        rangeVisual: `
  |--[P]--|
|----[R]----|
`,
        modifierExpectation: { null: false, eq: false, ne: true, gt: true, ge: true, lt: true, le: true, sa: false, eb: false, ap: true },
        tests: [
            {
                name: "tests for type: Period, dateTime using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-month-window", type: "Period", start: "2028-05", end: "2028-07" },
                    { name: "period-full-year-day-precision", type: "Period", start: "2028-01-01", end: "2028-12-31" },
                    { name: "period-precise-datetime", type: "Period", start: "2028-05-31T12:00:00Z", end: "2028-07-01T12:00:00Z" },
                    { name: "period-open-start", type: "Period", end: "2028-07-15" },

                    { name: "datetime-year", type: "dateTime", value: "2028" },
                ],
                requests: [
                    { name: "year-month", value: "2028-06" },
                ],
            },
            {
                name: "tests for type: date using patient (birthdate)",
                resource: "Patient",
                sp: "birthdate",
                resourceTemplate: PatientTemplate,
                resourceRanges: [
                    { name: "date-year", type: "date", value: "2028" },
                ],
                requests: [
                    { name: "year-month", value: "2028-06" },
                ],
            },
        ],
    },
    {
        name: "resource is instant touching request start",
        rangeVisual: `
 |----[P]----|
[R]
`,
        modifierExpectation: { null: true, eq: true, ne: false, gt: false, ge: true, lt: false, le: true, sa: false, eb: false, ap: true },
        tests: [
            {
                name: "tests for type: instant using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "instant-utc", type: "instant", value: "2028-01-01T00:00:00Z" },
                    { name: "instant-millis", type: "instant", value: "2028-01-01T00:00:00.000Z" },
                    { name: "instant-tz-positive", type: "instant", value: "2028-01-01T05:30:00+05:30" },
                    { name: "instant-tz-negative", type: "instant", value: "2027-12-31T16:00:00-08:00" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource starts with request but ends earlier",
        rangeVisual: `
|----[P]----|
|--[R]--|
`,
        modifierExpectation: { null: true, eq: true, ne: false, gt: false, ge: true, lt: false, le: true, sa: false, eb: false, ap: true },
        tests: [
            {
                name: "tests for type: Period, dateTime using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision", type: "Period", start: "2028-01-01", end: "2028-06-15" },
                    { name: "period-coarse-precision", type: "Period", start: "2028-01", end: "2028-06" },
                    { name: "period-precise-datetime", type: "Period", start: "2028-01-01T00:00:00Z", end: "2028-06-15T12:00:00Z" },
                    { name: "period-year-start-precise-end", type: "Period", start: "2028", end: "2028-11-30T12:00:00Z" },

                    { name: "datetime-year-month", type: "dateTime", value: "2028-01" },
                    { name: "datetime-year-month-day", type: "dateTime", value: "2028-01-01" },
                    { name: "datetime-seconds", type: "dateTime", value: "2028-01-01T00:00:00Z" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
            {
                name: "tests for type: date using patient (birthdate)",
                resource: "Patient",
                sp: "birthdate",
                resourceTemplate: PatientTemplate,
                resourceRanges: [
                    { name: "date-year-month", type: "date", value: "2028-01" },
                    { name: "date-year-month-day", type: "date", value: "2028-01-01" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource exactly matches request",
        rangeVisual: `
|--[P]--|
|--[R]--|
`,
        modifierExpectation: { null: true, eq: true, ne: false, gt: false, ge: true, lt: false, le: true, sa: false, eb: false, ap: true },
        tests: [
            {
                name: "tests for type: Period, dateTime using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision", type: "Period", start: "2028-01-01", end: "2028-12-31" },
                    { name: "period-year-month-precision", type: "Period", start: "2028-01", end: "2028-12" },
                    { name: "period-year-precision", type: "Period", start: "2028", end: "2028" },
                    { name: "period-precise-datetime", type: "Period", start: "2028-01-01T00:00:00Z", end: "2028-12-31T23:59:59.999Z" },

                    { name: "datetime-year", type: "dateTime", value: "2028" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
            {
                name: "tests for type: date using patient (birthdate)",
                resource: "Patient",
                sp: "birthdate",
                resourceTemplate: PatientTemplate,
                resourceRanges: [
                    { name: "date-year", type: "date", value: "2028" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource starts with request but ends later",
        rangeVisual: `
|--[P]--|
|--[R]----|
`,
        modifierExpectation: { null: false, eq: false, ne: true, gt: true, ge: true, lt: false, le: false, sa: false, eb: false, ap: true },
        tests: [
            {
                name: "tests for type: Period using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision", type: "Period", start: "2028-01-01", end: "2029-06-15" },
                    { name: "period-coarse-precision", type: "Period", start: "2028-01", end: "2029-06" },
                    { name: "period-precise-datetime", type: "Period", start: "2028-01-01T00:00:00Z", end: "2029-06-15T12:00:00Z" },
                    { name: "period-open-end", type: "Period", start: "2028-01-01" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource inside request",
        rangeVisual: `
|----[P]----|
  |--[R]--|
`,
        modifierExpectation: { null: true, eq: true, ne: false, gt: false, ge: true, lt: false, le: true, sa: false, eb: false, ap: true },
        tests: [
            {
                name: "tests for type: Period, dateTime using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision", type: "Period", start: "2028-02-01", end: "2028-11-30" },
                    { name: "period-coarse-precision", type: "Period", start: "2028-02", end: "2028-11" },
                    { name: "period-precise-datetime", type: "Period", start: "2028-06-15T10:00:00Z", end: "2028-06-15T11:00:00Z" },
                    { name: "period-single-day", type: "Period", start: "2028-06-15", end: "2028-06-15" },

                    { name: "datetime-year-month", type: "dateTime", value: "2028-06" },
                    { name: "datetime-year-month-day", type: "dateTime", value: "2028-06-15" },
                    { name: "datetime-seconds", type: "dateTime", value: "2028-06-15T12:00:00Z" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
            {
                name: "tests for type: date using patient (birthdate)",
                resource: "Patient",
                sp: "birthdate",
                resourceTemplate: PatientTemplate,
                resourceRanges: [
                    { name: "date-year-month", type: "date", value: "2028-06" },
                    { name: "date-year-month-day", type: "date", value: "2028-06-15" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource ends with request but starts later",
        rangeVisual: `
|---[P]---|
  |--[R]--|
`,
        modifierExpectation: { null: true, eq: true, ne: false, gt: false, ge: true, lt: false, le: true, sa: false, eb: false, ap: true },
        tests: [
            {
                name: "tests for type: Period, dateTime using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision", type: "Period", start: "2028-06-01", end: "2028-12-31" },
                    { name: "period-coarse-precision", type: "Period", start: "2028-06", end: "2028-12" },
                    { name: "period-precise-datetime", type: "Period", start: "2028-06-15T12:00:00Z", end: "2028-12-31T23:59:59.999Z" },
                    { name: "period-last-month-only", type: "Period", start: "2028-12", end: "2028-12-31" },

                    { name: "datetime-year-month", type: "dateTime", value: "2028-12" },
                    { name: "datetime-year-month-day", type: "dateTime", value: "2028-12-31" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
            {
                name: "tests for type: date using patient (birthdate)",
                resource: "Patient",
                sp: "birthdate",
                resourceTemplate: PatientTemplate,
                resourceRanges: [
                    { name: "date-year-month", type: "date", value: "2028-12" },
                    { name: "date-year-month-day", type: "date", value: "2028-12-31" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource overlaps request end",
        rangeVisual: `
|--[P]--|
    |--[R]--|
`,
        modifierExpectation: { null: false, eq: false, ne: true, gt: true, ge: true, lt: false, le: false, sa: false, eb: false, ap: true },
        tests: [
            {
                name: "tests for type: Period using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision", type: "Period", start: "2028-06-01", end: "2029-06-15" },
                    { name: "period-coarse-precision", type: "Period", start: "2028-06", end: "2029-06" },
                    { name: "period-precise-datetime", type: "Period", start: "2028-06-15T12:00:00Z", end: "2029-01-15T00:00:00Z" },
                    { name: "period-open-end", type: "Period", start: "2028-06-15" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource is instant touching request end",
        rangeVisual: `
|----[P]----|
           [R]
`,
        modifierExpectation: { null: true, eq: true, ne: false, gt: false, ge: true, lt: false, le: true, sa: false, eb: false, ap: true },
        tests: [
            {
                name: "tests for type: instant using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "instant-utc", type: "instant", value: "2028-12-31T23:59:59.999Z" },
                    { name: "instant-tz-positive", type: "instant", value: "2029-01-01T05:29:59.999+05:30" },
                    { name: "instant-tz-negative", type: "instant", value: "2028-12-31T15:59:59.999-08:00" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                ],
            },
        ],
    },
    {
        name: "resource after request touching end",
        rangeVisual: `
|--[P]--|
        |--[R]--|
`,
        modifierExpectation: { null: false, eq: false, ne: true, gt: true, ge: true, lt: false, le: true, sa: false, eb: false, ap: false },
        tests: [
            {
                name: "tests for type: Period using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "period-day-precision-end", type: "Period", start: "2028-12-31T23:59:59.999Z", end: "2029-06-30" },
                    { name: "period-coarse-precision-end", type: "Period", start: "2028-12-31T23:59:59.999Z", end: "2030" },
                    { name: "period-precise-datetime-end", type: "Period", start: "2028-12-31T23:59:59.999Z", end: "2029-06-15T12:00:00Z" },
                    { name: "period-open-end", type: "Period", start: "2028-12-31T23:59:59.999Z" },
                ],
                requests: [
                    { name: "year", value: "2028" },
                    { name: "max-last-second-utc", value: "2028-12-31T23:59:59Z" },
                    { name: "max-last-millisecond", value: "2028-12-31T23:59:59.999Z" },
                    { name: "max-last-day", value: "2028-12-31" },
                    { name: "max-last-month", value: "2028-12" },
                    { name: "max-end-of-day-hour-min", value: "2028-12-31T23:59" },
                ],
            },
        ],
    },
    {
        name: "resource after request with gap",
        rangeVisual: `
|--[P]--|
            |--[R]--|
`,
        modifierExpectation: { null: false, eq: false, ne: true, gt: true, ge: true, lt: false, le: false, sa: true, eb: false, ap: false },
        tests: [
            {
                name: "tests for type: dateTime, Period, instant using observation",
                resource: "Observation",
                sp: "date",
                resourceTemplate: ObservationTemplate,
                resourceRanges: [
                    { name: "datetime-year", type: "dateTime", value: "2030" },
                    { name: "datetime-year-month", type: "dateTime", value: "2030-06" },
                    { name: "datetime-year-month-day", type: "dateTime", value: "2030-06-15" },
                    { name: "datetime-hours-minutes", type: "dateTime", value: "2030-06-15T12:30:00+00:00" },
                    { name: "datetime-seconds", type: "dateTime", value: "2030-06-15T12:30:45+00:00" },
                    { name: "datetime-fractional-seconds", type: "dateTime", value: "2030-06-15T12:30:45.123+00:00" },
                    { name: "datetime-timezone-utc", type: "dateTime", value: "2030-06-15T12:30:45Z" },
                    { name: "datetime-timezone-positive", type: "dateTime", value: "2030-06-15T12:30:45+05:30" },
                    { name: "datetime-timezone-negative", type: "dateTime", value: "2030-06-15T12:30:45-08:00" },

                    { name: "instant-utc", type: "instant", value: "2030-06-15T12:30:45Z" },
                    { name: "instant-millis", type: "instant", value: "2030-06-15T12:30:45.123Z" },
                    { name: "instant-nanos", type: "instant", value: "2030-06-15T12:30:45.123456789Z" },
                    { name: "instant-timezone-positive", type: "instant", value: "2030-06-15T12:30:45+05:30" },
                    { name: "instant-timezone-negative", type: "instant", value: "2030-06-15T12:30:45-08:00" },

                    { name: "period-day-precision", type: "Period", start: "2030-06-01", end: "2030-06-30" },
                    { name: "period-coarse-precision", type: "Period", start: "2030", end: "2030-12" },
                    { name: "period-precise-datetime", type: "Period", start: "2030-06-15T10:00:00Z", end: "2030-06-15T11:00:00Z" },
                    { name: "period-open-end", type: "Period", start: "2030-01-01" },
                ],
                requests: requests
            },
            {
                name: "tests for type: date using patient (birthdate)",
                resource: "Patient",
                sp: "birthdate",
                resourceTemplate: PatientTemplate,
                resourceRanges: [
                    { name: "date-year", type: "date", value: "2030" },
                    { name: "date-year-month", type: "date", value: "2030-06" },
                    { name: "date-year-month-day", type: "date", value: "2030-06-15" },
                ],
                requests: requests
            },
        ],
    },
]

describe("search prefix matrix — range × modifier", () => {
  rangesInteractWithPrefixesTable.forEach((rangeCase) => {
    describe(rangeCase.name, () => {
      (rangeCase.tests ?? []).forEach((testCase) => {
        describe(testCase.name, () => {
          const expectedIds = (testCase.resourceRanges as ResourceRange[]).map((r) => r.name);

          beforeAll(async () => {
            for (const range of testCase.resourceRanges as ResourceRange[]) {
              const resource = { id: range.name, ...(testCase.resourceTemplate(range) as object) };
              const res = await instance.rest.update(testCase.resource, range.name, resource);
              if (res.status !== 200 && res.status !== 201) {
                throw new Error(
                  `Expected: HTTP 200 or 201 (PUT ${testCase.resource}/${range.name})\n` +
                    `Received: HTTP ${res.status}\n` +
                    `body: ${JSON.stringify(res.body, null, 2)}\n` +
                    `range: ${rangeCase.name}\n` +
                    `${rangeCase.rangeVisual.replace(/^\n|\n$/g, "")}\n` +
                    `test: ${testCase.name}`,
                );
              }
            }
          });

          afterAll(async () => {
            await cleanup(testCase.resource, expectedIds);
          });

          Object.entries(rangeCase.modifierExpectation).forEach(([modifier, shouldMatch]) => {
            const prefixLabel = modifier === "null" ? "(no prefix)" : modifier;
            const expectLabel = shouldMatch ? "match all" : "match none";
            const prefix = modifier === "null" ? "" : modifier;

            describe(`${prefixLabel} → ${expectLabel}`, () => {
              (testCase.requests as { name: string; value: string }[]).forEach((req) => {
                const query = `${testCase.sp}=${prefix}${req.value}`;
                it(query, async () => {
                  const res = await instance.rest.search(testCase.resource, query);

                  const contextBlock =
                    `range: ${rangeCase.name}\n` +
                    `${rangeCase.rangeVisual.replace(/^\n|\n$/g, "")}\n` +
                    `test: ${testCase.name}`;

                  if (res.status !== 200) {
                    throw new Error(
                      `Expected: HTTP 200 for query ${query}\n` +
                        `Received:\n` +
                        `${contextBlock}\n\n` +
                        `search failed with HTTP ${res.status} for query ${query}:\n` +
                        `${JSON.stringify(res.body, null, 2)}`,
                    );
                  }

                  const matched = idsOf(res.body).filter((id) => expectedIds.includes(id));

                  const rangesById = new Map(
                    (testCase.resourceRanges as ResourceRange[]).map((r) => [r.name, r]),
                  );
                  const formatResources = (ids: string[]): string => {
                    const maxLines = 25;
                    const out: string[] = [];
                    let i = 0;
                    for (; i < ids.length; i++) {
                      const range = rangesById.get(ids[i]);
                      if (!range) continue;
                      const resource = { id: ids[i], ...(testCase.resourceTemplate(range) as object) };
                      const block = JSON.stringify(resource, null, 2).split("\n");
                      if (out.length + block.length + (out.length ? 1 : 0) > maxLines) break;
                      if (out.length) out.push("");
                      out.push(...block);
                    }
                    if (i < ids.length) {
                      out.push(`... (${ids.length - i} more resources, output truncated)`);
                    }
                    return out.join("\n");
                  };

                  if (shouldMatch) {
                    const missing = expectedIds.filter((id) => !matched.includes(id));
                    if (missing.length > 0) {
                      throw new Error(
                        `Expected: all ${expectedIds.length} resources to match query ${query}\n` +
                          `Received:\n` +
                          `${contextBlock}\n\n` +
                          `${matched.length}/${expectedIds.length} matched for query ${query}, missing ${missing.length}:\n` +
                          `${formatResources(missing)}`,
                      );
                    }
                  } else {
                    if (matched.length > 0) {
                      throw new Error(
                        `Expected: 0 resources to match query ${query}\n` +
                          `Received:\n` +
                          `${contextBlock}\n\n` +
                          `${matched.length} matched for query ${query}, expected none:\n` +
                          `${formatResources(matched)}`,
                      );
                    }
                  }
                });
              });
            });
          });
        });
      });
    });
  });
});
