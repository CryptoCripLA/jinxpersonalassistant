---
name: TRADES
colors:
  graphite-deep: "oklch(15.5% 0.012 255)"
  graphite-panel: "oklch(18.5% 0.013 255)"
  graphite-raised: "oklch(21.5% 0.014 255)"
  graphite-high: "oklch(25% 0.015 255)"
  hairline: "oklch(29% 0.015 255)"
  hairline-soft: "oklch(23.5% 0.013 255)"
  ink: "oklch(94% 0.008 85)"
  ink-secondary: "oklch(79% 0.012 255)"
  ink-tertiary: "oklch(66% 0.013 255)"
  ledger-gold: "oklch(80% 0.125 84)"
  ledger-gold-light: "oklch(87% 0.1 88)"
  buy-green: "oklch(77% 0.15 155)"
  sell-coral: "oklch(69% 0.17 25)"
  ignition-amber: "oklch(77% 0.16 58)"
  historical-steel: "oklch(74% 0.08 240)"
  simulated-teal: "oklch(80% 0.09 195)"
typography:
  wordmark: { fontFamily: "Bodoni Moda", fontWeight: 700, letterSpacing: "0.1em" }
  headline: { fontFamily: "Hanken Grotesk", fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em" }
  title: { fontFamily: "Hanken Grotesk", fontSize: "16px", fontWeight: 600 }
  body: { fontFamily: "Hanken Grotesk", fontSize: "14px", fontWeight: 400, lineHeight: 1.45, fontFeature: "tnum, lnum" }
  label: { fontFamily: "Hanken Grotesk", fontSize: "12.5px", fontWeight: 500 }
  tag: { fontFamily: "Hanken Grotesk", fontSize: "10.5px", fontWeight: 700, letterSpacing: "0.06em" }
rounded:
  sm: "6px"
  md: "10px"
  card: "14px"
  pill: "999px"
spacing:
  gutter: "14px"
  card-padding: "16px 18px"
  page: "16px 18px 40px"
components:
  button-primary: { backgroundColor: "{colors.ledger-gold}", textColor: "oklch(18% 0.02 85)", rounded: "12px", height: "40px" }
  button-outline: { backgroundColor: "transparent", textColor: "{colors.ink-secondary}", rounded: "12px", height: "40px" }
  button-buy: { backgroundColor: "{colors.buy-green}", textColor: "oklch(17% 0.03 155)", rounded: "{rounded.sm}", height: "32px" }
  recommendation-card: { backgroundColor: "{colors.graphite-panel}", rounded: "{rounded.card}", padding: "{spacing.card-padding}" }
  tag-historical: { textColor: "{colors.historical-steel}", rounded: "4px" }
  tag-simulated: { textColor: "{colors.simulated-teal}", rounded: "4px" }
  tag-live: { textColor: "{colors.buy-green}", rounded: "4px" }
---

# Design System: TRADES

## Overview

**Creative North Star: The Night Desk Analyst** (inferred from the owner's brief, not chosen by him).
A private trading desk after dark: smoked graphite panels, hairline dividers, and gold that only
ever means money, focus, or the analyst speaking. The screen answers first (a verdict in plain
English, one obvious action) and the numbers sit underneath as evidence. It is an Operate
surface: familiar web controls, dense where data is dense, never decorative.
Anti-reference: GMGN's grammar of fifteen-column tables as the primary experience; those live
only behind "details" toggles.

## Colors

### Primary
- **Ledger Gold** (oklch(80% 0.125 84)): the primary action (Copy this trader, Set target),
  money amounts, focus rings, the analyst's voice and its briefing outline. Never decoration.

### Secondary
- **Buy Green** (oklch(77% 0.15 155)): Buy buttons, profits, passing checks, "Fits your style".
- **Sell Coral** (oklch(69% 0.17 25)): Sell, losses, failing checks, hard warnings.
- **Ignition Amber** (oklch(77% 0.16 58)): the Ignition stage, "Close match", proactive alerts.

### Tertiary (result provenance, always paired with a word)
- **Historical Steel** (oklch(74% 0.08 240)): HISTORICAL tags (a wallet really did it).
- **Simulated Teal** (oklch(80% 0.09 195)): SIMULATED tags, drawn with a dashed outline.

### Neutral
- **Graphite Deep / Panel / Raised / High**: four tonal layers from page to hover; depth comes
  from these, not from colour.
- **Ink / Ink Secondary / Ink Tertiary**: warm off-white text and two cool greys, all above 4.5:1
  on the panels.

## Typography

One family, Hanken Grotesk, with tabular lining figures everywhere so money columns align.
Bodoni Moda appears only in the TRADES wordmark. Fixed rem-like pixel scale (12.5 / 14 / 16 /
22), no fluid headings. Plain English at a beginner's reading level is part of the type system:
labels say what a number is ("Your $25 copies", "Usually holds").

## Elevation

Tonal layering first. Recommendation cards carry one soft, offset ambient shadow
(0 10px 30px -12px) to lift them off the page; nothing else casts a shadow. State rings
(focus, Explain tether, live dot) are rings, not depth.

## Components

- **Recommendation card** (owner mockup): title with the trader's name, its type as a subtitle,
  a fit badge, a two-by-two of facts (coins per day, usually holds, last active, your copy
  result), "Why I picked this trader", exit habits, differences from your style, then a filled
  gold primary and an outlined Explain action. Opportunity cards reuse it with a filter
  checklist and realistic vs theoretical dollars.
- **Analyst rail**: briefings (gold-outlined), alerts (amber), answers; pinned approvals above.
- **Checklist**: drawn check / cross / dash icons in green / coral / grey with the number behind
  each line.
- **Buttons**: primary gold, outline, buy green, sell coral wash; 150ms colour transitions.
- **Tags**: HISTORICAL, SIMULATED (dashed), LIVE; always visible next to a result.

## Layout

Top bar 48px; work area plus a docked 330-384px analyst rail at desktop widths (rail becomes an
overlay under 1000px). Pages max 1180-1500px with a 16-18px gutter; card grids use
auto-fill minmax(380px, 1fr). Live coins is a 4-column board (2x2 under 1440px).

## Shapes

6px for controls, 10px for panels, 14px for recommendation cards, pills for badges.
Hairline 1px borders; no thick accent stripes.

## Do's and Don'ts

- Do lead every screen with a verdict and an action; put tables behind "details".
- Do label every result HISTORICAL, SIMULATED or LIVE, and keep a coin's peak apart from what a
  trader captured and what a follower could capture.
- Do show every amount in US dollars.
- Don't use gold for decoration, gradients for emphasis, or cards inside cards.
- Don't show a number without its source or a caveat when it is survivorship-biased.
