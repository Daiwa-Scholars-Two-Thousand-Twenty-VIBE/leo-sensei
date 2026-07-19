import { bind } from "/vendor/wanakana.mjs";
import {
  cancelJapaneseSpeech,
  japaneseSpeechText,
  playNeuralJapaneseSpeech,
  primeNeuralJapaneseSpeech,
} from "./speech.mjs";
import { gatedApplicationOptions, onboardingSettings } from "./onboarding-core.mjs";
import { initialUiState, reduceUi } from "./ui-core.mjs";
import { jsonMutationOptions } from "./http.mjs";
import {
  copyVoiceCustomizationPrompt,
  voiceCustomizationContentMarkup,
} from "./voice-customization.mjs";

const root = document.querySelector("#app");
const neuralAudio = new Audio();

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const fetchJson = (url, options, callback) =>
  fetch(url, options)
    .then((response) => response.json().then((payload) => ({ response, payload })))
    .then(({ response, payload }) =>
      response.ok
        ? callback({ ok: true, value: payload })
        : callback({ ok: false, error: payload.message ?? payload.error ?? response.statusText }))
    .catch((requestError) => callback({ ok: false, error: requestError.message }));

const postJson = (url, body, callback) => fetchJson(
  url,
  jsonMutationOptions("POST", body),
  callback,
);

const putJson = (url, body, callback) => fetchJson(
  url,
  jsonMutationOptions("PUT", body),
  callback,
);

const fetchValue = (url, options) => new Promise((resolve) => fetchJson(url, options, resolve));

const phaseName = (phase) => ({ reading: "Reading", meaning: "Meaning", reverse: "Japanese" })[phase] ?? "Answer";

const kindName = (type) => ({ kanji: "Kanji", vocabulary: "Vocabulary" })[type] ?? "Review";

const effectiveGateMode = (state) => state.gateBehavior === "prompt" && state.daily?.mode === "redirect"
  ? "prompt"
  : state.daily?.mode;

const gateModeName = (state) => ({
  off: "Browser block off",
  prompt: "Review reminders on",
  redirect: "Browser block on",
})[effectiveGateMode(state)] ?? "Browser block off";

const accessName = (state) => effectiveGateMode(state) === "prompt"
  ? state.daily.accessAllowed ? "Reviews complete" : "Reviews waiting"
  : state.daily.accessAllowed ? "Browsers available" : "Browsers blocked";

const activeCard = (state) => state.daily?.queue?.find(({ id }) => id === state.currentId) ?? state.daily?.queue?.[0] ?? null;

const speakFeedback = (feedback) => playNeuralJapaneseSpeech({
  player: neuralAudio,
  text: japaneseSpeechText(feedback),
});

const cancelSpeech = () => cancelJapaneseSpeech({
  player: neuralAudio,
});

const progressValues = (daily) => {
  const scheduled = daily.progress.scheduled;
  const reactivations = daily.progress.reactivations;
  const required = scheduled.required + reactivations.required;
  const cleared = scheduled.eventuallyCorrect + reactivations.eventuallyCorrect;
  return {
    cleared,
    required,
    width: required === 0 ? 100 : Math.min(100, cleared / required * 100),
  };
};

const clockTime = (iso) => ((date) => Number.isNaN(date.getTime())
  ? ""
  : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }))(new Date(iso ?? ""));

const durationLabel = (value) => ((minutes) => minutes % 60 === 0
  ? `${minutes / 60} hour${minutes / 60 === 1 ? "" : "s"}`
  : `${minutes} minutes`)(Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 240);

const plannedNewCards = (lists) => lists.reduce((total, list) => total + Number(list.dailyNew ?? 0), 0);

const reviewReserve = (daily) => ((progress) => ((completed, available, total, threshold) => ((markerPct) => ({
  completed,
  available,
  total,
  threshold,
  remaining: Math.max(0, threshold - completed),
  fillPct: total > 0 ? Math.min(100, completed / total * 100) : 0,
  markerPct,
  markerEdge: markerPct > 92 ? "edge-end" : markerPct < 8 ? "edge-start" : "",
  makeup: Number(daily.makeupReviews ?? 0),
  makeupTomorrow: Number(daily.makeupTomorrow ?? 0),
  onBypass: ["temporary_bypass", "emergency_unlock"].includes(daily.accessReason),
  bypassUntil: daily.bypassUntil ?? null,
  unlocked: Boolean(daily.complete),
}))(total > 0 ? Math.min(100, threshold / total * 100) : 0))(
  progress.cleared + Number(daily.extraReviewsDone ?? 0),
  Number(daily.availableReviews ?? 0),
  Math.max(progress.required, Number(daily.availableReviews ?? 0)),
  progress.required,
))(progressValues(daily));

const lessonReserve = (daily, plannedNew) => ((total) => ((completed) => ({
  completed,
  total,
  fillPct: total > 0 ? Math.min(100, completed / total * 100) : 0,
}))(Number(daily.todayLesson?.completed ?? 0)))(Number(daily.todayLesson?.total ?? 0) || plannedNew);

