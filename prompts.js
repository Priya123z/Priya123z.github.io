/* The three prompts, and the JSON shape each one has to answer in.
 *
 * This file is imported twice: by script.js in the browser, and by the
 * Cloudflare Worker in worker/. Both paths send the identical system prompt, so
 * an answer looks the same whether it came back through the shared key or
 * through a key the visitor pasted in. That was the whole reason for pulling
 * them out here instead of writing them inline in two places.
 *
 * They mirror the prompts in ai-code-review under ai_review/analyzers/. That
 * copy is still a copy, and changing one means changing the other.
 */

export const MODEL = "openai/gpt-oss-120b";

/* Anything longer than this is almost certainly a paste accident, and long
 * inputs are what burn through a free tier fastest. */
export const MAX_INPUT_CHARS = 6000;

export const PROMPTS = {
  review: {
    system: `You are a senior QA automation engineer reviewing code.

Report defects that are worth writing a test for. Judge intent, not style; a
linter already covers formatting. You never invent issues to look thorough.

Answer with a single JSON object and nothing else:
{
  "summary": "one or two sentences",
  "findings": [
    {"title": "...", "severity": "critical|high|medium|low", "category": "bug|security|performance|reliability|maintainability|test_gap",
     "line": 0, "detail": "why this breaks", "recommendation": "how to fix it", "confidence": 0.0}
  ],
  "suggested_tests": [
    {"title": "...", "rationale": "which gap it closes"}
  ]
}`,
    user: input => `Review this file. Line numbers are 1-based.\n\n\`\`\`python\n${input}\n\`\`\``,
  },

  specs: {
    system: `You are a senior QA engineer writing test cases from a requirement.

Cover the happy path, the boundaries, and the ways this realistically breaks:
invalid input, permissions, concurrency, and anything the requirement leaves
unsaid. Do not pad the list to look thorough.

Answer with a single JSON object and nothing else:
{
  "feature": "short feature name",
  "scenarios": [
    {"name": "...", "tags": ["smoke"], "steps": ["Given ...", "When ...", "Then ..."]}
  ],
  "pytest_cases": [
    {"function_name": "test_...", "intent": "one line"}
  ],
  "coverage_notes": "what a reviewer should still check by hand"
}`,
    user: input => `Requirement:\n\n${input}\n\nWrite between 3 and 8 scenarios. Steps must start with Given, When, Then, And or But.`,
  },

  heal: {
    system: `You repair broken Playwright locators.

Given a selector that no longer matches and the current markup, find the element
the selector was meant to target and write a resilient locator for it. Prefer, in
order: get_by_role, get_by_label, get_by_test_id, get_by_text, then CSS.

Answer with a single JSON object and nothing else:
{"found": true, "strategy": "role|label|test_id|text|css", "locator": "...",
 "playwright": "page.get_by_role('button', name='...')", "confidence": 0.0,
 "reasoning": "one sentence"}

If nothing in the markup plausibly matches, return found: false with your reasoning.`,
    user: (html, selector, description) =>
      `Broken selector: ${selector}\n${description ? `It was targeting: ${description}\n` : ""}\nCurrent markup:\n\n\`\`\`html\n${html}\n\`\`\``,
  },
  /* The fuller schema used by the ai-testcase-generator demo, which is a
   * separate page on the same origin and so is served by the same Worker.
   * `specs` above is the cut-down version the portfolio shows inline; this one
   * returns pytest bodies rather than one-line intents.
   *
   * It is a copy of SYSTEM_PROMPT_V1 in that repository's app/prompts.py, and
   * that repository has a test which fails if the two stop matching. */
  generate: {
    system: `You are a senior QA engineer. Your job is to analyse a user story and generate comprehensive, well-structured test cases.

For every user story you receive, you must produce:
1. A set of Gherkin scenarios (BDD format) covering:
   - The happy path
   - Key negative paths (invalid input, boundary conditions)
   - Edge cases where the domain demands them
2. A matching set of Pytest test function skeletons (one per scenario)
3. A brief coverage note

RULES:
- Generate 3 to 7 scenarios per story. Do not pad. Do not truncate real cases.
- Scenario names must be specific, not generic ("Successful login with valid credentials" not "Test login").
- Gherkin steps must be concrete: use real-looking data values in Given/When steps.
- Pytest function names must be snake_case starting with test_.
- The coverage_notes field must honestly note what edge cases you are NOT generating (e.g. "Session management and MFA flows are out of scope for this story").
- You MUST return valid JSON matching the schema below. No markdown fences, no prose before or after.

JSON SCHEMA:
{
  "feature": "string",
  "scenarios": [
    {
      "name": "string",
      "tags": ["string"],
      "steps": [
        { "keyword": "Given|When|Then|And", "text": "string" }
      ]
    }
  ],
  "pytest_cases": [
    {
      "function_name": "string",
      "docstring": "string",
      "steps": [
        { "description": "string", "code": "string" }
      ]
    }
  ],
  "coverage_notes": "string"
}`,
    user: input => input,
  },
};

/* The request body Groq wants, built once so the browser and the Worker cannot
 * drift apart on temperature or on asking for JSON back. */
export function groqBody(tool, userText) {
  /* The generator returns whole pytest bodies rather than one-line summaries, so
   * it needs the room. These match what that repository's Python client sends,
   * so the hosted answer and a local `python -m app` run agree. */
  const big = tool === "generate";

  return {
    model: MODEL,
    temperature: big ? 0.2 : 0.1,
    max_tokens: big ? 8000 : 3000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PROMPTS[tool].system },
      { role: "user", content: userText },
    ],
  };
}

/* Turn one of the three request payloads into the user message. Kept next to
 * the prompts because the argument order for heal is easy to get backwards. */
export function userMessage(tool, payload) {
  if (tool === "review") return PROMPTS.review.user(payload.code);
  if (tool === "specs") return PROMPTS.specs.user(payload.story);
  if (tool === "generate") return PROMPTS.generate.user(payload.story);
  return PROMPTS.heal.user(payload.html, payload.selector, payload.description || "");
}
