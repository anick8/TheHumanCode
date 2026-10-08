---
name: LivePolls
description: A live audience-response tool that runs like a stage show: dark room, one bright moment at a time.
colors:
  stage-charcoal: "hsl(210 15% 7%)"
  card-slate: "hsl(210 20% 10%)"
  muted-slate: "hsl(210 15% 15%)"
  hairline: "hsl(210 15% 20%)"
  paper-white: "hsl(0 0% 96%)"
  quiet-grey: "hsl(0 0% 70%)"
  signal-orange: "hsl(20 85% 44%)"
  signal-orange-text: "hsl(20 90% 50%)"
  alert-red: "hsl(0 84% 60%)"
typography:
  display:
    fontFamily: "Orbitron, Montserrat, sans-serif"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.5rem"
  md: "0.625rem"
  lg: "0.75rem"
  xl: "1rem"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "linear-gradient(to right, {colors.signal-orange}, {colors.signal-orange-text})"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "12px 24px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
---

# Design System: LivePolls

## Overview

**Creative North Star: "The Live Stage"**

A dark room with one bright thing in it. LivePolls is projected in front of a crowd, so the surface stays quiet and charcoal until something should be watched: the open question, the results, the Pick. Orange is spent on the one action or moment that matters; everything else is tonal slate.

The identity is fixed (charcoal, orange, Orbitron over Montserrat). Each session may override its colours, fonts and logo through theme tokens without touching the app's own look. Spectacle is reserved for reveals; controls stay plain and fast.

**Key Characteristics:**
- Dark tonal layering, no decorative gradients on surfaces.
- One accent, used sparingly, plus a gradient fill only on primary actions.
- Display type is Orbitron; it carries names, numbers and titles.
- Presenter surfaces are built to be read from the back of a room; phone surfaces are one-handed and calm.

## Colors

A charcoal stage with a single orange signal.

### Primary
- **Signal Orange** (hsl(20 85% 44%)): fills and primary actions, with white text on top. **Signal Orange Text** (hsl(20 90% 50%)) is the lighter step for links and small text on dark grounds, so it clears WCAG AA.

### Neutral
- **Stage Charcoal** (hsl(210 15% 7%)): page ground.
- **Card Slate** (hsl(210 20% 10%)): cards, console bars, drawers.
- **Muted Slate** (hsl(210 15% 15%)): list rows, hover fills.
- **Hairline** (hsl(210 15% 20%)): borders and dividers.
- **Paper White** (hsl(0 0% 96%)): text. **Quiet Grey** (hsl(0 0% 70%)): secondary text.
- **Alert Red** (hsl(0 84% 60%)): destructive actions only.

### Named Rules
**The One Signal Rule.** Orange marks the one action or moment that matters on a screen. If two things are orange, one of them is wrong.
**The Session Override Rule.** Every colour resolves through the theme tokens, so a branded session recolours everything, including the wheel's wedges, without per-component changes.

## Typography

**Display Font:** Orbitron (with Montserrat fallback)
**Body Font:** Montserrat (with ui-sans-serif, system-ui)

**Character:** A wide technical display face for names and numbers, paired with a friendly geometric sans for everything read in sentences.

### Hierarchy
- **Display** (700, up to 6rem, 1.1): the Pick name, the live count, question titles on the projector.
- **Headline** (700, 1.125-1.5rem): section and drawer headings.
- **Body** (400-500, 0.875-1rem, 1.5): descriptions, lists, 65-75ch where it runs long.
- **Label** (600, 0.75-0.875rem): kbd hints, status lines, counts.

### Named Rules
**The Names-In-Orbitron Rule.** A participant's name or a number shown to the room is set in the display face, never the body face.

## Layout

Presenter pages are full-bleed: a thin header, a stage that takes all remaining height, and a pinned console of host controls at the bottom. The wheel sizes itself to the stage with container units. Phone pages are a single centred column (max about 28rem). Spacing runs on a 4px base; room-facing padding is generous (24px gutters).

## Elevation & Depth

Depth comes from tonal layering first (charcoal, slate, muted slate) and soft offset shadows second. Shadows carry an offset and blur (for example `0 28px 36px` black at 55% under the wheel); no zero-offset glows. Overlays (drawers) use a left hairline plus a large soft shadow.

### Named Rules
**The Flat-Until-Spotlit Rule.** Surfaces are flat at rest; shadow and light appear on the object being watched (the wheel, the Pick band).

## Shapes

Rounded but not soft: 0.75rem (12px) for buttons and inputs, 1rem to 1.25rem for cards, full pill for the Spin button. Circles are reserved for the wheel and hub. Borders are 1px Hairline.

## Components

### Buttons
- **Shape:** rounded-lg (0.75rem); Spin is a full pill.
- **Primary:** orange-to-accent gradient fill, white text, Orbitron for the Spin button.
- **Secondary:** transparent with a Hairline border, Paper White text, Muted Slate on hover.
- **Focus:** a 2px primary outline with 2px offset on every control.

### Cards / Containers
- **Corner Style:** 1rem-1.25rem. **Background:** Card Slate. **Border:** 1px Hairline.

### Inputs / Fields
- **Style:** Stage Charcoal fill, Hairline border, 0.5rem radius, primary outline on focus.

### Wheel (signature)
A dark-metal rim with marquee bulbs, pegs on wedge borders, a kicking flapper and a hub cap. Wedges are six tones of the session primary colour with a fixed sheen. The Pick lands on a full-bleed primary band in the display face; other wedges dim.

## Do's and Don'ts

### Do:
- **Do** resolve every colour through the theme tokens so session branding works.
- **Do** spend orange on one action or moment per screen.
- **Do** set room-facing names and numbers in Orbitron.
- **Do** keep reveals short and exponential; respect `prefers-reduced-motion`.

### Don't:
- **Don't** hard-code hex colours in components that sit inside a session theme.
- **Don't** use gradient text or decorative glows.
- **Don't** show results, answers or the Entry list to attendee phones before the presenter reveals them.
