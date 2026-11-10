---
version: alpha
name: Craft
description: One Craft Runtime projected across three modes — 领航员 (pilot) / 控制台 (control) / 工作台 (workshop) — sharing Task, Approval, Evidence and session state, retaining Craft's warm operational signature.
colors:
  background: "#FFFFFF"
  chrome: "rgb(249, 250, 251)"
  ink: "rgb(15, 17, 21)"
  muted: "rgb(97, 102, 107)"
  brand: "#B08A4E"
  link: "rgb(65, 118, 230)"
  success: "rgb(34, 197, 94)"
  warning: "rgb(221, 134, 41)"
  danger: "rgb(236, 19, 19)"
typography:
  sans:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'
  mono:
    fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, monospace'
rounded:
  micro: "6px"
  control: "8px"
  surface: "12px"
  menu: "20px"
  composer: "22px"
  pill: "999px"
spacing:
  titlebar: "40px"
  statusbar: "24px"
  rail: "232px"
  aside: "280px"
components:
  shell: { chrome: "--bg-rail", divider: "--hair" }
  button: { focus: "--accent", radius: "--r2" }
  surface: { stroke: "--stroke", elevation: "--shadow-panel" }
  scrollbar: { thumb: "--scrollbar-thumb" }
---

# Craft Design System

## Overview

### Creative North Star

DeepSeek Harness supplies the visual grammar: quiet blue-neutral surfaces, hairline separation, compact spatial rhythm and a single clear active state. Craft is not rebranded as DeepSeek: its warm khaki accent is reserved for work, focus and selection while blue remains informational.

### Product context and register

- **Audience and primary job:** People starting, continuing and checking governed tasks beside their existing applications.
- **Locale(s) and language policy:** Primary copy is concise `zh-CN` with system and CJK font fallbacks; complete `en-US` localization remains a target, not an acceptance claim.
- **Usage scene:** A desktop application used repeatedly beside terminals and editors; high information density is more valuable than decorative empty space.
- **Register:** Product.
- **Memorable signature:** One task changes scale: lightweight entry, selected material beside a draft, then a focused artifact workspace. These are presentation modes, not separate agents.
- **Restraint:** Tables, forms, activity and destructive actions use familiar product controls; no visual treatment may obscure execution state.
- **Anti-references:** Marketing gradients, oversized rounded cards and saturated blue-as-brand treatments are deliberately excluded.
- **Token ownership/runtime mapping:** [workbench/app.css](workbench/app.css) is canonical (Model B). The frontmatter mirrors `--bg*`, `--text*`, `--accent`, `--r*`, `--hair`, `--shadow*` and scrollbar tokens. `app.css` is served unchanged by [core/interfaces/workbench-server.ts](../craft/core/interfaces/workbench-server.ts); `core/workbench-server.ts` is only a compatibility re-export. Tauri bundles the same Workbench separately; the core sidecar is prepared through [desktop/scripts/prepare-sidecar.mjs](desktop/scripts/prepare-sidecar.mjs).

## Colors

Light and dark themes remap semantic variables under `html[data-theme]`; components consume variables only. `--bg-rail` aliases `--bg-chrome` so shell surfaces cannot drift. `--accent` is interactive, `--link` informational, and semantic feedback always carries text or an icon in addition to colour.

## Typography

The system sans stack prioritizes native rendering and CJK coverage. Interface text is 14px/22px; compact labels and technical values use the mono stack at 12px/19px. Heading contrast comes from modest weight and spacing rather than display typography.

## Layout

The shell owns the viewport and uses a 40px title bar, 24px status bar, 232px rail and 280px contextual aside. The title bar contains only rail/navigation controls and File/Edit/View/Help; the browser app host retains actual window controls. Both rail and contextual aside can collapse without changing content semantics. Each scrollable panel owns its overflow; loading and feedback preserve the surrounding geometry.

The preceding geometry describes the advanced Workbench shell (232px rail, 280px aside) used by all three modes. The official entry is the three-mode shell implemented in `workbench/mode-shell.js` + `workbench/app.js` (领航员 / 控制台 / 工作台), which shares one Craft Runtime over Task, Approval, Evidence and session state. Switching modes never interrupts a task and never changes execution facts (`NEEDREAD.md` §2). The earlier `workbench/entry.css` launcher / companion / artifact-workspace proposal (approved 2026-09-28) is **superseded** by the three-mode entry and is no longer a delivery target; `entry.css` is retained only as a historical style artifact and must not be wired into the startup chain. Model, plugin and capability management remain accessible from each mode's own nav.

The three-mode entry supersedes the 2026-09-28 launcher proposal. Visual QA and native platform acceptance are still pending; see `design-qa.md`.

## Elevation & Depth

Default hierarchy is tonal plus a 0.5px hairline. Raised surfaces use `--stroke` with the smallest matching shadow; only palettes and sheets receive prominent elevation. The dark theme uses the same semantic levels with stronger occlusion shadows.

## Shapes

Radii are intentionally non-uniform: 6px micro details, 8px controls, 12px surfaces, 20px menus and 22px composer. Pills are only for inherently compact controls. Where supported, the interface uses a subtle superellipse corner shape.

## Components

Buttons, icon buttons, inputs, rows, tabs and palette items provide hover, active, disabled and visible keyboard focus states. Task threads use own-message/right and model-message/left alignment; activity remains a separate factual projection. Sheets replace browser dialogs, toast messages use one live region, secret fields are masked, and reduced motion collapses transitions. Scrollbars use globally inherited visible thumb styling.

## Do's and Don'ts

- **Do:** use semantic Studio tokens and the shared `app.css` shell across served and packaged surfaces.
- **Do:** make active work and keyboard focus unambiguous with accent plus non-colour affordances.
- **Don't:** introduce raw brand-blue controls or a screen-local theme.
- **Don't:** hide scrollbars, use browser dialogs, or let loading move the primary controls.
