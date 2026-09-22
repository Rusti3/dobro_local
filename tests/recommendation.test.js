import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../data/catalog.json" with { type: "json" };
import { applyFeedback, calibrationBatch, eventVector, initialVector, recommendationView, recordFeedback, resetRecommendation } from "../server/recommendation.js";

test("interest choices seed the preference vector and calibration stays diverse", () => {
  const interests = ["animals", "ecology", "nature", "city", "children"];
  const vector = initialVector(interests);
  assert.equal(vector.theme_animals, 0.6);
  assert.equal(vector.theme_donation, 0.12);
  const batch = calibrationBatch(catalog, vector, interests, "test-user");
  assert.equal(batch.length, 12);
  assert.equal(new Set(batch.map((item) => item.id)).size, 12);
  assert.ok(new Set(batch.map((item) => item.theme)).size >= 5);
});

test("likes and skips move event and format weights in opposite directions", () => {
  const event = catalog.find((item) => item.theme === "animals");
  const base = initialVector(["animals", "ecology", "nature", "city", "children"]);
  const liked = applyFeedback(base, event, "like");
  const skipped = applyFeedback(base, event, "skip");
  const formatDimension = Object.keys(eventVector(event)).find((key) => key.startsWith("format_") && eventVector(event)[key]);
  assert.ok(liked.theme_animals > base.theme_animals);
  assert.ok(skipped.theme_animals < base.theme_animals);
  assert.ok(liked[formatDimension] > base[formatDimension]);
});

test("twelve calibration reactions unlock a persistent daily batch", () => {
  const user = { id: "u1", profile: { interests: [] } };
  resetRecommendation(user, catalog, ["animals", "ecology", "nature", "city", "children"]);
  for (const item of user.recommendation.calibration) recordFeedback(user, catalog, { eventId: item.id, action: "like", context: "calibration" }, "2026-09-19");
  assert.equal(user.onboarded, true);
  const view = recommendationView(user, catalog, "2026-09-19");
  assert.equal(view.stage, "daily");
  assert.equal(view.daily.ids.length, 4);
  assert.equal(new Set(view.daily.ids).size, 4);
  assert.ok(view.sections.length >= 5);
});

test("a plan and a completed visit are stronger positive signals", () => {
  const user = { id: "u2", profile: { interests: [] } };
  resetRecommendation(user, catalog, ["animals", "ecology", "nature", "city", "children"]);
  const event = catalog.find((item) => item.theme === "animals");
  const before = user.recommendation.vector.theme_animals;
  recordFeedback(user, catalog, { eventId: event.id, action: "like", context: "plan" }, "2026-09-19");
  const planned = user.recommendation.vector.theme_animals;
  recordFeedback(user, catalog, { eventId: event.id, action: "like", context: "visit" }, "2026-09-20");
  assert.ok(planned - before >= 0.35);
  assert.ok(user.recommendation.vector.theme_animals > planned);
});
