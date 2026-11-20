'use strict';
// Line icons drawn for Halka in the spirit of SF Symbols (24 px grid, round caps).
(() => {
  const svg = (body) => `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true">${body}</svg>`;
  window.ICONS = {
    clipboard: svg('<rect x="5" y="4.5" width="14" height="16.5" rx="3"/><path d="M9 4.5v-.3A1.7 1.7 0 0 1 10.7 2.5h2.6A1.7 1.7 0 0 1 15 4.2v.3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 4.5z"/><path d="M8.8 11h6.4M8.8 14.5h6.4M8.8 18h3.8"/>'),
    convert: svg('<path d="M4.5 10a7.6 7.6 0 0 1 13.4-3.6"/><path d="M18.6 3.4v3.8h-3.8"/><path d="M19.5 14a7.6 7.6 0 0 1-13.4 3.6"/><path d="M5.4 20.6v-3.8h3.8"/>'),
    text: svg('<path d="M3 18.5 7.6 6h.8l4.6 12.5M4.7 14.3h6.6"/><path d="M15.2 11.3a3.1 3.1 0 0 1 2.7-1.4c1.9 0 3.1 1.1 3.1 3v5.6M21 14.4c-3.9 0-6 .9-6 2.6 0 1.1.9 1.8 2.2 1.8 2 0 3.8-1.4 3.8-3.7"/>'),
    plain: svg('<path d="M7 3h7.5L19 7.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v4.5h5"/><path d="M8.5 12.5h7M8.5 16h5"/>'),
    screenshot: svg('<path d="M3.5 8V6a2.5 2.5 0 0 1 2.5-2.5h2M16 3.5h2A2.5 2.5 0 0 1 20.5 6v2M20.5 16v2a2.5 2.5 0 0 1-2.5 2.5h-2M8 20.5H6A2.5 2.5 0 0 1 3.5 18v-2"/><path d="M8.5 9.6a1.6 1.6 0 0 1 1.6-1.6h.6l.8-1.2h3l.8 1.2h.6a1.6 1.6 0 0 1 1.6 1.6v4.8a1.6 1.6 0 0 1-1.6 1.6h-5.8a1.6 1.6 0 0 1-1.6-1.6z" transform="translate(-1 0.5)"/><circle cx="12" cy="12.6" r="1.9"/>'),
    qr: svg('<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.6"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.6"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.6"/><path d="M14 14h2.6v2.6H14zM18 18h2.5v2.5H18zM14 19.5v1M19.5 14h1"/>'),
    pinned: svg('<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>'),
    settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/><path d="M4 12h3.5M12 12h8"/><circle cx="9.8" cy="12" r="2.2"/>'),
    back: svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
    close: svg('<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>'),
    halka: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4"/>'),
    file: svg('<path d="M7 3h7.5L19 7.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v4.5h5"/>'),
    files: svg('<path d="M9 6.5V5a2 2 0 0 1 2-2h5l4 4v9a2 2 0 0 1-2 2h-1.5"/><path d="M5.5 7h6l3.5 3.5V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/>'),
    image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="9.8" r="1.7"/><path d="m3.8 17.3 4.9-4.6 3.6 3.2 3-2.6 4.9 4.3"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3.1-3.1a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3.1 3.1a4 4 0 0 0 5.7 5.7l1-1"/>'),
    shrink: svg('<path d="M14 4.5V10h5.5M10 19.5V14H4.5M14 10l6-6M10 14l-6 6"/>'),
    compress: svg('<path d="M12 3v6M9 6.5 12 9.5l3-3M12 21v-6M9 17.5l3-3 3 3M4 12h16"/>'),
    zip: svg('<rect x="3.5" y="4" width="17" height="4.5" rx="1.3"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path d="M10 12.5h4"/>'),
    copyPath: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>'),
    pdf: svg('<path d="M7 3h7.5L19 7.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v4.5h5"/><path d="M8.5 16.8c1.8-1 3.6-4.3 3.6-6 0-1-.8-1.2-1.1-.4-.6 1.5 1.5 4.8 4.5 5.3.9.1 1.1-.7.4-1-1.6-.6-5.6.3-7.4 2.1z"/>'),
    scanText: svg('<path d="M3.5 8V6a2.5 2.5 0 0 1 2.5-2.5h2M16 3.5h2A2.5 2.5 0 0 1 20.5 6v2M20.5 16v2a2.5 2.5 0 0 1-2.5 2.5h-2M8 20.5H6A2.5 2.5 0 0 1 3.5 18v-2"/><path d="M8 9h8M8 12h8M8 15h5"/>'),
    screenText: svg('<rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M8.5 21h7M12 17v4"/><path d="M7 8.5h10M7 11.5h7"/>'),
    search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    warning: svg('<path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.4 12.9a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z"/><path d="M12 9.5v4M12 17h.01"/>'),
    info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>')
  };
})();
