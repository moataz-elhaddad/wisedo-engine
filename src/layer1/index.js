// Layer 1 (need understanding) public entry point.
//
// The session state machine is the main API (session.js). The components are exported for tests, evals and
// the API layer. Layer 1 talks to Layer 2 only through match(): simulate while planning, rank for the result.
export { step, replay, newSession, configFor, configuredCategories, identityFor, MAX_TEXT_LENGTH } from './session.js';
export { detectCategory, detectByRules, buildCategoryRequest, CATEGORIES, CATEGORY_IDS } from './u1-category.js';
export { extract, callLlm, buildExtractionRequest, buildExtractionSchema, buildExtractionSystemPrompt, DEFAULT_TIMEOUT_MS } from './u2-extract.js';
export { normalizeExtraction, normalizeAnswer, parseMoney, parseStorageGb, parseSizeInches, toWesternDigits, normalizeText, resolveProductId, resolveRetailerId, UNMAPPED_FACTORS, REASON_LABELS } from './u3-normalize.js';
export { applyExtraction, setBuyerValue, buildChips, valueLabel, PREFILL_THRESHOLD } from './u4-confirm.js';
export { buildProfile, withDefaults } from './u5-derive.js';
export { checkConsistency } from './u6-consistency.js';
export { planNext, evaluateSlot, moneyScenarios, nearTieBrands, saleWeeks, NEED_GROUPS, MIN_GAIN, DEFAULT_POLICY, LITERAL_POLICY } from './u7-planner.js';
export { renderQuestion, renderClarify, renderAddDetail } from './u8-render.js';
export { stopBeforePlanning, MAX_QUESTIONS } from './u9-stop.js';
export { emptyState, STATE_VERSION } from './state.js';
export { createMockLlm, recording } from './llm/mock.js';
