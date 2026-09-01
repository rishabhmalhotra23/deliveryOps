import { describe, it, expect } from "vitest";
import { validateSurveySubmission, InvalidSurveySubmissionError } from "@/lib/nps/responses";

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    respondentName: "Alice",
    companyName: "Acme Corp",
    score: 9,
    productSatisfaction: 5,
    automationTargetRange: "6-10",
    automationFunctions: ["Finance", "Operations"],
    easeCreatingAutomation: 4,
    easeBusinessUserAcceptance: 4,
    easeBusinessCase: 3,
    easeIdentifyingProcesses: 5,
    easeSelfSufficiency: 4,
    easeSupportGuidance: 5,
    journeySuccessAgreement: 5,
    feedback: "Great experience overall.",
    ...overrides,
  };
}

describe("validateSurveySubmission", () => {
  it("accepts a fully valid submission", () => {
    const result = validateSurveySubmission(validBody());
    expect(result.score).toBe(9);
    expect(result.productSatisfaction).toBe(5);
    expect(result.automationFunctions).toEqual(["Finance", "Operations"]);
    expect(result.automationFunctionsOther).toBeNull();
  });

  it("requires respondentName", () => {
    expect(() => validateSurveySubmission(validBody({ respondentName: "  " }))).toThrow(InvalidSurveySubmissionError);
  });

  it("requires companyName", () => {
    expect(() => validateSurveySubmission(validBody({ companyName: "" }))).toThrow(InvalidSurveySubmissionError);
  });

  it.each([-1, 11, 5.5, "abc"])("rejects an out-of-range or non-integer score (%s)", (bad) => {
    expect(() => validateSurveySubmission(validBody({ score: bad }))).toThrow(InvalidSurveySubmissionError);
  });

  it.each([0, 6, 3.5])("rejects an out-of-range or non-integer productSatisfaction (%s)", (bad) => {
    expect(() => validateSurveySubmission(validBody({ productSatisfaction: bad }))).toThrow(
      InvalidSurveySubmissionError
    );
  });

  it("rejects an invalid automationTargetRange", () => {
    expect(() => validateSurveySubmission(validBody({ automationTargetRange: "1000+" }))).toThrow(
      InvalidSurveySubmissionError
    );
  });

  it("requires at least one automationFunctions entry", () => {
    expect(() => validateSurveySubmission(validBody({ automationFunctions: [] }))).toThrow(
      InvalidSurveySubmissionError
    );
  });

  it("rejects an unknown automationFunctions entry", () => {
    expect(() => validateSurveySubmission(validBody({ automationFunctions: ["Marketing Ops"] }))).toThrow(
      InvalidSurveySubmissionError
    );
  });

  it("requires automationFunctionsOther when 'Other' is selected", () => {
    expect(() =>
      validateSurveySubmission(validBody({ automationFunctions: ["Other"], automationFunctionsOther: "" }))
    ).toThrow(InvalidSurveySubmissionError);
  });

  it("accepts 'Other' with a specified value", () => {
    const result = validateSurveySubmission(
      validBody({ automationFunctions: ["Other"], automationFunctionsOther: "Legal" })
    );
    expect(result.automationFunctionsOther).toBe("Legal");
  });

  it.each([
    "easeCreatingAutomation",
    "easeBusinessUserAcceptance",
    "easeBusinessCase",
    "easeIdentifyingProcesses",
    "easeSelfSufficiency",
    "easeSupportGuidance",
    "journeySuccessAgreement",
  ])("rejects an out-of-range %s", (field) => {
    expect(() => validateSurveySubmission(validBody({ [field]: 6 }))).toThrow(InvalidSurveySubmissionError);
  });

  it("requires feedback", () => {
    expect(() => validateSurveySubmission(validBody({ feedback: "" }))).toThrow(InvalidSurveySubmissionError);
  });
});