const reviewActionCopy = (reviews) => reviews.unlocked
  ? "Complete for today"
  : reviews.onBypass
    ? ((time) => `Emergency Unlock Active. It will relock ${time ? `at ${time}` : "soon"}.${reviews.makeupTomorrow > 0 ? ` +${reviews.makeupTomorrow} extra reviews tomorrow.` : ""}`)(clockTime(reviews.bypassUntil))
    : `Clear ${reviews.remaining} more to unlock${reviews.makeup > 0 ? ` - +${reviews.makeup} from emergency unlock` : ""}`;

const headerMarkup = (state) => {
  const progress = progressValues(state.daily);
  const accessOpen = state.daily.accessAllowed;
  return `
    <header class="topbar">
      <button class="brand brand-button" data-view="home" type="button" aria-label="Open home">${brandMarkup}</button>
      <div class="topbar-status">
        <span class="mode-badge">${gateModeName(state)}</span>
        <span class="access-badge ${accessOpen ? "open" : "locked"}">
          <span class="status-dot" aria-hidden="true"></span>${accessName(state)}
        </span>
        ${state.daily.complete ? "" : '<button id="bypassButton" class="quiet-button" type="button">Emergency unlock</button>'}
        <button class="quiet-button" data-view="voice" type="button">Voice</button>
        <button class="quiet-button" data-view="settings" type="button">Settings</button>
      </div>
      <div class="daily-progress" aria-label="Daily review progress">
        <div class="progress-copy"><strong>${progress.cleared}</strong><span>of ${progress.required} cleared</span></div>
        <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${progress.width}%"></div></div>
        <span class="accuracy">Misses return until correct</span>
      </div>
    </header>`;
};

const answerMarkup = (state, card) => `
  <section class="review-stage kind-${escapeHtml(card.type)} phase-${escapeHtml(state.phase)}">
    <div class="review-context">
      <span class="kind-label">${kindName(card.type)}</span>
      <span class="queue-count">${state.daily.queue.length} remaining</span>
    </div>
    <div class="prompt-wrap">
      <div class="prompt-label">${phaseName(state.phase)}</div>
      <h1 class="study-prompt ${card.promptDirection === "reverse" ? "reverse" : ""}" lang="${card.promptDirection === "reverse" ? "en" : "ja"}">${escapeHtml(card.prompt)}</h1>
    </div>
    <form id="answerForm" class="answer-form">
      <label for="answerInput">${phaseName(state.phase)}</label>
      <div class="answer-control">
        <input
          id="answerInput"
          name="answer"
          lang="${state.phase === "meaning" ? "en" : "ja"}"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="${state.phase === "meaning"}"
          required
        />
        <button class="primary-button" type="submit" ${state.submitting ? "disabled" : ""}>${state.phase === "reading" ? "Next" : "Check"}</button>
      </div>
    </form>
  </section>`;

const answerResult = (label, submitted, correct, expected) => submitted
  ? `<div class="answer-result ${correct ? "correct" : "wrong"}">
      <span class="result-mark" aria-hidden="true">${correct ? "✓" : "×"}</span>
      <div class="result-copy">
        <span class="result-label">${escapeHtml(label)}</span>
        <strong class="submitted-answer">${escapeHtml(submitted)}</strong>
        ${correct ? "" : `<div class="expected-answer"><span>Correct answer</span><strong>${escapeHtml(expected)}</strong></div>`}
      </div>
    </div>`
  : "";

const aliasButton = (kind, value, saved, saving) => saved === kind
  ? `<span class="alias-saved">Accepted for future reviews</span>`
  : `<button class="alias-button" type="button" data-alias-kind="${kind}" data-alias-value="${escapeHtml(value)}" ${saving ? "disabled" : ""}>Accept “${escapeHtml(value)}”</button>`;

const feedbackMarkup = (state) => {
  const feedback = state.feedback;
  const readingAlias = !feedback.readingCorrect && feedback.submittedReading
    ? aliasButton("reading", feedback.submittedReading, feedback.aliasSaved, state.aliasSaving)
    : "";
  const meaningAlias = !feedback.meaningCorrect && feedback.submittedMeaning
    ? aliasButton("meaning", feedback.submittedMeaning, feedback.aliasSaved, state.aliasSaving)
    : "";
  const resultClass = feedback.correct ? "correct" : "wrong";
  return `
    <section class="feedback-stage ${resultClass} kind-${escapeHtml(feedback.cardType)}">
      <div class="feedback-heading">
        <span class="feedback-symbol" aria-hidden="true">${feedback.correct ? "✓" : "×"}</span>
        <div><span>Result</span><h1>${feedback.correct ? "Correct" : "Not quite"}</h1></div>
      </div>
      <div class="result-grid">
        ${answerResult("Reading", feedback.submittedReading, feedback.readingCorrect, feedback.expectedReading)}
        ${answerResult("Meaning", feedback.submittedMeaning, feedback.meaningCorrect, feedback.expectedMeanings.join("; "))}
        ${feedback.submittedReading || feedback.submittedMeaning ? "" : answerResult("Japanese", feedback.submittedReverse, feedback.correct, feedback.expectedSurface)}
      </div>
      ${readingAlias || meaningAlias ? `<div class="alias-actions">${readingAlias}${meaningAlias}</div>` : ""}
      <div class="accepted-answer">
        <div class="accepted-answer-copy">
          <span>Accepted answer</span>
          <strong lang="ja">${escapeHtml(feedback.expectedSurface)}</strong>
          ${feedback.expectedReading ? `<span lang="ja">${escapeHtml(feedback.expectedReading)}</span>` : ""}
          <div class="accepted-meanings">
            <span>Meanings</span>
            <ul class="meaning-list">${feedback.expectedMeanings.map((meaning) => `<li>${escapeHtml(meaning)}</li>`).join("")}</ul>
          </div>
        </div>
        ${state.daily.speechAvailable ? `<button id="audioButton" class="audio-button" type="button" title="Play Japanese pronunciation">
          <span aria-hidden="true">▶</span><span>Hear again</span>
        </button>` : ""}
      </div>
      <div class="feedback-actions ${feedback.answerEventId ? "" : "single"}">
        ${feedback.answerEventId
          ? `<button id="redoButton" class="quiet-button redo-button" type="button" ${state.submitting ? "disabled" : ""}><span aria-hidden="true">↻</span><span>Redo word</span></button>`
          : ""}
        <button id="continueButton" class="primary-button continue-button" type="button" ${state.submitting ? "disabled" : ""} autofocus>Continue</button>
      </div>
    </section>`;
};

