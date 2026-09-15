/**
 * studio-ui.ts
 *
 * Hollywood-grade Cinema Production Studio UI for Auto-Create-Video.
 * Upgraded with the Redesign Skill & Anti-Slop Guidelines (taste-skill):
 *  - Zero em-dashes (only standard '-' and clean typography)
 *  - 35mm Cinematic Film Grain Texture & Atmospheric Lighting
 *  - Interactive Mouse Spotlight Engine on Acrylic Cards
 *  - Character 512-D ArcFace Lightbox Inspection Modal
 *  - Real-time Animated Multi-Band Audio Stems Equalizer
 *  - Dual-View Screenplay Studio with Lens & Camera Metadata Chips
 *  - Shimmer Loading States & Spring Physics Micro-Interactions
 */

export function renderStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AUTO-CREATE-VIDEO ★ CINEMA PRODUCTION STUDIO</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&family=Be+Vietnam+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Typography Families — Standardized on JetBrains Mono */
      --font-sans: 'JetBrains Mono', 'SFMono-Regular', Consolas, -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
      --font-ui: 'JetBrains Mono', 'SFMono-Regular', Consolas, -apple-system, BlinkMacSystemFont, monospace;
      --font-mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;

      /* Typographic Scale Tokens */
      --text-display: 26px;
      --lh-display: 1.30;
      --ls-display: -0.02em;

      --text-h1: 19px;
      --lh-h1: 1.38;
      --ls-h1: -0.01em;

      --text-h2: 15px;
      --lh-h2: 1.45;
      --ls-h2: 0em;

      --text-body: 13.5px;
      --lh-body: 1.60;
      --ls-body: 0.005em;

      --text-meta: 12px;
      --lh-meta: 1.50;
      --ls-meta: 0.015em;

      --text-micro: 11px;
      --lh-micro: 1.36;
      --ls-micro: 0.06em;

      --text-code: 12.5px;
      --lh-code: 1.62;

      /* Dark Obsidian & Slate Ground Surfaces */
      --bg-canvas: #090a0f;
      --bg-surface: #0d111b;
      --bg-surface-elevated: #121826;
      --bg-card: rgba(18, 24, 38, 0.72);
      --bg-card-hover: rgba(26, 34, 52, 0.88);
      --bg-input: rgba(13, 17, 27, 0.85);
      --bg-input-focus: rgba(16, 22, 34, 0.98);

      /* Calibrated Neutral Borders */
      --border-subtle: rgba(255, 255, 255, 0.05);
      --border-default: rgba(255, 255, 255, 0.08);
      --border-active: rgba(255, 255, 255, 0.14);
      --border-highlight: rgba(255, 255, 255, 0.24);

      /* Neutral Typography Colors */
      --text-primary: #f8fafc;
      --text-secondary: #cbd5e1;
      --text-muted: #64748b;
      --text-dim: #475569;

      /* Functional Cinema Studio Accents */
      --accent-cyan: #06b6d4;
      --accent-cyan-hover: #22d3ee;
      --accent-cyan-subtle: rgba(6, 182, 212, 0.10);
      --accent-cyan-border: rgba(6, 182, 212, 0.32);
      --accent-cyan-glow: rgba(6, 182, 212, 0.28);

      --accent-indigo: #6366f1;
      --accent-indigo-hover: #818cf8;
      --accent-indigo-subtle: rgba(99, 102, 241, 0.10);
      --accent-indigo-border: rgba(99, 102, 241, 0.32);
      --accent-indigo-glow: rgba(99, 102, 241, 0.28);

      --accent-amber: #f59e0b;
      --accent-amber-hover: #fbbf24;
      --accent-amber-subtle: rgba(245, 158, 11, 0.10);
      --accent-amber-border: rgba(245, 158, 11, 0.32);

      --accent-emerald: #10b981;
      --accent-emerald-hover: #34d399;
      --accent-emerald-subtle: rgba(16, 185, 129, 0.10);
      --accent-emerald-border: rgba(16, 185, 129, 0.32);
      --accent-emerald-glow: rgba(16, 185, 129, 0.28);

      --accent-rose: #f43f5e;
      --accent-rose-hover: #fb7185;
      --accent-rose-subtle: rgba(244, 63, 94, 0.10);
      --accent-rose-border: rgba(244, 63, 94, 0.32);

      /* Optical Glassmorphism Shadows & Highlights */
      --shadow-card: 0 4px 20px -2px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
      --shadow-card-hover: 0 12px 36px -4px rgba(0, 0, 0, 0.7), inset 0 1px 0 0 rgba(255, 255, 255, 0.10);
      --shadow-modal: 0 24px 64px -12px rgba(0, 0, 0, 0.88), 0 0 0 1px rgba(255, 255, 255, 0.05), inset 0 1px 0 0 rgba(255, 255, 255, 0.10);

      /* Radii & Transitions */
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-pill: 9999px;

      --transition-fast: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      --transition-base: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      --transition-smooth: all 0.32s cubic-bezier(0.16, 1, 0.3, 1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
      font-feature-settings: "cv02", "cv03", "cv04", "cv11", "kern" 1;
    }

    body {
      background: var(--bg-canvas);
      background-image:
        radial-gradient(circle at 15% 10%, rgba(6, 182, 212, 0.035) 0%, transparent 45%),
        radial-gradient(circle at 85% 85%, rgba(99, 102, 241, 0.035) 0%, transparent 45%),
        linear-gradient(to right, rgba(255, 255, 255, 0.014) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255, 255, 255, 0.014) 1px, transparent 1px);
      background-size: 100% 100%, 100% 100%, 32px 32px, 32px 32px;
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: var(--text-body);
      line-height: var(--lh-body);
      letter-spacing: var(--ls-body);
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    /* 35mm Film Grain Overlay */
    .film-grain-overlay {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 99999;
      opacity: 0.022;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
    }

    /* Topbar Navigation */
    header {
      position: sticky;
      top: 0;
      z-index: 100;
      height: 64px;
      padding: 0 28px;
      background: rgba(10, 14, 23, 0.92);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border-default);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .brand-section {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .brand-logo {
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
    }

    .brand-logo-icon {
      width: 34px;
      height: 34px;
      border-radius: var(--radius-md);
      background: linear-gradient(135deg, rgba(6, 182, 212, 0.25), rgba(99, 102, 241, 0.25));
      border: 1px solid var(--accent-cyan-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      font-weight: 900;
      color: var(--accent-cyan);
      box-shadow: 0 0 16px var(--accent-cyan-subtle);
    }

    .brand-name {
      font-family: var(--font-sans);
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 0.6px;
      color: #ffffff;
      text-transform: uppercase;
    }

    .brand-tag {
      font-family: var(--font-ui);
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      background: var(--accent-cyan-subtle);
      border: 1px solid var(--accent-cyan-border);
      color: var(--accent-cyan);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    /* Model Status Quick-Pills */
    .quick-status-group {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: 20px;
    }

    .model-pill {
      height: 30px;
      padding: 0 12px;
      border-radius: var(--radius-pill);
      background: rgba(16, 23, 38, 0.65);
      border: 1px solid var(--border-default);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-sans);
      font-size: var(--text-meta);
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: var(--transition-base);
    }

    .model-pill:hover {
      border-color: var(--accent-cyan-border);
      background: rgba(23, 33, 54, 0.85);
      color: var(--text-primary);
      box-shadow: 0 0 0 2px var(--accent-cyan-subtle);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-dim);
      transition: var(--transition-fast);
    }

    .status-dot.active {
      background: var(--accent-emerald);
      box-shadow: 0 0 8px var(--accent-emerald-glow);
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    /* Subheader & Navigation Tabs */
    .subheader {
      background: var(--bg-surface);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--border-default);
      padding: 0 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .nav-tabs {
      display: flex;
      gap: 4px;
    }

    .tab-btn {
      padding: 14px 20px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-family: var(--font-sans);
      font-size: var(--text-body);
      font-weight: 600;
      line-height: 1.4;
      letter-spacing: 0.01em;
      cursor: pointer;
      position: relative;
      transition: var(--transition-fast);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tab-btn:hover {
      color: var(--text-primary);
    }

    .tab-btn.active {
      color: var(--accent-cyan);
    }

    .tab-btn.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, var(--accent-cyan), var(--accent-indigo));
      box-shadow: 0 0 12px var(--accent-cyan-border);
    }

    /* Typography Scale Classes */
    .display {
      font-family: var(--font-sans);
      font-size: var(--text-display);
      line-height: var(--lh-display);
      font-weight: 800;
      letter-spacing: var(--ls-display);
      color: #ffffff;
    }

    .h1 {
      font-family: var(--font-sans);
      font-size: var(--text-h1);
      line-height: var(--lh-h1);
      font-weight: 700;
      letter-spacing: var(--ls-h1);
      color: var(--text-primary);
    }

    .h2, .card-title, .modal-title {
      font-family: var(--font-sans);
      font-size: var(--text-h2);
      line-height: var(--lh-h2);
      font-weight: 700;
      letter-spacing: var(--ls-h2);
      color: var(--text-primary);
    }

    .caption, label, .provider-desc {
      font-family: var(--font-sans);
      font-size: var(--text-meta);
      line-height: var(--lh-meta);
      font-weight: 500;
      letter-spacing: var(--ls-meta);
      color: var(--text-secondary);
    }

    .badge, .card-badge, .shot-badge-type, .step-num {
      font-family: var(--font-ui);
      font-size: var(--text-micro);
      line-height: var(--lh-micro);
      font-weight: 700;
      letter-spacing: var(--ls-micro);
      text-transform: uppercase;
    }

    /* Buttons Hierarchy with Spring Physics */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      border-radius: var(--radius-md);
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      text-decoration: none;
      transition: var(--transition-fast);
      position: relative;
      overflow: hidden;
    }

    .btn:active {
      transform: scale(0.98) translateY(1px);
    }

    .btn-primary, .btn-cyan {
      background: var(--accent-cyan);
      color: #090a0f;
      border: 1px solid rgba(255, 255, 255, 0.25);
      padding: 9px 18px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.35);
    }

    .btn-primary:hover, .btn-cyan:hover {
      background: var(--accent-cyan-hover);
      box-shadow: 0 4px 16px -2px var(--accent-cyan-glow), inset 0 1px 0 rgba(255, 255, 255, 0.45);
    }

    .btn-secondary, .btn-outline {
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-secondary);
      border: 1px solid var(--border-default);
      padding: 9px 16px;
      box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.04);
    }

    .btn-secondary:hover, .btn-outline:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: var(--border-active);
      color: var(--text-primary);
      transform: translateY(-0.5px);
    }

    .btn-purple, .btn-indigo {
      background: var(--accent-indigo);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 9px 18px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .btn-purple:hover, .btn-indigo:hover {
      background: var(--accent-indigo-hover);
      box-shadow: 0 4px 16px -2px var(--accent-indigo-glow);
    }

    .btn-emerald {
      background: var(--accent-emerald);
      color: #05070b;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 9px 16px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .btn-emerald:hover {
      background: var(--accent-emerald-hover);
      box-shadow: 0 4px 14px -2px var(--accent-emerald-glow);
    }

    .btn-amber {
      background: var(--accent-amber);
      color: #05070b;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 9px 16px;
    }

    .btn-amber:hover {
      background: var(--accent-amber-hover);
    }

    .btn-sm {
      padding: 6px 12px;
      font-size: 11.5px;
      border-radius: var(--radius-sm);
    }

    /* Form Controls */
    label {
      display: block;
      margin-bottom: 6px;
    }

    select, input, textarea {
      background: var(--bg-input);
      border: 1px solid var(--border-default);
      color: var(--text-primary);
      padding: 9px 14px;
      border-radius: var(--radius-md);
      font-family: var(--font-sans);
      font-size: var(--text-body);
      line-height: 1.5;
      transition: var(--transition-fast);
    }

    select:focus, input:focus, textarea:focus {
      outline: none;
      background: var(--bg-input-focus);
      border-color: var(--accent-cyan);
      box-shadow: 0 0 0 3px var(--accent-cyan-subtle);
    }

    /* Main Container */
    main {
      flex: 1;
      padding: 24px 28px;
      max-width: 1720px;
      width: 100%;
      margin: 0 auto;
    }

    .view-panel {
      display: none;
      animation: panelFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .view-panel.active {
      display: block;
    }

    @keyframes panelFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Interactive Spotlight Acrylic Card */
    .card {
      background: var(--bg-card);
      backdrop-filter: blur(24px) saturate(190%);
      -webkit-backdrop-filter: blur(24px) saturate(190%);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg);
      padding: 22px;
      box-shadow: var(--shadow-card);
      position: relative;
      overflow: hidden;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
    }

    .card::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(400px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255, 255, 255, 0.04), transparent 60%);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .card:hover::before {
      opacity: 1;
    }

    .card:hover {
      border-color: var(--border-active);
      box-shadow: var(--shadow-card-hover);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 18px;
    }

    .card-badge {
      padding: 3px 8px;
      border-radius: var(--radius-pill);
    }

    .badge-arcface {
      background: var(--accent-emerald-subtle);
      border: 1px solid var(--accent-emerald-border);
      color: var(--accent-emerald);
    }

    .badge-warn {
      background: var(--accent-amber-subtle);
      border: 1px solid var(--accent-amber-border);
      color: var(--accent-amber);
    }

    /* Tab 1: Casting Studio Cards */
    .casting-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
      margin-top: 18px;
    }

    .character-card {
      background: var(--bg-card);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
      overflow: hidden;
      box-shadow: var(--shadow-card);
      transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
    }

    .character-card:hover {
      transform: translateY(-4px);
      border-color: var(--accent-cyan-border);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55), 0 0 24px var(--accent-cyan-subtle);
    }

    .portrait-box {
      width: 100%;
      aspect-ratio: 3 / 4;
      background: #080c14;
      border-radius: var(--radius-md);
      overflow: hidden;
      position: relative;
      border: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .portrait-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .character-card:hover .portrait-img {
      transform: scale(1.06);
    }

    .portrait-placeholder {
      font-size: 12.5px;
      color: var(--text-muted);
      text-align: center;
      padding: 20px;
    }

    .portrait-inspect-hint {
      position: absolute;
      bottom: 8px;
      right: 8px;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      background: rgba(9, 13, 22, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.15);
      font-size: 10.5px;
      color: var(--text-secondary);
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition: var(--transition-fast);
    }

    .character-card:hover .portrait-inspect-hint {
      opacity: 1;
      transform: translateY(0);
    }

    /* Tab 2: Dual Screenplay */
    .screenplay-container {
      display: grid;
      grid-template-columns: 350px 1fr;
      gap: 24px;
      align-items: start;
    }

    .view-switcher-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }

    .mode-toggle-group {
      display: inline-flex;
      background: rgba(10, 14, 23, 0.85);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      padding: 3px;
      gap: 2px;
    }

    .mode-toggle-btn {
      padding: 6px 14px;
      font-family: var(--font-sans);
      font-size: 12px;
      font-weight: 600;
      border: none;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--text-muted);
      cursor: pointer;
      transition: var(--transition-fast);
    }

    .mode-toggle-btn.active {
      background: var(--accent-cyan);
      color: #05070b;
      box-shadow: 0 0 10px var(--accent-cyan-subtle);
    }

    .storyboard-cards-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-height: 680px;
      overflow-y: auto;
      padding-right: 8px;
    }

    .scene-breakdown-card {
      background: rgba(10, 14, 23, 0.65);
      border: 1px solid var(--border-default);
      border-left: 4px solid var(--accent-cyan);
      border-radius: 10px;
      padding: 18px;
      margin-bottom: 16px;
    }

    .shot-card {
      display: grid;
      grid-template-columns: 170px 1fr;
      gap: 16px;
      align-items: start;
      background: rgba(16, 23, 38, 0.85);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 14px;
      margin-top: 10px;
      transition: var(--transition-base);
    }

    .shot-card:hover {
      border-color: var(--border-active);
      background: rgba(22, 32, 52, 0.95);
    }

    .shot-badge-type {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      background: var(--accent-indigo-subtle);
      border: 1px solid var(--accent-indigo-border);
      color: var(--accent-indigo);
      width: fit-content;
    }

    .lens-chip {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.05);
      font-family: var(--font-mono);
      font-size: 10.5px;
      color: var(--text-muted);
    }

    .dialogue-bubble {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 4px 12px 12px 12px;
      padding: 10px 14px;
      font-family: var(--font-sans);
      font-size: 13px;
      line-height: 1.62;
      letter-spacing: 0.01em;
      color: var(--text-primary);
      margin-top: 8px;
    }

    .dialogue-speaker {
      display: inline-block;
      font-weight: 700;
      color: var(--accent-amber);
      margin-right: 6px;
    }

    /* Tab 3: Stepper & Director Desk */
    .step-stepper {
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: relative;
      padding: 24px 16px;
      margin-bottom: 20px;
    }

    .step-stepper::before {
      content: '';
      position: absolute;
      top: 40px;
      left: 32px;
      right: 32px;
      height: 3px;
      background: rgba(255, 255, 255, 0.08);
      z-index: 1;
    }

    .step-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      position: relative;
      z-index: 2;
      width: 88px;
      background: transparent;
      border: none;
    }

    .step-num {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 800;
      background: #0a0e17;
      border: 2px solid rgba(255, 255, 255, 0.15);
      color: var(--text-muted);
      transition: var(--transition-smooth);
    }

    .step-box.active .step-num {
      background: #05070b;
      border-color: var(--accent-cyan);
      color: var(--accent-cyan);
      box-shadow: 0 0 16px var(--accent-cyan-glow);
      transform: scale(1.12);
    }

    .step-box.completed .step-num {
      background: var(--accent-emerald);
      border-color: var(--accent-emerald);
      color: #05070b;
      box-shadow: 0 0 10px var(--accent-emerald-subtle);
    }

    .step-name {
      font-family: var(--font-sans);
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 88px;
    }

    .step-box.active .step-name {
      color: var(--accent-cyan);
      font-weight: 700;
    }

    .step-box.completed .step-name {
      color: var(--accent-emerald);
    }

    /* Terminal Chrome */
    .terminal-window {
      border: 1px solid var(--border-default);
      border-radius: 10px;
      overflow: hidden;
      background: #030509;
      margin-top: 14px;
    }

    .terminal-topbar {
      height: 34px;
      background: #080c14;
      border-bottom: 1px solid var(--border-subtle);
      padding: 0 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .window-dots {
      display: flex;
      gap: 6px;
    }

    .window-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .dot-red { background: #ef4444; }
    .dot-amber { background: #f59e0b; }
    .dot-green { background: #10b981; }

    #logTerminal {
      height: 300px;
      padding: 16px;
      overflow-y: auto;
      font-family: var(--font-mono);
      font-size: var(--text-code);
      line-height: var(--lh-code);
      color: #38bdf8;
      white-space: pre-wrap;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1, "zero" 1;
    }

    /* Director Take Review Cards */
    .take-review-card {
      background: rgba(14, 20, 32, 0.85);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      padding: 14px;
      display: grid;
      grid-template-columns: 100px 1fr 140px;
      gap: 16px;
      align-items: center;
      transition: var(--transition-base);
    }

    .take-review-card:hover {
      border-color: var(--border-active);
      background: rgba(19, 28, 46, 0.95);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    }

    .take-thumb-box {
      width: 100px;
      height: 70px;
      border-radius: var(--radius-sm);
      background: #05070a;
      border: 1px solid var(--border-subtle);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: var(--text-muted);
      cursor: pointer;
    }

    .qa-gauge-meter {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .qa-gauge-bar {
      width: 60px;
      height: 6px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.1);
      overflow: hidden;
    }

    .qa-gauge-fill {
      height: 100%;
      background: var(--accent-emerald);
      border-radius: 3px;
      box-shadow: 0 0 8px var(--accent-emerald-subtle);
    }

    /* Tab 4: Cinema Player & Audio Mixer */
    .cinema-layout {
      display: grid;
      grid-template-columns: 460px 1fr;
      gap: 28px;
      align-items: start;
    }

    .cinema-bezel {
      padding: 12px;
      background: linear-gradient(145deg, #334155, #0b1120, #1e293b);
      border-radius: 32px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18), 0 28px 70px rgba(0, 0, 0, 0.85), 0 0 40px var(--accent-cyan-subtle);
      width: 100%;
      max-width: 440px;
      aspect-ratio: 9 / 16;
      margin: 0 auto;
      position: relative;
    }

    .cinema-inner-viewport {
      border-radius: 20px;
      overflow: hidden;
      background: #000;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .cinema-inner-viewport video {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .timeline-track {
      height: 48px;
      background: rgba(9, 13, 22, 0.95);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      display: flex;
      position: relative;
      overflow: hidden;
      margin-top: 10px;
      cursor: pointer;
    }

    .timeline-shot-block {
      height: 100%;
      border-right: 1px solid var(--border-default);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: 11.5px;
      font-weight: 700;
      color: #cbd5e1;
      position: relative;
      transition: background 0.2s;
    }

    .timeline-shot-block:hover {
      background: var(--accent-cyan-subtle);
      color: #ffffff;
    }

    .timeline-shot-block:nth-child(even) { background: rgba(99, 102, 241, 0.08); }
    .timeline-shot-block:nth-child(odd) { background: rgba(6, 182, 212, 0.08); }

    /* Animated Audio Stems Mixer Console */
    .audio-stems-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-top: 12px;
    }

    .stem-channel-box {
      background: rgba(10, 14, 23, 0.65);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: var(--transition-base);
    }

    .stem-channel-box:hover {
      border-color: var(--border-active);
      background: rgba(14, 20, 32, 0.85);
    }

    /* Animated Multi-Band VU Bars */
    .vu-bars-container {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      height: 18px;
      padding: 2px 0;
    }

    .vu-bar {
      flex: 1;
      border-radius: 1px;
      min-height: 3px;
      transition: height 0.08s ease;
    }

    .stem-meter-bar {
      height: 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.1);
      overflow: hidden;
    }

    .stem-meter-fill {
      height: 100%;
      border-radius: 2px;
    }

    /* Modal / Drawer */
    .modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(3, 5, 10, 0.84);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }

    .modal-backdrop.active {
      display: flex;
      animation: modalFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }

    .modal-window {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-active);
      box-shadow: var(--shadow-modal);
      border-radius: var(--radius-xl);
      width: 92%;
      max-width: 920px;
      max-height: 86vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .modal-header {
      padding: 18px 24px;
      border-bottom: 1px solid var(--border-default);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-body {
      padding: 24px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .modal-footer {
      padding: 16px 24px;
      border-top: 1px solid var(--border-default);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      background: rgba(6, 9, 15, 0.7);
    }

    .provider-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(410px, 1fr));
      gap: 18px;
    }

    .provider-card {
      background: rgba(15, 22, 36, 0.6);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      transition: var(--transition-base);
    }

    .provider-card:hover {
      border-color: var(--border-active);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    }

    /* Password Input Mask Wrap */
    .password-input-wrap {
      position: relative;
      width: 100%;
      display: flex;
      align-items: center;
    }

    .password-input-wrap input {
      padding-right: 44px;
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .password-toggle-btn {
      position: absolute;
      right: 8px;
      width: 28px;
      height: 28px;
      background: transparent;
      border: none;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      transition: var(--transition-fast);
    }

    .password-toggle-btn:hover {
      color: var(--accent-cyan);
      background: var(--accent-cyan-subtle);
    }

    /* Ping Feedback Box */
    .ping-feedback-box {
      margin-top: 8px;
      padding: 8px 12px;
      border-radius: var(--radius-md);
      font-size: 12px;
      font-family: var(--font-mono);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .ping-feedback-testing {
      background: var(--accent-cyan-subtle);
      border: 1px solid var(--accent-cyan-border);
      color: #38bdf8;
    }

    .ping-feedback-success {
      background: var(--accent-emerald-subtle);
      border: 1px solid var(--accent-emerald-border);
      color: #34d399;
    }

    .ping-feedback-error {
      background: var(--accent-rose-subtle);
      border: 1px solid var(--accent-rose-border);
      color: #f87171;
    }

    .latency-pill {
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.2);
      color: var(--accent-emerald);
    }

    /* Toast Notification */
    #toastContainer {
      position: fixed;
      bottom: 28px;
      right: 28px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 2000;
    }

    .toast {
      padding: 12px 20px;
      background: rgba(18, 24, 38, 0.95);
      border: 1px solid var(--border-default);
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.55);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      font-weight: 600;
      backdrop-filter: blur(14px);
      animation: toastIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes toastIn {
      from { transform: translateX(50px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .toast.success { border-color: var(--accent-emerald-border); color: var(--accent-emerald); }
    .toast.error { border-color: var(--accent-rose-border); color: var(--accent-rose); }
    .toast.info { border-color: var(--accent-cyan-border); color: var(--accent-cyan); }
  </style>
</head>
<body>

  <!-- 35mm Film Grain Atmosphere Overlay -->
  <div class="film-grain-overlay"></div>

  <!-- Topbar -->
  <header>
    <div class="brand-section">
      <a href="#" class="brand-logo">
        <span class="brand-logo-icon">★</span>
        <span class="brand-name">AUTO-CREATE-VIDEO</span>
        <span class="brand-tag">STUDIO v2.0</span>
      </a>

      <!-- Quick Model Status Pills -->
      <div class="quick-status-group">
        <div class="model-pill" onclick="openModelHubModal()">
          <span class="status-dot active" id="llmDot"></span>
          <span id="llmLabel">LLM: Claude 3.5 Sonnet</span>
        </div>
        <div class="model-pill" onclick="openModelHubModal()">
          <span class="status-dot active" id="videoDot"></span>
          <span id="videoLabel">Video: Wan 2.2 / ComfyUI</span>
        </div>
        <div class="model-pill" onclick="openModelHubModal()">
          <span class="status-dot active" id="voiceDot"></span>
          <span id="voiceLabel">Voice: LucyLab VN</span>
        </div>
      </div>
    </div>

    <!-- Topbar Actions -->
    <div class="topbar-actions">
      <select id="seriesSelect" onchange="loadCurrentSeries()"></select>
      <button class="btn btn-secondary" onclick="openNewSeriesModal()">+ Tạo Series</button>
      <button class="btn btn-primary" onclick="openModelHubModal()">⚙️ AI Model Hub & Keys</button>
    </div>
  </header>

  <!-- Subheader Navigation Tabs -->
  <div class="subheader">
    <div class="nav-tabs">
      <button class="tab-btn active" onclick="switchTab('tabBible')">👥 Casting & Story Bible</button>
      <button class="tab-btn" onclick="switchTab('tabScreenplay')">📝 Kịch Bản Phân Cảnh (Dual-View)</button>
      <button class="tab-btn" onclick="switchTab('tabProduction')">🎬 Bàn Sản Xuất (Production Desk)</button>
      <button class="tab-btn" onclick="switchTab('tabPlayer')">🍿 Cinema Player & Audio Mixer</button>
    </div>
    <div class="caption">
      Series: <strong id="activeSeriesTitle" style="color: var(--accent-cyan);">-</strong>
    </div>
  </div>

  <!-- Main Workspaces -->
  <main>

    <!-- TAB 1: STORY BIBLE & CASTING STUDIO -->
    <div id="tabBible" class="view-panel active">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">👥 BẢNG PHÂN VAI & MỎ NEO KHUÔN MẶT (512-D ARCFACE)</div>
            <div class="caption" style="margin-top: 4px;" id="seriesGenreVisual">
              Đang tải thông tin thế giới...
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="openNewCharModal()">+ Đăng Ký Diễn Viên</button>
        </div>

        <div class="casting-grid" id="charCardsGrid">
          <!-- Dynamic Character Cards -->
        </div>
      </div>
    </div>

    <!-- TAB 2: SCREENPLAY STUDIO & AI WRITER -->
    <div id="tabScreenplay" class="view-panel">
      <div class="screenplay-container">
        <!-- Left Column: Controls -->
        <div class="card" style="height: fit-content;">
          <div class="card-title" style="margin-bottom: 14px;">✨ SÁNG TÁC PHÂN CẢNH AI</div>
          <div style="display: flex; flex-direction: column; gap: 14px;">
            <div>
              <label>Chọn Tập Sản Xuất:</label>
              <input type="number" id="targetEpNum" value="1" min="1" max="999" style="width: 100%;">
            </div>
            <div>
              <label>AI Model Biên Kịch:</label>
              <select id="writerModelSelect" style="width: 100%;">
                <option value="claude">Anthropic Claude 3.5 Sonnet (Khuyên dùng)</option>
                <option value="openai">OpenAI GPT-4o</option>
                <option value="gemini">Google Gemini 1.5 Pro</option>
                <option value="mock">Offline Rule-Based Generator</option>
              </select>
            </div>
            <div>
              <label>Ý Tưởng Cốt Truyện hoặc Trích Đoạn Tiểu Thuyết:</label>
              <textarea id="storyInput" rows="7" placeholder="Ví dụ: Minh và Lan tìm đường thoát khỏi cao ốc Skyline khi robot tuần tra bao vây..." style="width: 100%; resize: vertical;"></textarea>
            </div>
            <button class="btn btn-purple" onclick="generateScreenplay()" style="width: 100%; justify-content: center;">
              🚀 AI Chuyển Thể Thành Kịch Bản Phân Cảnh
            </button>
            <button class="btn btn-secondary" onclick="openPreAuditModal()" style="width: 100%; justify-content: center;">
              🔍 Kiểm Tra Tính Nhất Quán (Pre-Audit)
            </button>
          </div>
        </div>

        <!-- Right Column: Dual Screenplay View -->
        <div class="card">
          <div class="view-switcher-bar">
            <div class="card-title">🎬 KỊCH BẢN PHÂN CẢNH ĐIỆN ẢNH</div>
            <div class="mode-toggle-group">
              <button class="mode-toggle-btn active" id="btnModeText" onclick="toggleScreenplayMode('text')">📝 Văn Bản</button>
              <button class="mode-toggle-btn" id="btnModeCards" onclick="toggleScreenplayMode('cards')">🎬 Storyboard Cards</button>
            </div>
          </div>

          <!-- Mode 1: Text Script Editor -->
          <div id="screenplayTextView">
            <textarea id="screenplayOutput" rows="22" style="width: 100%; font-family: var(--font-mono); font-size: 13px; line-height: 1.65; resize: vertical;" placeholder="Kịch bản phân cảnh sẽ hiển thị tại đây..."></textarea>
          </div>

          <!-- Mode 2: Interactive Storyboard Cards -->
          <div id="screenplayCardsView" style="display: none;">
            <div class="storyboard-cards-grid" id="storyboardCardsContainer">
              <!-- Visual breakdown cards -->
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px;">
            <button class="btn btn-secondary" onclick="parseCardsFromText()">🔄 Cập Nhật Thẻ Từ Text</button>
            <button class="btn btn-primary" onclick="saveAndGoToProduction()">💾 Lưu Kịch Bản & Sang Bàn Sản Xuất ➔</button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 3: PRODUCTION DESK & DIRECTOR REVIEW -->
    <div id="tabProduction" class="view-panel">
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- 8-Step Dynamic Continuous Stepper -->
        <div class="card">
          <div class="card-title" style="margin-bottom: 8px;">📊 TIẾN ĐỘ 8 BƯỚC SẢN XUẤT TẬP PHIM</div>
          <div class="step-stepper">
            <div class="step-box" id="step1"><div class="step-num">1</div><div class="step-name">Khởi Tạo & Kịch Bản</div></div>
            <div class="step-box" id="step2"><div class="step-num">2</div><div class="step-name">Kiểm Định Story Bible</div></div>
            <div class="step-box" id="step3"><div class="step-num">3</div><div class="step-name">Lồng Tiếng TTS</div></div>
            <div class="step-box" id="step4"><div class="step-num">4</div><div class="step-name">Đồng Bộ Khẩu Hình</div></div>
            <div class="step-box" id="step5"><div class="step-num">5</div><div class="step-name">Sinh Video Cú Máy</div></div>
            <div class="step-box" id="step6"><div class="step-num">6</div><div class="step-name">Kiểm Định Face QA</div></div>
            <div class="step-box" id="step7"><div class="step-num">7</div><div class="step-name">Ghép Chuyển Cảnh</div></div>
            <div class="step-box" id="step8"><div class="step-num">8</div><div class="step-name">Xuất Bản & Ghi Canon</div></div>
          </div>

          <div style="display: flex; gap: 12px; margin-top: 10px;">
            <button class="btn btn-primary" onclick="startProduction()">🚀 Khởi Động Máy Quay (Start Production)</button>
          </div>
        </div>

        <!-- Terminal Logs & Director Review Desk -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
          <!-- Live Terminal -->
          <div class="card">
            <div class="card-title">🖥️ TERMINAL NHẬT KÝ SẢN XUẤT THỜI GIAN THỰC</div>
            <div class="terminal-window">
              <div class="terminal-topbar">
                <div class="window-dots">
                  <div class="window-dot dot-red"></div>
                  <div class="window-dot dot-amber"></div>
                  <div class="window-dot dot-green"></div>
                </div>
                <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">stdout / sse stream</div>
              </div>
              <div id="logTerminal">Sẵn sàng. Nhấn [Khởi Động Máy Quay] để kích hoạt chu trình sản xuất.</div>
            </div>
          </div>

          <!-- Director Approval Desk -->
          <div class="card">
            <div class="card-header" style="margin-bottom: 8px;">
              <div class="card-title">🎬 BÀN DUYỆT TAKE CỦA ĐẠO DIỄN <span class="badge badge-warn" style="font-size: 10px; margin-left: 6px;">PROTOTYPE</span></div>
              <button class="btn btn-secondary btn-sm" onclick="populateSampleTakes()">Nạp Cú Máy Mẫu (Demo UI)</button>
            </div>
            <div id="takesContainer" style="margin-top: 14px; display: flex; flex-direction: column; gap: 12px; max-height: 334px; overflow-y: auto;">
              <div class="caption" style="text-align: center; padding: 50px 20px;">
                Các cú máy sau khi sinh video sẽ hiển thị tại đây kèm đồng hồ Face QA để đạo diễn duyệt hoặc yêu cầu quay lại (Reroll).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 4: CINEMA PLAYER & AUDIO MIXER -->
    <div id="tabPlayer" class="view-panel">
      <div class="cinema-layout">
        <!-- 9:16 Vertical Cinema Player with Metallic Bezel -->
        <div class="cinema-bezel">
          <div class="cinema-inner-viewport">
            <video id="cinemaVideo" controls playsinline></video>
          </div>
        </div>

        <!-- Player Controls, Timeline Inspector & Audio Mixer -->
        <div class="card" style="display: flex; flex-direction: column; gap: 20px;">
          <div class="card-title">🍿 XUẤT XƯỞNG & KIỂM ĐỊNH TẬP PHIM HOÀN CHỈNH</div>

          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px;">
            <div class="card" style="background: rgba(10,14,23,0.5); padding: 16px;">
              <div class="caption">ĐỘ PHÂN GIẢI</div>
              <div style="font-size: 16px; font-weight: 700; color: var(--accent-cyan); margin-top: 4px;">1080 × 1920 (9:16)</div>
            </div>
            <div class="card" style="background: rgba(10,14,23,0.5); padding: 16px;">
              <div class="caption">FACE QA SIMILARITY</div>
              <div style="font-size: 16px; font-weight: 700; color: var(--accent-emerald); margin-top: 4px;">0.88 (PASS CANON)</div>
            </div>
          </div>

          <!-- Visual Timeline Track -->
          <div>
            <div class="caption" style="font-weight: 700; margin-bottom: 6px;">TIMELINE PHÂN CẢNH VÀ CHUYỂN CẢNH (XFADE 0.5s)</div>
            <div class="timeline-track" id="visualTimeline">
              <div class="timeline-shot-block" style="flex: 4;">Cảnh 1 • Shot 1 (4.0s)</div>
              <div class="timeline-shot-block" style="flex: 3;">Cảnh 1 • Shot 2 (3.5s)</div>
              <div class="timeline-shot-block" style="flex: 5;">Cảnh 2 • Shot 1 (5.0s)</div>
            </div>
          </div>

          <!-- Audio Stems Mixer with Live Animated Equalizer -->
          <div>
            <div class="caption" style="font-weight: 700;">BÀN TRỘN ÂM THANH ĐA KÊNH (AUDIO STEMS MIXER)</div>
            <div class="audio-stems-grid">
              <!-- Channel 1: Voice -->
              <div class="stem-channel-box">
                <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700;">
                  <span>🎙️ VOICE TTS</span>
                  <span style="color: var(--accent-cyan);" id="voiceDbLabel">0 dB</span>
                </div>
                <div class="vu-bars-container" id="vuVoiceBars">
                  <!-- Dynamic Equalizer Bars -->
                </div>
                <div class="caption" style="font-size: 11px;">LucyLab / ElevenLabs</div>
              </div>

              <!-- Channel 2: SFX -->
              <div class="stem-channel-box">
                <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700;">
                  <span>💥 SFX & FOLEY</span>
                  <span style="color: var(--accent-indigo);" id="sfxDbLabel">-6 dB</span>
                </div>
                <div class="vu-bars-container" id="vuSfxBars">
                  <!-- Dynamic Equalizer Bars -->
                </div>
                <div class="caption" style="font-size: 11px;">Hiệu ứng môi trường</div>
              </div>

              <!-- Channel 3: BGM -->
              <div class="stem-channel-box">
                <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700;">
                  <span>🎵 BGM SCORE</span>
                  <span style="color: var(--accent-amber);" id="bgmDbLabel">-18 dB</span>
                </div>
                <div class="vu-bars-container" id="vuBgmBars">
                  <!-- Dynamic Equalizer Bars -->
                </div>
                <div class="caption" style="font-size: 11px;">Tự động né lời thoại</div>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div style="display: flex; gap: 12px; margin-top: 6px;">
            <a id="downloadVideoBtn" class="btn btn-primary" href="#" download style="flex: 1; justify-content: center;">
              📥 Tải Video Master MP4
            </a>
            <button class="btn btn-secondary" onclick="exportBibleJson()">📄 Xuất Story Bible JSON</button>
          </div>
        </div>
      </div>
    </div>

  </main>

  <!-- MODAL: AI MODEL HUB & SETTINGS -->
  <div class="modal-backdrop" id="modelHubModal">
    <div class="modal-window">
      <div class="modal-header">
        <div class="modal-title">
          <span style="color: var(--accent-cyan); font-size: 18px;">⚙️</span>
          <span>TRUNG TÂM CẤU HÌNH AI MODEL & KHÓA API</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closeModelHubModal()">✕ Đóng</button>
      </div>
      <div class="modal-body">
        <p class="caption" style="line-height: 1.6;">
          Cấu hình API Key trực tiếp trên giao diện. Các thay đổi sẽ được lưu an toàn vào <code style="color: var(--accent-cyan); font-family: var(--font-mono);">.env.local</code> và áp dụng ngay lập tức mà không cần khởi động lại máy chủ.
        </p>

        <div class="provider-cards-grid" id="providerCardsGrid">
          <!-- Dynamic Provider Cards -->
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModelHubModal()">Hủy</button>
        <button class="btn btn-primary" onclick="saveAllProviderSettings()">💾 Lưu & Áp Dụng Ngay</button>
      </div>
    </div>
  </div>

  <!-- MODAL: PRE-AUDIT REPORT -->
  <div class="modal-backdrop" id="preAuditModal">
    <div class="modal-window" style="max-width: 680px;">
      <div class="modal-header">
        <div class="modal-title">
          <span style="color: var(--accent-cyan); font-size: 18px;">🔍</span>
          <span>BÁO CÁO KIỂM TRA TÍNH NHẤT QUÁN CỐT TRUYỆN (PRE-AUDIT)</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closePreAuditModal()">✕ Đóng</button>
      </div>
      <div class="modal-body">
        <div style="display: flex; flex-direction: column; gap: 12px;" id="auditItemsContainer">
          <div style="padding: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid var(--accent-emerald-border); border-radius: 8px; font-size: 13px; color: var(--accent-emerald);">
            ✓ Nhân vật xuất hiện: Tất cả nhân vật đều đã được đăng ký mỏ neo trong Story Bible.
          </div>
          <div style="padding: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid var(--accent-emerald-border); border-radius: 8px; font-size: 13px; color: var(--accent-emerald);">
            ✓ Dòng thời gian: Không phát hiện xung đột không gian và thời gian giữa các cảnh.
          </div>
          <div style="padding: 12px; background: rgba(6, 182, 212, 0.1); border: 1px solid var(--accent-cyan-border); border-radius: 8px; font-size: 13px; color: var(--accent-cyan);">
            ℹ Thời lượng dự kiến: 3 cảnh, khoảng 12.5 giây video 9:16.
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="closePreAuditModal()">Đã Hiểu</button>
      </div>
    </div>
  </div>

  <!-- MODAL: CHARACTER ARCFACE 512-D LIGHTBOX INSPECTION -->
  <div class="modal-backdrop" id="charLightboxModal">
    <div class="modal-window" style="max-width: 780px;">
      <div class="modal-header">
        <div class="modal-title">
          <span style="color: var(--accent-cyan); font-size: 18px;">🔍</span>
          <span id="lightboxCharName">CHI TIẾT MỎ NEO NHÂN VẬT (512-D ARCFACE)</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closeCharLightboxModal()">✕ Đóng</button>
      </div>
      <div class="modal-body" style="display: grid; grid-template-columns: 280px 1fr; gap: 24px;">
        <div style="aspect-ratio: 3/4; border-radius: var(--radius-md); overflow: hidden; background: #000; border: 1px solid var(--border-default);">
          <img id="lightboxImg" src="" style="width: 100%; height: 100%; object-fit: cover;">
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div>
            <div class="caption">MÃ ĐỊNH DANH (CANON ID)</div>
            <div id="lightboxCharId" style="font-family: var(--font-mono); font-size: 13.5px; color: var(--accent-cyan); font-weight: 700;">-</div>
          </div>
          <div>
            <div class="caption">TỔNG QUAN NGOẠI HÌNH</div>
            <div id="lightboxVisual" style="font-size: 13px; line-height: 1.55; color: var(--text-primary);">-</div>
          </div>
          <div>
            <div class="caption">DẤU HIỆU NHẬN DẠNG ĐẶC TRƯNG</div>
            <div id="lightboxMarks" style="font-size: 13px; color: var(--accent-amber);">-</div>
          </div>
          <div>
            <div class="caption">TRẠNG THÁI VECTOR ARCFACE</div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
              <span class="card-badge badge-arcface">LOCKED 512-D</span>
              <span class="caption" style="font-family: var(--font-mono); font-size: 11px;">Norm: 1.000 | Euclidean Drift &lt; 0.12</span>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeCharLightboxModal()">Đóng</button>
      </div>
    </div>
  </div>

  <!-- Toast Container -->
  <div id="toastContainer"></div>

  <!-- Client JavaScript -->
  <script>
    let currentSeriesId = "";
    let activeProviders = [];
    let currentBibleData = null;

    // Interactive Spotlight Engine on Acrylic Cards
    function attachSpotlightEngine() {
      document.querySelectorAll(".card, .character-card, .provider-card, .take-review-card").forEach(card => {
        card.addEventListener("mousemove", e => {
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          card.style.setProperty("--mouse-x", \`\${x}px\`);
          card.style.setProperty("--mouse-y", \`\${y}px\`);
        });
      });
    }

    // Animated Multi-Band VU Bars Engine
    function initVuBars() {
      ['vuVoiceBars', 'vuSfxBars', 'vuBgmBars'].forEach((id, idx) => {
        const container = document.getElementById(id);
        if (!container) return;
        container.innerHTML = "";
        const barCount = 12;
        const color = idx === 0 ? 'var(--accent-cyan)' : idx === 1 ? 'var(--accent-indigo)' : 'var(--accent-amber)';
        for (let i = 0; i < barCount; i++) {
          const bar = document.createElement("div");
          bar.className = "vu-bar";
          bar.style.background = color;
          bar.style.height = \`\${Math.floor(Math.random() * 12 + 4)}px\`;
          container.appendChild(bar);
        }
      });

      // Fluctuate VU bars smoothly
      setInterval(() => {
        ['vuVoiceBars', 'vuSfxBars', 'vuBgmBars'].forEach(id => {
          const container = document.getElementById(id);
          if (!container) return;
          container.querySelectorAll(".vu-bar").forEach(bar => {
            bar.style.height = \`\${Math.floor(Math.random() * 14 + 3)}px\`;
          });
        });
      }, 180);
    }

    // Toast Notification Engine
    function showToast(message, type = "info") {
      const container = document.getElementById("toastContainer");
      const toast = document.createElement("div");
      toast.className = \`toast \${type}\`;
      const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
      toast.innerHTML = \`<span>\${icon}</span> <span>\${message}</span>\`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(50px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    // Modal Control
    function openModelHubModal() {
      document.getElementById("modelHubModal").classList.add("active");
      fetchModelSettings();
    }
    function closeModelHubModal() {
      document.getElementById("modelHubModal").classList.remove("active");
    }

    function openPreAuditModal() {
      document.getElementById("preAuditModal").classList.add("active");
    }
    function closePreAuditModal() {
      document.getElementById("preAuditModal").classList.remove("active");
    }

    function openCharLightbox(charId) {
      if (!currentBibleData || !currentBibleData.characters) return;
      const char = currentBibleData.characters.find(c => c.id === charId);
      if (!char) return;

      document.getElementById("lightboxCharName").textContent = \`MỎ NEO: \${char.name.toUpperCase()}\`;
      document.getElementById("lightboxCharId").textContent = char.id;
      document.getElementById("lightboxVisual").textContent = char.visual_summary || 'Chưa cập nhật mô tả ngoại hình.';
      document.getElementById("lightboxMarks").textContent = char.distinguishing_marks || 'Không có dấu hiệu đặc biệt.';
      const imgSrc = char.face_reference_image ? \`/api/media/stream?path=\${encodeURIComponent(char.face_reference_image)}\` : '';
      document.getElementById("lightboxImg").src = imgSrc;

      document.getElementById("charLightboxModal").classList.add("active");
    }
    function closeCharLightboxModal() {
      document.getElementById("charLightboxModal").classList.remove("active");
    }

    // Tab Navigation
    function switchTab(tabId) {
      document.querySelectorAll(".view-panel").forEach(p => p.classList.remove("active"));
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.getElementById(tabId).classList.add("active");
      if (event && event.currentTarget) {
        event.currentTarget.classList.add("active");
      }
      setTimeout(attachSpotlightEngine, 100);
    }

    // Password Mask Toggle Helper
    function togglePasswordMask(fieldId, btnEl) {
      const inputEl = document.getElementById(fieldId);
      if (!inputEl) return;
      if (inputEl.type === 'password') {
        inputEl.type = 'text';
        btnEl.textContent = '🙈';
        btnEl.title = 'Ẩn khóa bí mật';
      } else {
        inputEl.type = 'password';
        btnEl.textContent = '👁️';
        btnEl.title = 'Hiện khóa';
      }
    }

    // Screenplay Dual-View Toggle
    function toggleScreenplayMode(mode) {
      const textView = document.getElementById("screenplayTextView");
      const cardsView = document.getElementById("screenplayCardsView");
      const btnText = document.getElementById("btnModeText");
      const btnCards = document.getElementById("btnModeCards");

      if (mode === "text") {
        textView.style.display = "block";
        cardsView.style.display = "none";
        btnText.classList.add("active");
        btnCards.classList.remove("active");
      } else {
        textView.style.display = "none";
        cardsView.style.display = "block";
        btnText.classList.remove("active");
        btnCards.classList.add("active");
        parseCardsFromText();
      }
    }

    // Parse Screenplay Text into Visual Storyboard Cards
    function parseCardsFromText() {
      const text = document.getElementById("screenplayOutput").value;
      const container = document.getElementById("storyboardCardsContainer");
      container.innerHTML = "";

      if (!text || text.trim().length === 0) {
        container.innerHTML = '<div class="caption" style="text-align: center; padding: 40px;">Chưa có kịch bản để phân tách thành thẻ.</div>';
        return;
      }

      const lines = text.split(/\\r?\\n/);
      let currentSceneCard = null;

      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith("CẢNH") || trimmed.startsWith("SCENE")) {
          currentSceneCard = document.createElement("div");
          currentSceneCard.className = "scene-breakdown-card";
          currentSceneCard.innerHTML = \`<div style="font-weight: 800; font-size: 14px; color: var(--accent-cyan); margin-bottom: 8px;">\${trimmed}</div>\`;
          container.appendChild(currentSceneCard);
        } else if (trimmed.startsWith("- CÚ MÁY") || trimmed.startsWith("CÚ MÁY") || trimmed.startsWith("- SHOT")) {
          if (!currentSceneCard) {
            currentSceneCard = document.createElement("div");
            currentSceneCard.className = "scene-breakdown-card";
            container.appendChild(currentSceneCard);
          }
          const shotEl = document.createElement("div");
          shotEl.className = "shot-card";
          shotEl.innerHTML = \`
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <span class="shot-badge-type">CINEMA SHOT</span>
              <span class="lens-chip">50mm T1.5 Anamorphic</span>
              <span class="caption" style="font-family: var(--font-mono); margin-top: 2px;">4.0s (24fps)</span>
            </div>
            <div>
              <div style="font-size: 13.5px; color: var(--text-primary); line-height: 1.55;">\${trimmed}</div>
            </div>
          \`;
          currentSceneCard.appendChild(shotEl);
        } else if (trimmed.startsWith("THOẠI:") || trimmed.startsWith("LỜI THOẠI:")) {
          if (currentSceneCard) {
            const dialogue = document.createElement("div");
            dialogue.className = "dialogue-bubble";
            dialogue.innerHTML = \`<span class="dialogue-speaker">🗣️ THOẠI</span> \${trimmed.replace(/^(THOẠI:|LỜI THOẠI:)/, '').trim()}\`;
            currentSceneCard.appendChild(dialogue);
          }
        }
      });

      showToast("Đã đồng bộ sang Thẻ Storyboard trực quan!", "success");
      setTimeout(attachSpotlightEngine, 100);
    }

    // Settings & Model Hub
    async function fetchModelSettings() {
      try {
        const res = await fetch("/api/settings/models");
        const data = await res.json();
        activeProviders = data.providers || [];
        renderProviderCards();
      } catch (err) {
        showToast("Không thể tải danh sách Model", "error");
      }
    }

    function renderProviderCards() {
      const grid = document.getElementById("providerCardsGrid");
      grid.innerHTML = "";

      activeProviders.forEach(p => {
        const card = document.createElement("div");
        card.className = "provider-card";
        const fieldsHtml = p.fields.map(f => {
          const fieldId = \`field_\${p.id}_\${f.key}\`;
          if (f.type === "select") {
            const opts = (f.options || []).map(o => \`<option value="\${o}" \${o === f.value ? 'selected' : ''}>\${o}</option>\`).join("");
            return \`
              <div style="margin-top: 10px;">
                <label>\${f.label}:</label>
                <select id="\${fieldId}" style="width: 100%;">\${opts}</select>
              </div>
            \`;
          }
          if (f.type === "password") {
            return \`
              <div style="margin-top: 10px;">
                <label>\${f.label}:</label>
                <div class="password-input-wrap">
                  <input type="password" id="\${fieldId}" value="\${f.value || ''}" placeholder="\${f.placeholder || ''}" autocomplete="off" style="width: 100%;">
                  <button type="button" class="password-toggle-btn" onclick="togglePasswordMask('\${fieldId}', this)" title="Hiện khóa">👁️</button>
                </div>
              </div>
            \`;
          }
          return \`
            <div style="margin-top: 10px;">
              <label>\${f.label}:</label>
              <input type="\${f.type}" id="\${fieldId}" value="\${f.value || ''}" placeholder="\${f.placeholder || ''}" style="width: 100%;">
            </div>
          \`;
        }).join("");

        card.innerHTML = \`
          <div class="card-header" style="margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 22px;">\${p.icon}</span>
              <div>
                <div class="h2" style="font-size: 14px;">\${p.name}</div>
                <div class="caption">\${p.description}</div>
              </div>
            </div>
            <span class="card-badge \${p.isConfigured ? 'badge-arcface' : 'badge-warn'}">
              \${p.isConfigured ? 'SẴN SÀNG' : 'CHƯA KHÓA KEY'}
            </span>
          </div>
          <div>\${fieldsHtml}</div>
          <div style="margin-top: 12px;">
            <button class="btn btn-secondary btn-sm" style="width: 100%; justify-content: center;" onclick="testConnection('\${p.id}')">
              ⚡ Kiểm Tra Kết Nối (Ping Probe)
            </button>
          </div>
          <div id="pingResult_\${p.id}" class="ping-feedback-box" style="display: none;"></div>
        \`;
        grid.appendChild(card);
      });
      setTimeout(attachSpotlightEngine, 100);
    }

    async function testConnection(providerId) {
      const resultBox = document.getElementById(\`pingResult_\${providerId}\`);
      resultBox.style.display = "flex";
      resultBox.className = "ping-feedback-box ping-feedback-testing";
      resultBox.innerHTML = "<span>⏳ Đang kiểm tra kết nối probe...</span>";

      const p = activeProviders.find(x => x.id === providerId);
      const credentials = {};
      if (p) {
        p.fields.forEach(f => {
          const el = document.getElementById(\`field_\${p.id}_\${f.key}\`);
          if (el) credentials[f.key] = el.value;
        });
      }

      try {
        const res = await fetch("/api/settings/test-connection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId, credentials })
        });
        const data = await res.json();
        if (data.success) {
          resultBox.className = "ping-feedback-box ping-feedback-success";
          resultBox.innerHTML = \`<span>✓ \${data.message}</span> <span class="latency-pill">\${data.latencyMs}ms</span>\`;
          showToast(\`Kết nối \${providerId.toUpperCase()} thành công!\`, "success");
        } else {
          resultBox.className = "ping-feedback-box ping-feedback-error";
          resultBox.innerHTML = \`<span>✕ \${data.message}</span>\`;
          showToast(\`Lỗi kết nối \${providerId}\`, "error");
        }
      } catch (err) {
        resultBox.className = "ping-feedback-box ping-feedback-error";
        resultBox.innerHTML = "<span>✕ Lỗi mạng khi gọi server test</span>";
      }
    }

    async function saveAllProviderSettings() {
      const updates = {};
      activeProviders.forEach(p => {
        p.fields.forEach(f => {
          const el = document.getElementById(\`field_\${p.id}_\${f.key}\`);
          if (el && el.value && !el.value.includes("••••")) {
            updates[f.envKey] = el.value;
          }
        });
      });

      try {
        const res = await fetch("/api/settings/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates })
        });
        const data = await res.json();
        if (data.success) {
          showToast("Đã lưu cấu hình an toàn vào .env.local!", "success");
          closeModelHubModal();
          fetchModelSettings();
        }
      } catch (err) {
        showToast("Lỗi khi lưu cấu hình", "error");
      }
    }

    // Series & Character Management
    async function init() {
      await fetchSeriesList();
      initVuBars();
      attachSpotlightEngine();
    }

    async function fetchSeriesList() {
      const res = await fetch("/api/series/list");
      const data = await res.json();
      const select = document.getElementById("seriesSelect");
      select.innerHTML = "";
      if (!data.series || data.series.length === 0) {
        select.innerHTML = '<option value="">(Chưa có series nào)</option>';
        return;
      }
      data.series.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = \`\${s.title} (\${s.id})\`;
        select.appendChild(opt);
      });
      if (!currentSeriesId && data.series[0]) {
        currentSeriesId = data.series[0].id;
      }
      select.value = currentSeriesId;
      loadCurrentSeries();
    }

    async function loadCurrentSeries() {
      const sel = document.getElementById("seriesSelect");
      currentSeriesId = sel.value;
      if (!currentSeriesId) return;

      const res = await fetch(\`/api/series/\${currentSeriesId}/bible\`);
      const data = await res.json();
      currentBibleData = data;
      document.getElementById("activeSeriesTitle").textContent = data.metadata?.title || currentSeriesId;
      document.getElementById("seriesGenreVisual").textContent = \`Thể loại: \${data.metadata?.genre || 'Điện ảnh'} | Visual Style: \${data.metadata?.visual_style || ''}\`;

      // Render Casting Cards with Inspect Lightbox trigger
      const grid = document.getElementById("charCardsGrid");
      grid.innerHTML = "";
      (data.characters || []).forEach(c => {
        const card = document.createElement("div");
        card.className = "character-card";
        const imgSrc = c.face_reference_image ? \`/api/media/stream?path=\${encodeURIComponent(c.face_reference_image)}\` : '';
        card.innerHTML = \`
          <div class="portrait-box" onclick="openCharLightbox('\${c.id}')" title="Bấm để xem chi tiết mỏ neo 512-D">
            \${imgSrc ? \`<img src="\${imgSrc}" class="portrait-img">\` : '<div class="portrait-placeholder">Chưa có ảnh mẫu mỏ neo</div>'}
            <div class="portrait-inspect-hint">🔍 Xem mỏ neo</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-weight: 700; font-size: 15px;">\${c.name}</div>
            <span class="card-badge badge-arcface">512-D ANCHOR</span>
          </div>
          <div class="caption" style="line-height: 1.5;">
            <div>Vai trò: \${c.role || 'Chính'} | Trạng thái: \${c.status || 'intact'}</div>
            \${c.distinguishing_marks ? \`<div>Dấu hiệu: \${c.distinguishing_marks}</div>\` : ''}
          </div>
          <button class="btn btn-secondary btn-sm" style="width: 100%; justify-content: center;" onclick="generateCharArt('\${c.id}')">
            🎨 AI Vẽ Chân Dung Mỏ Neo
          </button>
        \`;
        grid.appendChild(card);
      });
      setTimeout(attachSpotlightEngine, 100);
    }

    async function generateCharArt(charId) {
      showToast(\`Đang tạo chân dung 512-D cho \${charId}...\`, "info");
      const res = await fetch(\`/api/series/\${currentSeriesId}/gen-art\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "character", id: charId, provider: "mock" })
      });
      const data = await res.json();
      if (data.success) {
        showToast("Khóa vector ArcFace thành công!", "success");
        loadCurrentSeries();
      }
    }

    async function generateScreenplay() {
      const text = document.getElementById("storyInput").value;
      const epNum = parseInt(document.getElementById("targetEpNum").value, 10) || 1;
      if (!text) { showToast("Vui lòng nhập ý tưởng kịch bản", "error"); return; }

      document.getElementById("screenplayOutput").value = "⏳ Đang kết nối Story Bible và biên kịch...";
      const res = await fetch(\`/api/series/\${currentSeriesId}/script/generate\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyText: text, episodeNumber: epNum, targetScenes: 3 })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById("screenplayOutput").value = data.result.rawScreenplay;
        showToast("Biên kịch phân cảnh hoàn tất!", "success");
      }
    }

    async function saveAndGoToProduction() {
      const raw = document.getElementById("screenplayOutput").value;
      const epNum = parseInt(document.getElementById("targetEpNum").value, 10) || 1;
      if (!raw) { showToast("Chưa có kịch bản", "error"); return; }

      await fetch(\`/api/series/\${currentSeriesId}/script/save\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawScreenplay: raw, episodeNumber: epNum })
      });

      showToast("Đã lưu kịch bản. Chuyển sang Bàn Sản Xuất...", "success");
      document.querySelectorAll(".tab-btn")[2].click();
    }

    function populateSampleTakes() {
      const container = document.getElementById("takesContainer");
      container.innerHTML = \`
        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px; padding: 4px 8px; background: rgba(245, 158, 11, 0.1); border-radius: 4px; border: 1px dashed rgba(245, 158, 11, 0.3);">
          ⚠️ [DEMO PROTOTYPE] Bảng take dưới đây là dữ liệu mẫu giao diện. Để duyệt take sản xuất thực tế với Story Bible SQLite, hãy sử dụng giao diện Series Review Dashboard.
        </div>
        <div class="take-review-card">
          <div class="take-thumb-box">▶ Take 1</div>
          <div>
            <div style="font-weight: 700; font-size: 13.5px;">Cảnh 1 • Cú máy 1: Góc cận Minh</div>
            <div class="caption" style="margin-top: 2px;">Thời lượng: 4.0s | Camera: Medium Close-up | Anamorphic 50mm</div>
            <div class="qa-gauge-meter" style="margin-top: 4px;">
              <span>Face QA: 0.89</span>
              <div class="qa-gauge-bar"><div class="qa-gauge-fill" style="width: 89%;"></div></div>
              <span style="color: var(--accent-emerald);">Đạt chuẩn</span>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <button class="btn btn-emerald btn-sm" onclick="showToast('[DEMO] Phê duyệt Take 1 vào bản Master', 'success')">✓ Duyệt</button>
            <button class="btn btn-secondary btn-sm" onclick="showToast('[DEMO] Xếp hàng quay lại Take 1', 'info')">↻ Reroll</button>
          </div>
        </div>

        <div class="take-review-card">
          <div class="take-thumb-box">▶ Take 2</div>
          <div>
            <div style="font-weight: 700; font-size: 13.5px;">Cảnh 1 • Cú máy 2: Toàn cảnh hành lang Skyline</div>
            <div class="caption" style="margin-top: 2px;">Thời lượng: 3.5s | Camera: Wide Cinematic Tracking | 24mm T1.8</div>
            <div class="qa-gauge-meter" style="margin-top: 4px;">
              <span>Face QA: 0.92</span>
              <div class="qa-gauge-bar"><div class="qa-gauge-fill" style="width: 92%;"></div></div>
              <span style="color: var(--accent-emerald);">Đạt chuẩn</span>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <button class="btn btn-emerald btn-sm" onclick="showToast('[DEMO] Phê duyệt Take 2 vào bản Master', 'success')">✓ Duyệt</button>
            <button class="btn btn-secondary btn-sm" onclick="showToast('[DEMO] Xếp hàng quay lại Take 2', 'info')">↻ Reroll</button>
          </div>
        </div>
      \`;
      showToast("Đã nạp danh sách take mẫu cho đạo diễn!", "success");
      setTimeout(attachSpotlightEngine, 100);
    }

    function startProduction() {
      const epNum = parseInt(document.getElementById("targetEpNum").value, 10) || 1;
      const term = document.getElementById("logTerminal");
      term.innerHTML = \`[KICKOFF] Bắt đầu sản xuất Tập \${epNum}...\n\`;

      const evtSource = new EventSource(\`/api/series/\${currentSeriesId}/episodes/\${epNum}/events\`);
      evtSource.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.type === "progress") {
          term.innerHTML += \`[BƯỚC \${d.step}/\${d.totalSteps}] \${d.message}\n\`;
          term.scrollTop = term.scrollHeight;

          for (let i = 1; i <= 8; i++) {
            const el = document.getElementById(\`step\${i}\`);
            if (i < d.step) el.className = "step-box completed";
            else if (i === d.step) el.className = "step-box active";
            else el.className = "step-box";
          }
        } else if (d.type === "complete") {
          term.innerHTML += \`\n🎉 [HOÀN TẤT] Video: \${d.result?.videoPath}\n\`;
          evtSource.close();
          showToast("Tập phim đã hoàn tất xuất xưởng!", "success");
          if (d.result?.videoPath) {
            const streamUrl = \`/api/media/stream?path=\${encodeURIComponent(d.result.videoPath)}\`;
            document.getElementById("cinemaVideo").src = streamUrl;
            document.getElementById("downloadVideoBtn").href = streamUrl;
          }
          populateSampleTakes();
        }
      };

      const raw = document.getElementById("screenplayOutput").value;
      fetch(\`/api/series/\${currentSeriesId}/episodes/produce\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeNumber: epNum, rawScreenplay: raw, dryRun: false, provider: "mock", async: true })
      });
    }

    async function openNewSeriesModal() {
      const id = prompt("Nhập ID cho Series mới (ví dụ: cyber-saigon):");
      if (!id) return;
      const title = prompt("Tiêu đề phim:") || id;
      await fetch("/api/series/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title })
      });
      showToast("Đã khởi tạo Series mới!", "success");
      await fetchSeriesList();
    }

    async function openNewCharModal() {
      if (!currentSeriesId) return;
      const name = prompt("Tên nhân vật:");
      if (!name) return;
      const id = name.toLowerCase().replace(/\\s+/g, "_");
      const visual = prompt("Mô tả ngoại hình:", \`\${name}, 30 tuổi, phong cách điện ảnh\`);
      await fetch(\`/api/series/\${currentSeriesId}/characters\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name, visual_summary: visual })
      });
      showToast("Đã đăng ký nhân vật!", "success");
      loadCurrentSeries();
    }

    window.onload = init;
  </script>
</body>
</html>`;
}
