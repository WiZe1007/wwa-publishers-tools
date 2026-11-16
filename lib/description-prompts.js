// Shared by generation, repetition repair and localization of rich descriptions.
const RED_OPENING_COPY = `RED OPENING COPY: Make the red opening a persuasive reason to try this specific app. Prefer TWO short, complete sentences: the first draws the reader into a concrete playing moment or a useful outcome; the second connects a real feature to its immediate benefit and invites a first action. Give the reader a reason to install instead of spending the opening on a category definition such as "[Name] is a classic simulator" or a generic "Download now".
For games, build curiosity around a real mechanic, challenge or player choice supplied in the source. For tools, lead with the user's actual task and the practical benefit of a supplied feature. Use direct, vivid language and a natural question when it helps. Mention the main keyword early without stuffing. Vary the angle for each app; never copy one opening template across unrelated listings.
Use ONLY facts from the source and screenshots. Keep brand names, numbers, named controls, limitations and mandatory ASO/compliance wording accurate. Never invent rewards, offline access, ad-free play, time savings, popularity, scarcity or deadlines. Never imply real-money prizes, guaranteed wins or guaranteed results. Avoid empty superlatives and stock phrases such as "the ultimate", "endless fun", "best ever" and "you won't believe".
During repetition repair, keep the opening's concrete benefit and energy while reducing flagged words. During localization, adapt the appeal naturally to the selected language and region; do not flatten it into a literal category summary. These copy rules apply to an existing or requested red opening only: never add red markup to a plain-text description. Keep the opening within the existing 1-2 sentence and character limits.`;

const UNITY_TONE = 'tiktok_aso_unity';
const UNITY_RICH_TONE = 'tiktok_aso_unity_rich_html';

const UNITY_DESCRIPTION_BASE = `Style — TIKTOK × ASO PRO · UNITY (a separate social-casino template requested by the publisher, not a claim of Unity approval).
Use the TikTok × ASO Pro TOP method: derive one main keyword, 3–4 supporting terms and relevant long-tail phrases from the actual app. Put the main keyword within the first 167 visible characters. Distribute terms naturally across a hook, practical gameplay, benefits and a short invitation to try. The general repetition limits take priority over keyword targets. Write clear English.

Full description structure:
1. A compelling, factual 1–2 sentence hook that explicitly calls the app a "social casino". Lead with a concrete playing moment, not a generic definition or a promise of rewards.
2. "How to Play:" — describe the actual session and controls. For a slot, explain the supplied reels, actual symbols and how a matching result is evaluated. Describe a prize wheel ONLY when the source confirms one. Sevens, BAR, gems and crowns are examples, NOT a list to copy. Use the actual SPIN/button label when supplied. Explain selecting/changing a VIRTUAL stake, what is deducted and how virtual rewards are calculated ONLY when those mechanics are confirmed. Never add a bet, wheel, paytable, multiplier or control to a game that lacks it. Clearly distinguish virtual credits from real money.
3. "Features:" — a few concrete features and their benefits, drawn only from the description/screenshots. No invented feature count, purchases, offline mode or ad-free claims. Silence about in-app purchases is NOT evidence that there are none.
4. "Random Outcomes:" — explain chance without suggesting player choices guarantee a win. Follow the RNG certification rule below.
5. One brief, natural invitation to try, then the "Terms and Conditions" block specified below. Keep the mandatory disclosure once, at the end; shorten optional marketing before dropping disclosures. Respect the selected total character limit.
Use truthful social-casino, slot, spin and virtual-stake vocabulary when supported by the app; do not hide real mechanics behind generic euphemisms. No real-money prizes, deposit/withdrawal instructions, guaranteed wins, false urgency, "Unity Certified", Unity endorsement or guaranteed ad/store approval.`;

const UNITY_DESCRIPTION_STYLE = `${UNITY_DESCRIPTION_BASE}\nWrite plain text only, no HTML, markdown or emojis.`;
const UNITY_RICH_DESCRIPTION_STYLE = `${UNITY_DESCRIPTION_BASE}\nUNITY RICH HTML: keep the same Unity structure, mechanics and disclosures. Format full_description using the rich HTML rules, with exactly TWO complete opening sentences in the first paragraph, both red and bold. Keep short_description plain text. No emojis or markdown. Respect the selected character limit INCLUDING markup.`;

function unityDescriptionRules(certified, rich = false) {
  return `UNITY DISCLOSURES — apply during generation AND every repetition repair. ${rich
    ? 'Preserve rich HTML formatting. Keep exactly TWO complete opening sentences together in the first paragraph, wrapped in <b><font color="#D32F2F">...</font></b>. Color only these two sentences red; all later body paragraphs stay plain. Use bold headings, teal for 2–3 brief headings, one italic supporting sentence and one brief underlined benefit. No emojis or markdown. Keep short_description plain text. Formatting counts toward the character limit. The Terms and Conditions heading may be bold; keep its disclosure sentences plain, intact and uninterrupted by tags.'
    : 'Return plain text only: no HTML, markdown or emojis.'} Preserve exact sourced control/symbol labels such as SPIN and BAR. Preserve the "social casino" classification, factual mechanics, virtual-only context and all Terms and Conditions disclosures. Rewrite optional marketing first; never remove negations or weaken the restrictions to reduce repetition.
The full description must end with a section headed "Terms and Conditions" containing all of these disclosures, once each:
"For users aged 18 and above. For entertainment purposes only."
"All coins, credits and rewards are virtual, have no real-world monetary value, and cannot be withdrawn, exchanged for cash or redeemed for prizes of real-world value."
"Success in social casino games does not guarantee future success in real-money gambling"
Keep that final sentence EXACTLY as written (an ending period is allowed). Do not replace it with a claim that practice improves gambling success. This short disclosure is not a full legal agreement; do not invent legal URLs, governing law or acceptance requirements.
${certified === true
    ? 'RNG certification: CONFIRMED by the publisher for this app. Describe outcomes using the exact phrase "certified random number generator". Preserve this phrase during repetition repair. Do not invent a certifier, certificate number, Unity certification, certification scope or guaranteed fairness.'
    : 'RNG certification: NOT CONFIRMED. Explain that outcomes are random, but DO NOT assert a certified random number generator, independent testing, auditing, certification or Unity approval, even if a draft or genre example makes that claim. Remove unsupported certification claims during repair; the publisher must explicitly confirm certification first.'}`;
}

module.exports = { RED_OPENING_COPY, UNITY_TONE, UNITY_RICH_TONE, UNITY_DESCRIPTION_STYLE, UNITY_RICH_DESCRIPTION_STYLE, unityDescriptionRules };