const completeMarkup = (state) => `
  <section class="complete-stage">
    <div class="completion-mark" aria-hidden="true">✓</div>
    <span>${state.daily.lesson ? "New words" : state.daily.extra ? "Extra study" : "Daily study"}</span>
    <h1>${state.daily.lesson ? "Lesson complete" : state.daily.extra ? "Batch complete" : "You’re clear for today"}</h1>
    <p>${state.daily.lesson ? "These cards are now in your review schedule." : state.daily.extra ? "Scheduling state updated." : "Work access is open."}</p>
    <div class="completion-actions"><button class="quiet-button" data-view="home" type="button">Home</button>${state.daily.lesson ? "" : `<button id="extraButton" class="primary-button" type="button">${state.daily.extra ? "Another 100" : "Review 100 more"}</button>`}</div>
  </section>`;

const bypassDescription = (state) => ((makeupTomorrow) => state.gateBehavior === "prompt"
  ? `This pauses review reminders for ${durationLabel(state.daily.bypassMinutes)}. ${makeupTomorrow} reviews will be added tomorrow.`
  : `This unlocks your selected browsers for ${durationLabel(state.daily.bypassMinutes)}. ${makeupTomorrow} reviews will be added tomorrow.`)(
  Number(state.daily.makeupReviews ?? 0) + Math.ceil(state.settings.requiredDailyCount / 2),
);

const bypassMarkup = (state) => state.bypassOpen
  ? `<dialog id="bypassDialog">
      <div class="dialog-header"><h2>Emergency unlock</h2><p>${bypassDescription(state)}</p></div>
      <form id="bypassForm" class="bypass-form">
        <label for="bypassReason">Reason</label>
        <textarea id="bypassReason" name="reason" required></textarea>
        <div class="dialog-actions">
          <button id="cancelBypass" class="quiet-button" type="button">Cancel</button>
          <button class="primary-button" type="submit">Unlock ${durationLabel(state.daily.bypassMinutes)}</button>
        </div>
      </form>
    </dialog>`
  : "";

const brandMarkup = '<span class="brand-mark" aria-hidden="true">日</span><span>Leo Sensei <span lang="ja">の-nonsense 日本語</span></span>';

const dailyNewMarkup = (state, compact = false) => `<div class="study-list-inputs ${compact ? "compact" : ""}">
  ${state.studyLists.map((list) => `
    <label class="study-list-input">
      <span><strong>${escapeHtml(list.label)}</strong><small>${Number(list.progress?.total ?? 0).toLocaleString()} words</small></span>
      <span class="daily-new-control"><span>New / day</span><input name="dailyNew:${escapeHtml(list.id)}" type="number" min="0" max="100" step="1" value="${escapeHtml(state.settings.studyListDailyNew?.[list.id] ?? list.dailyNew ?? 0)}" /></span>
    </label>`).join("")}
</div>`;

const dailyNewSummaryMarkup = (state) => `<div class="study-list-inputs compact">
  ${state.studyLists.map((list) => ((count) => `
    <div class="study-list-input study-list-summary">
      <span><strong>${escapeHtml(list.label)}</strong><small>${Number(list.progress?.total ?? 0).toLocaleString()} words</small></span>
      <span><strong>${count === 0 ? "Paused" : count}</strong><small>${count === 0 ? "" : count === 1 ? "new word / day" : "new words / day"}</small></span>
    </div>`)(Number(state.settings.studyListDailyNew?.[list.id] ?? list.dailyNew ?? 0))).join("")}
</div>`;

const applicationOptionsMarkup = ({ applications, hiddenLegend = false, legend, name, settings }) => applications.length > 0
  ? `<fieldset class="application-options">
      <legend class="${hiddenLegend ? "visually-hidden" : ""}">${escapeHtml(legend)}</legend>
      ${applications.map(({ identity, name: applicationName }) => `
        <label class="application-option">
          <input type="checkbox" name="${name}" value="${escapeHtml(identity)}" ${(settings.gatedApplications ?? []).includes(identity) ? "checked" : ""} />
          <span>${escapeHtml(applicationName)}</span>
        </label>`).join("")}
    </fieldset>`
  : "";

