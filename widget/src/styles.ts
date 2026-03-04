/**
 * CSS-in-JS styles for the KommuniQ chat widget.
 * Injected into shadow DOM for full isolation from host page styles.
 * Supports CSS custom properties for tenant branding.
 */

export function buildStyles(primaryColor: string): string {
  return `
    :host {
      --kq-primary: ${primaryColor};
      --kq-primary-dark: color-mix(in srgb, ${primaryColor} 80%, black);
      --kq-bg: #ffffff;
      --kq-surface: #f8f9fa;
      --kq-border: #e9ecef;
      --kq-text: #212529;
      --kq-text-muted: #6c757d;
      --kq-radius: 12px;
      --kq-shadow: 0 8px 32px rgba(0,0,0,0.18);
      --kq-bubble-size: 60px;
      --kq-window-w: 400px;
      --kq-window-h: 600px;
      --kq-z: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      box-sizing: border-box;
    }

    *, *::before, *::after {
      box-sizing: inherit;
    }

    /* ── Launcher bubble ─────────────────────────────────────────── */
    #kq-launcher {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: var(--kq-bubble-size);
      height: var(--kq-bubble-size);
      border-radius: 50%;
      background: var(--kq-primary);
      box-shadow: var(--kq-shadow);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: var(--kq-z);
      border: none;
      outline: none;
      transition: transform 0.2s ease, background 0.2s ease;
    }

    #kq-launcher:hover {
      transform: scale(1.08);
      background: var(--kq-primary-dark);
    }

    #kq-launcher:active {
      transform: scale(0.96);
    }

    #kq-launcher svg {
      width: 28px;
      height: 28px;
      fill: #fff;
    }

    #kq-unread-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #e53e3e;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }

    #kq-unread-badge.hidden {
      display: none;
    }

    /* ── Chat window ─────────────────────────────────────────────── */
    #kq-window {
      position: fixed;
      bottom: calc(var(--kq-bubble-size) + 40px);
      right: 24px;
      width: var(--kq-window-w);
      max-width: calc(100vw - 32px);
      height: var(--kq-window-h);
      max-height: calc(100vh - 120px);
      background: var(--kq-bg);
      border-radius: var(--kq-radius);
      box-shadow: var(--kq-shadow);
      z-index: var(--kq-z);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform-origin: bottom right;
      transition: opacity 0.22s ease, transform 0.22s ease;
    }

    #kq-window.kq-hidden {
      opacity: 0;
      transform: scale(0.92) translateY(12px);
      pointer-events: none;
    }

    /* ── Header ──────────────────────────────────────────────────── */
    #kq-header {
      background: var(--kq-primary);
      color: #fff;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      min-height: 64px;
    }

    #kq-header-title {
      font-weight: 600;
      font-size: 15px;
    }

    #kq-header-subtitle {
      font-size: 12px;
      opacity: 0.85;
      margin-top: 2px;
    }

    #kq-close-btn {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.8;
      transition: opacity 0.15s;
    }

    #kq-close-btn:hover { opacity: 1; }

    #kq-close-btn svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }

    /* ── Message list ────────────────────────────────────────────── */
    #kq-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
    }

    #kq-messages::-webkit-scrollbar { width: 4px; }
    #kq-messages::-webkit-scrollbar-track { background: transparent; }
    #kq-messages::-webkit-scrollbar-thumb { background: var(--kq-border); border-radius: 4px; }

    .kq-msg {
      max-width: 78%;
      padding: 10px 14px;
      border-radius: 16px;
      line-height: 1.45;
      word-break: break-word;
      font-size: 13.5px;
    }

    .kq-msg-inbound {
      background: var(--kq-surface);
      color: var(--kq-text);
      border-bottom-left-radius: 4px;
      align-self: flex-start;
    }

    .kq-msg-outbound {
      background: var(--kq-primary);
      color: #fff;
      border-bottom-right-radius: 4px;
      align-self: flex-end;
    }

    .kq-msg-time {
      font-size: 11px;
      opacity: 0.65;
      margin-top: 4px;
      display: block;
    }

    /* ── Greeting ────────────────────────────────────────────────── */
    #kq-greeting {
      margin: 0 16px 4px;
      padding: 12px 16px;
      background: var(--kq-surface);
      border-radius: 12px;
      font-size: 13px;
      color: var(--kq-text-muted);
      line-height: 1.5;
      flex-shrink: 0;
    }

    /* ── Typing indicator ────────────────────────────────────────── */
    #kq-typing {
      padding: 4px 16px 8px;
      font-size: 12px;
      color: var(--kq-text-muted);
      min-height: 24px;
      flex-shrink: 0;
    }

    .kq-dots span {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--kq-text-muted);
      margin: 0 1px;
      animation: kq-bounce 1.2s infinite;
    }

    .kq-dots span:nth-child(2) { animation-delay: 0.2s; }
    .kq-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes kq-bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40%           { transform: translateY(-5px); }
    }

    /* ── Input area ──────────────────────────────────────────────── */
    #kq-input-area {
      padding: 12px 16px;
      border-top: 1px solid var(--kq-border);
      display: flex;
      gap: 8px;
      align-items: flex-end;
      flex-shrink: 0;
    }

    #kq-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--kq-border);
      border-radius: 22px;
      font-size: 13.5px;
      font-family: inherit;
      resize: none;
      line-height: 1.4;
      max-height: 120px;
      outline: none;
      background: var(--kq-bg);
      color: var(--kq-text);
      transition: border-color 0.15s;
    }

    #kq-input:focus {
      border-color: var(--kq-primary);
    }

    #kq-input::placeholder {
      color: var(--kq-text-muted);
    }

    #kq-send-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--kq-primary);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s, transform 0.1s;
    }

    #kq-send-btn:hover { background: var(--kq-primary-dark); }
    #kq-send-btn:active { transform: scale(0.93); }
    #kq-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    #kq-send-btn svg {
      width: 18px;
      height: 18px;
      fill: #fff;
    }

    /* ── Connection status banner ────────────────────────────────── */
    #kq-status-bar {
      text-align: center;
      font-size: 11px;
      padding: 4px 0;
      transition: opacity 0.3s;
      flex-shrink: 0;
    }

    #kq-status-bar.kq-offline {
      background: #fff3cd;
      color: #856404;
    }

    #kq-status-bar.kq-connected {
      opacity: 0;
      height: 0;
      overflow: hidden;
    }

    /* ── Responsive ──────────────────────────────────────────────── */
    @media (max-width: 480px) {
      #kq-window {
        right: 0;
        bottom: 0;
        width: 100vw;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        border-radius: 0;
      }
      #kq-launcher {
        bottom: 16px;
        right: 16px;
      }
    }
  `
}
