const normalizePath = (value) => String(value ?? "").replaceAll("\\", "/").replace(/^\.\//u, "");

const vendoredPath = (path) => /(?:^|\/)(?:node_modules|Frameworks|_internal)(?:\/|$)/u.test(path);

const proseNotice = (path) => /(?:^|\/)(?:THIRD_PARTY_NOTICES\.md|LICENSE(?:\.[^/]*)?|SOURCE\.md)$/iu.test(path);
const customizationPrompt = (path) => path.endsWith("public/voice-customization.mjs");

const violation = (code, path, detail) => ({ code, path, detail });

const pathViolations = (path) => [
  ...(/(?:^|\/)(?:catalog\.json|events\.jsonl|settings\.json|learner-state|review-log\.jsonl)(?:$|\/)/iu.test(path)
    ? [violation("LEARNER_DATA", path, "learner state or progress data")]
    : []),
  ...(/(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]*(?:private[-_]?key|credentials|secrets?)[^/]*|[^/]+\.(?:pem|p12|pfx|key))(?:$|\/)/iu.test(path)
    ? [violation("SECRET_FILE", path, "credential or signing material")]
    : []),
  ...(/(?:^|\/)(?:browser-profile|Cookies|Login Data|Local State)(?:$|\/)/iu.test(path)
    ? [violation("BROWSER_PROFILE", path, "browser profile data")]
    : []),
  ...(!vendoredPath(path) && /(?:^|\/)(?:logs?|caches?|speech-cache|GPUCache|Code Cache)(?:$|\/)|\.log$/iu.test(path)
    ? [violation("CACHE_OR_LOG", path, "log or cache output")]
    : []),
  ...(!vendoredPath(path) && /\.(?:wav|mp3|m4a|aiff|aac|ogg)$/iu.test(path)
    ? [violation("GENERATED_AUDIO", path, "generated or captured audio")]
    : []),
  ...(!vendoredPath(path) && /(?:^|\/)sidecars(?:\/|$)|(?:^|\/)tts(?:\/|$)|(?:leo-sensei-tts(?:\.exe)?$)|\.(?:onnx|safetensors|gguf)$/iu.test(path)
    ? [violation("BUNDLED_SPEECH", path, "bundled speech engine or model weight")]
    : []),
  ...(/(?:qwen|jvs\d*|voice[-_ ]?clone|ref(?:erence)?[-_ ]?(?:audio|voice))/iu.test(path)
    ? [violation("PERSONAL_SPEECH", path, "personal speech or reference material")]
    : []),
];

const contentViolations = ({ relativePath: path, body }) => typeof body !== "string" || vendoredPath(path)
  ? []
  : [
      ...(/(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[^\\\r\n]+\\)/u.test(body)
        ? [violation("ABSOLUTE_LOCAL_PATH", path, "absolute workstation path")]
        : []),
      ...(/-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}/u.test(body)
        ? [violation("SECRET_VALUE", path, "credential-like value")]
        : []),
      ...(!proseNotice(path) && !customizationPrompt(path) && /(?:qwen|\bjvs\d*\b|voice[-_ ]?clone|ref_audio|ref_text|reference[-_ ]?(?:audio|voice))/iu.test(body)
        ? [violation("PERSONAL_SPEECH", path, "personal speech or reference material")]
        : []),
    ];

const commonRequirements = Object.freeze([
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "decks/manifest.json",
  "decks/n1-vocabulary.json",
  "decks/n2-vocabulary.json",
  "decks/n3-vocabulary.json",
  "decks/n4-vocabulary.json",
  "decks/n5-vocabulary.json",
  "decks/LICENSE.open-anki-jlpt-decks",
  "decks/SOURCE.md",
]);

const requiredViolations = (paths) => commonRequirements
  .filter((required) => !paths.some((path) => path.endsWith(required)))
  .map((required) => violation("MISSING_REQUIRED", "", required));

export const scanReleaseEntries = (entries, _options = {}) => ((normalized) => [
  ...normalized.flatMap(({ relativePath }) => pathViolations(relativePath)),
  ...normalized.flatMap(contentViolations),
  ...requiredViolations(normalized.map(({ relativePath }) => relativePath)),
])((Array.isArray(entries) ? entries : []).map((entry) => ({
  ...entry,
  relativePath: normalizePath(entry.relativePath),
})));