const browserModeMarkup = (state, onboarding) => onboarding
  ? `<input name="gateMode" type="hidden" value="${state.gateBehavior === "prompt" ? "prompt" : "redirect"}" />`
  : `<fieldset class="segmented-control">
      <legend>${state.gateBehavior === "prompt" ? "Review reminders" : "Browser blocking"}</legend>
      ${(state.gateBehavior === "prompt"
        ? [["off", "No reminders"], ["prompt", "Remind me"]]
        : [["off", "No blocking"], ["prompt", "Remind me"], ["redirect", "Block selected browsers"]]
      ).map(([value, label]) => `<label><input type="radio" name="gateMode" value="${value}" ${(state.settings.gateMode === "redirect" && state.gateBehavior === "prompt" ? "prompt" : state.settings.gateMode) === value ? "checked" : ""} /><span>${label}</span></label>`).join("")}
    </fieldset>`;

const customListImportMarkup = (formId) => `<form id="${formId}" class="file-form custom-list-form" data-import-form>
  <label for="${formId}Label">List name</label>
  <input id="${formId}Label" name="label" type="text" required />
  <label for="${formId}File">CSV or TSV file</label>
  <input id="${formId}File" name="table" type="file" accept="text/csv,text/tab-separated-values,.csv,.tsv" required />
  <button class="quiet-button" type="submit">Add list</button>
</form>`;

const settingsFieldsMarkup = (state, { formId, onboarding = false, submitLabel }) => `
  <form id="${formId}" class="settings-form">
    <fieldset class="form-section">
      <legend>New words</legend>
      <p>Set New / day for each list. Use 0 to pause a list. You can add your own list after setup.</p>
      ${dailyNewMarkup(state, true)}
      <p class="source-note">Unofficial lists. The JLPT does not publish official vocabulary lists.</p>
    </fieldset>
    <fieldset class="form-section">
      <legend>How many reviews should you finish each day?</legend>
      <label class="number-field" for="requiredDailyCount">
        <span>Reviews</span>
        <input id="requiredDailyCount" name="requiredDailyCount" type="number" min="1" step="1" value="${escapeHtml(state.settings.requiredDailyCount)}" required />
      </label>
    </fieldset>
    <fieldset class="form-section">
      <legend>Browsers</legend>
      <p>${state.gateBehavior === "prompt"
        ? "Linux Wayland cannot block browser windows. Leo Sensei will remind you to finish today’s reviews instead. You can still choose browsers for an X11 session."
        : "Choose your main browser. Leo Sensei will block it until you finish today’s reviews. You can choose more than one."}</p>
      ${browserModeMarkup(state, onboarding)}
      ${applicationOptionsMarkup({ applications: state.browserCandidates, hiddenLegend: true, legend: "Browser choices", name: "selectedBrowsers", settings: state.settings })}
      <p>Other apps are optional. Codex or Claude running in Terminal count as Terminal. To block another app, ask your AI coding agent to add it.</p>
      ${applicationOptionsMarkup({ applications: state.applicationCandidates, legend: "Other apps (optional)", name: "selectedApplications", settings: state.settings })}
    </fieldset>
    ${state.error ? `<div class="form-error" role="alert">${escapeHtml(state.error)}</div>` : ""}
    <div class="form-submit"><button class="primary-button" type="submit" ${state.submitting ? "disabled" : ""}>${submitLabel}</button></div>
  </form>`;

const onboardingGuideMarkup = (state) => `
  <section class="onboarding-guide" aria-labelledby="onboardingGuideTitle">
    <div class="onboarding-guide-heading"><span>How it works</span><h2 id="onboardingGuideTitle">A daily rhythm you control</h2></div>
    <ol>
      <li><span>1</span><div><strong>Choose your pace</strong><p>Set your required reviews per day, then choose New / day for each study list. New words you learn enter your future reviews, and you can add your own study lists after setup.</p></div></li>
      <li><span>2</span><div><strong>Finish reviews to unlock</strong><p>When blocking is enabled, selected browsers and apps stay blocked until you finish today’s required reviews.</p></div></li>
      <li><span>3</span><div><strong>Emergency access has a cost</strong><p>Emergency unlock opens access for ${durationLabel(state.daily.bypassMinutes)} and adds 50 reviews to the next day. Consecutive emergency unlocks accumulate: +50, +100, +150.</p></div></li>
    </ol>
  </section>`;

const onboardingMarkup = (state) => `
  <main class="onboarding-shell">
    <div class="onboarding-form-wrap">
      <header class="onboarding-heading"><span class="onboarding-mark" aria-hidden="true">日</span><h1>Leo Sensei <span lang="ja">の-nonsense 日本語</span></h1><p>Choose what you want to study and how many reviews you want to do each day.</p></header>
      ${onboardingGuideMarkup(state)}
      ${settingsFieldsMarkup(state, { formId: "onboardingForm", onboarding: true, submitLabel: "Start studying" })}
      <button class="source-link" data-view="sources" type="button">Sources and licenses</button>
    </div>
  </main>`;

