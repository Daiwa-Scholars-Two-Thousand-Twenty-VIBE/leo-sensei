const gateModes = new Set(["off", "prompt", "redirect"]);

const freeze = (value) => value && typeof value === "object"
  ? (Object.values(value).map(freeze), Object.freeze(value))
  : value;

const defaults = Object.freeze({
  version: 2,
  requiredDailyCount: 100,
  studyListDailyNew: Object.freeze({ "n5-vocabulary": 10 }),
  gateMode: "off",
  gatedApplications: Object.freeze([]),
  onboardingComplete: false,
});

const issue = (field, message) => ({ field, message });

const legacyDeckId = (value) => String(value ?? "n5").trim();

const migratedDeckId = (value) => /^n[1-5]$/u.test(legacyDeckId(value))
  ? `${legacyDeckId(value)}-vocabulary`
  : legacyDeckId(value);

const migrateVersion1 = (value) => ({
  version: 2,
  requiredDailyCount: value.requiredDailyCount,
  studyListDailyNew: { [migratedDeckId(value.deckId)]: 10 },
  gateMode: value.gateMode,
  gatedApplications: value.gatedApplications,
  onboardingComplete: value.onboardingComplete,
});

const migratedSettings = (value) => Number(value?.version ?? 2) === 1
  ? migrateVersion1({ ...defaults, ...value })
  : value;

const validStudyListDailyNew = (value) => Boolean(
  value
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.entries(value).every(([id, count]) => id.trim().length > 0
    && Number.isInteger(count)
    && count >= 0
    && count <= 100),
);

const settingsIssues = (value) => [
  ...(!value || typeof value !== "object" || Array.isArray(value)
    ? [issue("settings", "Settings must be an object.")]
    : []),
  ...(value?.version !== undefined && value.version !== 2
    ? [issue("version", "Only settings version 2 is supported after migration.")]
    : []),
  ...(!Number.isInteger(value?.requiredDailyCount) || value.requiredDailyCount < 1
    ? [issue("requiredDailyCount", "Required daily count must be a positive integer.")]
    : []),
  ...(!validStudyListDailyNew(value?.studyListDailyNew)
    ? [issue("studyListDailyNew", "Study-list daily counts must be whole numbers from 0 to 100.")]
    : []),
  ...(!gateModes.has(value?.gateMode)
    ? [issue("gateMode", "Gate mode must be off, prompt, or redirect.")]
    : []),
  ...(!Array.isArray(value?.gatedApplications) || value.gatedApplications.some(
    (application) => typeof application !== "string" || application.trim().length === 0,
  )
    ? [issue("gatedApplications", "Gated application identifiers must be non-empty strings.")]
    : []),
  ...(typeof value?.onboardingComplete !== "boolean"
    ? [issue("onboardingComplete", "Onboarding state must be boolean.")]
    : []),
];

export const defaultLearnerSettings = () => freeze(structuredClone(defaults));

export const normalizeLearnerSettings = (input = {}) => ((inputIsObject) => ((candidate) => ((issues) => issues.length > 0
  ? { ok: false, error: { code: "INVALID_SETTINGS", issues } }
  : {
      ok: true,
      value: freeze({
        version: 2,
        requiredDailyCount: candidate.requiredDailyCount,
        studyListDailyNew: Object.fromEntries(Object.entries(candidate.studyListDailyNew)
          .map(([id, count]) => [id.trim(), count])),
        gateMode: candidate.gateMode,
        gatedApplications: [...new Set(candidate.gatedApplications.map((application) => application.trim()))],
        onboardingComplete: candidate.onboardingComplete,
      }),
    })([
      ...(inputIsObject ? [] : [issue("settings", "Settings must be an object.")]),
      ...settingsIssues(candidate),
    ]))({ ...defaultLearnerSettings(), ...migratedSettings(inputIsObject ? input : {}) }))(
  Boolean(input && typeof input === "object" && !Array.isArray(input)),
);