const managementHeaderMarkup = (state, title) => `
  <header class="management-topbar">
    <button class="brand brand-button" data-view="${state.settings.onboardingComplete ? "home" : "onboarding"}" type="button" aria-label="${state.settings.onboardingComplete ? "Open home" : "Return to setup"}">${brandMarkup}</button>
    <h1>${escapeHtml(title)}</h1>
    <nav aria-label="Application">${state.settings.onboardingComplete
      ? '<button class="quiet-button" data-view="home" type="button">Home</button><button class="quiet-button" data-view="review" type="button">Review</button><button class="quiet-button" data-view="lists" type="button">Study lists</button><button class="quiet-button" data-view="settings" type="button">Settings</button>'
      : '<button class="quiet-button" data-view="onboarding" type="button">Setup</button>'}<button class="quiet-button" data-view="voice" type="button">Voice</button><button class="quiet-button" data-view="sources" type="button">Sources</button></nav>
  </header>`;

const accuracyMarkup = (accuracy) => accuracy?.attempts > 0 ? `${Math.round(accuracy.rate * 100)}%` : "-";

const statsMarkup = (stats) => stats
  ? `<section class="stats-band" aria-label="Study statistics">
      <div><strong>${stats.streak}</strong><span>day streak</span></div>
      <div><strong>${accuracyMarkup(stats.accuracy.sevenDays)}</strong><span>7-day accuracy</span></div>
      <div><strong>${stats.progress.kanji.started + stats.progress.vocabulary.started}</strong><span>cards started</span></div>
      <div><strong>${stats.progress.kanji.expert + stats.progress.vocabulary.expert}</strong><span>expert cards</span></div>
    </section>`
  : "";

const homeMarkup = (state) => ((reviews, plannedNew) => ((lessons) => `
  ${managementHeaderMarkup(state, "Today")}
  <main class="home-main">
    <section class="home-actions">
      <button id="homeReviewButton" class="home-action review-action" type="button">
        <span>Reviews</span>
        <strong>${reviews.completed} / ${reviews.available}</strong>
        <span class="review-reserve-track" aria-label="${reviews.completed} of ${reviews.available} reviews cleared, unlock at ${reviews.threshold}">
          <span class="review-reserve-fill" style="width:${reviews.fillPct}%"></span>
          <span class="review-unlock-marker ${reviews.markerEdge}" style="left:${reviews.markerPct}%" title="Unlock at ${reviews.threshold}"><span>${reviews.threshold}</span></span>
        </span>
        <small>${reviewActionCopy(reviews)}</small>
      </button>
      <button id="homeLessonButton" class="home-action lesson-action" type="button" ${plannedNew === 0 ? "disabled" : ""}><span>Learn new words</span><strong>${lessons.completed} / ${lessons.total}</strong><span class="review-reserve-track" aria-label="${lessons.completed} of ${lessons.total} new words learned"><span class="review-reserve-fill" style="width:${lessons.fillPct}%"></span></span><small>${plannedNew === 0 ? "Set a study list" : state.daily.todayLesson?.total > 0 ? "Lesson in progress" : "Ready when you are"}</small></button>
    </section>
    ${statsMarkup(state.stats)}
    <section class="home-lists"><div class="pane-heading"><span>Plan</span><h2>Study lists</h2></div>${dailyNewSummaryMarkup(state)}<button class="quiet-button" data-view="lists" type="button">Manage lists</button></section>
  </main>`)(lessonReserve(state.daily, plannedNew)))(reviewReserve(state.daily), plannedNewCards(state.studyLists));

const studyListsMarkup = (state) => `
  ${managementHeaderMarkup(state, "Study lists")}
  <main class="management-main study-lists-main">
    ${state.notice ? `<div class="notice-band" role="status">${escapeHtml(state.notice)}</div>` : ""}
    <form id="studyListsForm" class="study-lists-form">
      ${dailyNewMarkup(state)}
      ${state.error ? `<div class="form-error" role="alert">${escapeHtml(state.error)}</div>` : ""}
      <div class="form-submit"><button class="primary-button" type="submit">Save daily plan</button></div>
    </form>
    <section class="add-list-section"><h2>Add your own list</h2><p>Import a CSV or TSV file with word, reading, meaning, and type columns.</p>${customListImportMarkup("studyListImportForm")}</section>
  </main>`;

const settingsMarkup = (state) => `
  ${managementHeaderMarkup(state, "Settings")}
  <main class="management-main">
    ${state.notice ? `<div class="notice-band" role="status">${escapeHtml(state.notice)}</div>` : ""}
    ${statsMarkup(state.stats)}
    <div class="management-layout">
      <section class="settings-pane"><div class="pane-heading"><h2>Daily setup</h2></div>${settingsFieldsMarkup(state, { formId: "settingsForm", submitLabel: "Save settings" })}</section>
      <aside class="data-pane">
        <section><div class="pane-heading"><span>Backup</span><h2>Learner data</h2></div><button id="backupButton" class="quiet-button full-button" type="button">Download backup</button><form id="restoreForm" class="file-form"><label for="restoreFile">Restore backup</label><input id="restoreFile" name="backup" type="file" accept="application/json,.json" required /><button class="quiet-button" type="submit">Restore</button></form></section>
        <section><div class="pane-heading"><h2>Add your own list</h2></div>${customListImportMarkup("settingsImportForm")}</section>
      </aside>
    </div>
  </main>`;

const sourcesMarkup = (state) => `
  ${managementHeaderMarkup(state, "Sources")}
  <main class="sources-main">
    <header><span>About</span><h2>Built for direct, local study.</h2><p>Leo Sensei の-nonsense 日本語 keeps progress on this computer as an append-only learning history.</p></header>
    <section><span>Vocabulary decks</span><h3>Unofficial JLPT approximations</h3><p>N5-N1 vocabulary is derived from <strong>open-anki-jlpt-decks</strong>, pinned at commit <code>1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0</code>. MIT License, Copyright (c) 2020 Jamie Sinclair.</p><p>The JLPT does not publish official vocabulary lists. Each list has its own New / day setting.</p></section>
    <section><span>Dictionary material</span><h3>EDRDG acknowledgement</h3><p>This product may use material from the JMdict and KANJIDIC2 dictionary files. Copyright is held by the Electronic Dictionary Research and Development Group and contributors. Dictionary material is used under CC BY-SA 4.0.</p></section>
    <section><span>Runtime</span><h3>Open components</h3><p>FSRS scheduling uses ts-fsrs. Japanese input uses WanaKana. Pronunciation is unavailable by default and appears only when an optional external loopback service is configured.</p></section>
  </main>`;

const voiceMarkup = (state) => `${managementHeaderMarkup(state, "Voice")}${voiceCustomizationContentMarkup}`;

const pageMarkup = (state) => {
  const card = activeCard(state);
  const content = state.feedback
    ? feedbackMarkup(state)
    : state.daily.complete
      ? completeMarkup(state)
      : card
        ? answerMarkup(state, card)
        : '<section class="complete-stage"><h1>Queue unavailable</h1></section>';
  return state.view === "onboarding"
    ? onboardingMarkup(state)
    : state.view === "home"
      ? homeMarkup(state)
      : state.view === "lists"
        ? studyListsMarkup(state)
    : state.view === "settings"
      ? settingsMarkup(state)
      : state.view === "voice"
        ? voiceMarkup(state)
        : state.view === "sources"
          ? sourcesMarkup(state)
          : `
          ${headerMarkup(state)}
          ${state.error ? `<div class="error-band" role="alert">${escapeHtml(state.error)}</div>` : ""}
          <main class="review-main">${content}</main>
          ${bypassMarkup(state)}`;
};

const reviewPayload = (state, answer) => ({
  extraSessionId: state.daily.extraSessionId,
  cardId: state.currentId,
  readingAnswer: state.readingAnswer,
  meaningAnswer: state.phase === "meaning" ? answer : undefined,
  reverseAnswer: state.phase === "reverse" ? answer : undefined,
});

const submitReview = ({ state, answer, transition }) => postJson(
  state.daily.extra ? "/api/extra-review" : "/api/review",
  reviewPayload(state, answer),
  (result) => result.ok
    ? (speakFeedback(result.value),
      transition({ type: "review_recorded", daily: result.value.daily, feedback: result.value }))
    : transition({ type: "request_failed", error: result.error }),
);

const dailyLimitsFromForm = (form) => ((data) => Object.fromEntries(
  [...data.entries()]
    .filter(([name]) => name.startsWith("dailyNew:"))
    .map(([name, value]) => [name.slice("dailyNew:".length), Number(value)]),
))(new FormData(form));

const settingsFromForm = (form) => ((data) => onboardingSettings({
  studyListDailyNew: dailyLimitsFromForm(form),
  requiredDailyCount: data.get("requiredDailyCount"),
  gateMode: data.get("gateMode"),
  selectedBrowsers: data.getAll("selectedBrowsers"),
  selectedApplications: data.getAll("selectedApplications"),
}))(new FormData(form));

const stateWithDaily = (state, daily, settings = state.settings) => ({
  ...initialUiState(daily),
  settings,
  decks: state.decks,
  studyLists: state.studyLists,
  browserCandidates: state.browserCandidates,
  applicationCandidates: state.applicationCandidates,
  gateBehavior: state.gateBehavior,
  stats: state.stats,
  notice: state.notice,
  view: state.view,
});

const persistSettings = ({ state, form, nextView }) => ((settingsResult) => settingsResult.ok
  ? (render({ ...state, submitting: true, error: null }), postJson(
      "/api/study-lists",
      { dailyLimits: settingsResult.value.studyListDailyNew },
      (listResult) => listResult.ok
        ? putJson("/api/settings", settingsResult.value, (saveResult) => saveResult.ok
            ? bootstrap(nextView === "settings" ? "Settings saved." : null, nextView)
            : render({ ...state, submitting: false, error: saveResult.error }))
        : render({ ...state, submitting: false, error: listResult.error }),
    ))
  : render({ ...state, submitting: false, error: settingsResult.error.join(" ") }))(settingsFromForm(form));

const openView = (state, view) => ["home", "settings", "lists"].includes(view)
  ? Promise.all([fetchValue("/api/daily"), fetchValue("/api/stats"), fetchValue("/api/study-lists")])
      .then(([daily, stats, lists]) => daily.ok && lists.ok
        ? render({
            ...stateWithDaily(state, daily.value),
            view,
            stats: stats.ok ? stats.value : state.stats,
            studyLists: lists.value.lists,
            error: stats.ok ? null : stats.error,
            notice: null,
          })
        : render({ ...state, error: [daily, lists].find((result) => !result.ok)?.error }))
  : render({ ...state, view, error: null, notice: null });

const downloadBackup = (state) => fetchJson("/api/backup", undefined, (result) => result.ok
  ? ((url) => ((link) => (
      link.click(),
      setTimeout(() => URL.revokeObjectURL(url), 0),
      render({ ...state, notice: "Backup created.", error: null })
    ))(Object.assign(document.createElement("a"), {
        download: `leo-sensei-backup-${result.value.exportedAt.slice(0, 10)}.json`,
        href: url,
      })))(URL.createObjectURL(new Blob([`${JSON.stringify(result.value, null, 2)}\n`], { type: "application/json" })))
  : render({ ...state, error: result.error }));

const loadDesktopFocusApplications = () => typeof globalThis.desktop?.focusApplications === "function"
  ? globalThis.desktop.focusApplications().then(gatedApplicationOptions).catch(() => [])
  : Promise.resolve([]);

const loadDesktopBrowsers = () => typeof globalThis.desktop?.browserApplications === "function"
  ? globalThis.desktop.browserApplications().then(gatedApplicationOptions).catch(() => [])
  : Promise.resolve([]);

const loadDesktopGateBehavior = () => typeof globalThis.desktop?.gateBehavior === "function"
  ? globalThis.desktop.gateBehavior().catch(() => "prompt")
  : Promise.resolve("redirect");

const render = (state) => {
  root.innerHTML = state.daily && state.settings ? pageMarkup(state) : '<div class="loading">Loading today’s session</div>';
  const transition = (event) => render(reduceUi(state, event));
  [...root.querySelectorAll("[data-view]")].map((button) => button.addEventListener(
    "click",
    () => openView(state, button.dataset.view),
  ));
  root.querySelector("#onboardingForm")?.addEventListener("submit", (submitEvent) => (
    submitEvent.preventDefault(),
    persistSettings({ state, form: submitEvent.currentTarget, nextView: "home" })
  ));
  root.querySelector("#settingsForm")?.addEventListener("submit", (submitEvent) => (
    submitEvent.preventDefault(),
    persistSettings({ state, form: submitEvent.currentTarget, nextView: "settings" })
  ));
  root.querySelector("#studyListsForm")?.addEventListener("submit", (submitEvent) => (
    submitEvent.preventDefault(),
    postJson("/api/study-lists", { dailyLimits: dailyLimitsFromForm(submitEvent.currentTarget) }, (result) => result.ok
      ? bootstrap("Daily plan saved.", "lists")
      : render({ ...state, error: result.error }))
  ));
  root.querySelector("#homeReviewButton")?.addEventListener("click", () => openView(state, "review"));
  root.querySelector("#homeLessonButton")?.addEventListener("click", () => postJson(
    "/api/lesson/today",
    {},
    (result) => result.ok
      ? render({ ...stateWithDaily(state, result.value), view: "review" })
      : render({ ...state, error: result.error }),
  ));
  root.querySelector("#backupButton")?.addEventListener("click", () => downloadBackup(state));
  root.querySelector("#copyVoicePrompt")?.addEventListener("click", (clickEvent) => copyVoiceCustomizationPrompt({
    clipboard: globalThis.navigator?.clipboard,
  }).then((copied) => (clickEvent.currentTarget.textContent = copied ? "Copied" : "Copy failed")));
  root.querySelector("#restoreForm")?.addEventListener("submit", (submitEvent) => (
    submitEvent.preventDefault(),
    ((file) => typeof file?.text === "function"
      ? file.text().then((contents) => Promise.resolve(contents).then(JSON.parse).then((backup) => postJson(
          "/api/restore",
          backup,
          (result) => result.ok ? bootstrap("Backup restored.") : render({ ...state, error: result.error }),
        )).catch((restoreError) => render({ ...state, error: restoreError.message })))
      : render({ ...state, error: "Choose a backup file." }))(new FormData(submitEvent.currentTarget).get("backup"))
  ));
  [...root.querySelectorAll("[data-import-form]")].map((form) => form.addEventListener("submit", (submitEvent) => (
      submitEvent.preventDefault(),
      ((data, file) => typeof file?.text === "function"
        ? file.text().then((table) => postJson(
            "/api/import",
            { label: data.get("label"), table },
            (result) => result.ok
              ? bootstrap(`${result.value.importedCards} cards imported.`, state.view)
              : render({ ...state, error: result.error }),
          )).catch((importError) => render({ ...state, error: importError.message }))
        : render({ ...state, error: "Choose a CSV or TSV file." }))(
        new FormData(submitEvent.currentTarget),
        new FormData(submitEvent.currentTarget).get("table"),
      )
    )));
  root.querySelector("#answerForm")?.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    state.daily.speechAvailable ? primeNeuralJapaneseSpeech(neuralAudio) : null;
    const answer = new FormData(submitEvent.currentTarget).get("answer")?.toString().trim() ?? "";
    return state.phase === "reading"
      ? (render(reduceUi(state, { type: "request_started" })),
        postJson(
          "/api/reading-check",
          { cardId: state.currentId, readingAnswer: answer },
          (result) => result.ok
            ? result.value.correct
              ? transition({ type: "reading_entered", answer })
              : submitReview({ state: { ...state, readingAnswer: answer }, answer: "", transition })
            : transition({ type: "request_failed", error: result.error }),
        ))
      : (render(reduceUi(state, { type: "request_started" })), submitReview({ state, answer, transition }));
  });
  [...root.querySelectorAll("[data-alias-kind]")].map((button) =>
    button.addEventListener("click", () => (
      render(reduceUi(state, { type: "alias_started" })),
      postJson(
        "/api/alias",
        { cardId: state.currentId, kind: button.dataset.aliasKind, value: button.dataset.aliasValue },
        (result) => result.ok
          ? transition({ type: "alias_saved", kind: button.dataset.aliasKind })
          : transition({ type: "request_failed", error: result.error }),
      )
    )));
  const continueButton = root.querySelector("#continueButton");
  continueButton?.addEventListener("click", () => transition({ type: "continue" }));
  root.querySelector("#redoButton")?.addEventListener("click", () => (
    cancelSpeech(),
    render(reduceUi(state, { type: "request_started" })),
    postJson(
      "/api/review/redo",
      { answerEventId: state.feedback.answerEventId },
      (result) => result.ok
        ? transition({ type: "review_redone", daily: result.value.daily, cardId: result.value.cardId })
        : transition({ type: "request_failed", error: result.error }),
    )
  ));
  root.querySelector("#audioButton")?.addEventListener("click", () => speakFeedback(state.feedback));
  root.querySelector("#extraButton")?.addEventListener("click", () =>
    (cancelSpeech(), postJson("/api/extra", {}, (result) => result.ok
      ? render(stateWithDaily(state, result.value))
      : transition({ type: "request_failed", error: result.error }))));
  root.querySelector("#bypassButton")?.addEventListener("click", () => transition({ type: "bypass_opened" }));
  root.querySelector("#cancelBypass")?.addEventListener("click", () => transition({ type: "bypass_closed" }));
  root.querySelector("#bypassDialog")?.addEventListener("cancel", (cancelEvent) => (
    cancelEvent.preventDefault(),
    transition({ type: "bypass_closed" })
  ));
  root.querySelector("#bypassForm")?.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    const reason = new FormData(submitEvent.currentTarget).get("reason")?.toString() ?? "";
    return postJson("/api/bypass", { reason }, (result) => result.ok
      ? fetchJson("/api/daily", undefined, (dailyResult) => dailyResult.ok
        ? render({ ...stateWithDaily(state, dailyResult.value), view: "review" })
        : transition({ type: "request_failed", error: dailyResult.error }))
      : transition({ type: "request_failed", error: result.error }));
  });
  const answerInput = root.querySelector("#answerInput");
  ["reading", "reverse"].includes(state.phase) && answerInput ? bind(answerInput, { IMEMode: "toHiragana" }) : null;
  answerInput?.focus();
  continueButton?.focus();
  const bypassDialog = root.querySelector("#bypassDialog");
  bypassDialog && !bypassDialog.open ? bypassDialog.showModal() : null;
  return state;
};

const bootstrap = (notice = null, preferredView = null) => Promise.all([
  fetchValue("/api/settings"),
  fetchValue("/api/decks"),
  fetchValue("/api/daily"),
  fetchValue("/api/study-lists"),
  fetchValue("/api/stats"),
  loadDesktopBrowsers(),
  loadDesktopFocusApplications(),
  loadDesktopGateBehavior(),
]).then(([settingsResult, decksResult, dailyResult, listsResult, statsResult, browserCandidates, candidates, gateBehavior]) => ((browserIds) => (
  settingsResult.ok && decksResult.ok && dailyResult.ok && listsResult.ok
    ? render({
        ...initialUiState(dailyResult.value),
        settings: settingsResult.value,
        decks: decksResult.value.decks,
        studyLists: listsResult.value.lists,
        browserCandidates,
        applicationCandidates: candidates.filter(({ identity }) => !browserIds.has(identity)),
        gateBehavior,
        stats: statsResult.ok ? statsResult.value : null,
        notice,
        view: settingsResult.value.onboardingComplete ? preferredView ?? "home" : "onboarding",
      })
    : (root.innerHTML = `<div class="fatal">${escapeHtml(
        [settingsResult, decksResult, dailyResult, listsResult].find((result) => !result.ok)?.error ?? "Application state unavailable.",
      )}</div>`)
))(new Set(browserCandidates.map(({ identity }) => identity))));

render(initialUiState());
bootstrap();
