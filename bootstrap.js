const MENU_ID_CONTEXT = "lgfetcher-context-menu-item";
const MENU_ID_TOOLS = "lgfetcher-tools-menu-item";
const MENU_LABEL = "LGFetcher - Find a Copy";
let LGFetcherRootURI = null;
let LGFetcherBusy = false;

async function runLGFetcher(window, selectedItems = null) {
  const Zotero = window.Zotero;
  const DOMParser = window.DOMParser;
  const Cc = window.Cc;
  const Ci = window.Ci;
  const fetch = window.fetch.bind(window);
  const HTTP = Zotero.HTTP;
  const AbortController = window.AbortController;
  const URL = window.URL;
  const setTimeout = window.setTimeout.bind(window);
  const clearTimeout = window.clearTimeout.bind(window);
  let items = selectedItems || window.ZoteroPane?.getSelectedItems?.() || Zotero.getActiveZoteroPane()?.getSelectedItems?.() || [];
  if (!items.length) {
    return "Please select one item in your Zotero library first!";
  }
  if (items.length > 1) {
    return "LGFetcher can process only one item at a time. Please select a single Zotero item and try again.";
  }

  // Mirror URLs are read exclusively from the LGFetcher preference.
  let mirrorPref = "";
  try { mirrorPref = Zotero.Prefs.get("extensions.lgfetcher.mirrors", true) || ""; } catch (e) {}
  const MIRRORS = mirrorPref
    .split(/\r?\n/)
    .map(value => value.trim().replace(/\/$/, ""))
    .filter(value => /^https?:\/\//i.test(value));
  if (!MIRRORS.length) {
    return "No LibGen mirror URLs are configured. Open Settings → LGFetcher and add at least one mirror URL.";
  }

  const FORMAT_PREFS = {
    PDF: "extensions.lgfetcher.formats.pdf",
    EPUB: "extensions.lgfetcher.formats.epub",
    DJVU: "extensions.lgfetcher.formats.djvu",
    MOBI: "extensions.lgfetcher.formats.mobi"
  };
  const ENABLED_FORMATS = new Set(Object.entries(FORMAT_PREFS).filter(([format, pref]) => {
    try {
      const value = Zotero.Prefs.get(pref, true);
      return value === undefined ? true : Boolean(value);
    } catch (e) {
      return true;
    }
  }).map(([format]) => format));
  if (!ENABLED_FORMATS.size) {
    return "No file types are enabled. Open Settings → LGFetcher and select at least one file type.";
  }

  // Progress UI and cooperative download controls
  const downloadControl = {
    paused: false,
    cancelled: false,
    activeAbortController: null,
    activeXHR: null,
    pauseButton: null,
    cancelButton: null,
    async waitIfPaused() {
      while (this.paused && !this.cancelled) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.cancelled) throw new Error("LGFETCHER_CANCELLED");
    },
    cancel() {
      this.cancelled = true;
      this.paused = false;
      try { this.activeAbortController?.abort(); } catch (e) {}
      try { this.activeXHR?.abort(); } catch (e) {}
      if (this.pauseButton) this.pauseButton.disabled = true;
      if (this.cancelButton) {
        this.cancelButton.disabled = true;
        this.cancelButton.setAttribute("label", "Cancelling...");
      }
    }
  };

  let capturedProgressWindow = null;
  let progressWin = null;
  let itemProgress = null;

  function closeProgressUI() {
    try { progressWin?.close(); } catch (e) {}
    try {
      if (capturedProgressWindow && !capturedProgressWindow.closed) {
        capturedProgressWindow.close();
      }
    } catch (e) {}
    capturedProgressWindow = null;
    progressWin = null;
    itemProgress = null;
    downloadControl.pauseButton = null;
    downloadControl.cancelButton = null;
  }

  function openProgressUI(initialText = "Starting search...", showDownloadControls = false, itemTitle = "") {
    // Zotero progress windows can remain tiled after a phase transition.
    // Always close the current one before opening the next phase so only one
    // LGFetcher progress window and one ItemProgress row can exist at a time.
    closeProgressUI();
    const originalOpenDialog = window.openDialog;
    window.openDialog = function(url, ...args) {
      const opened = originalOpenDialog.call(this, url, ...args);
      if (url === "chrome://zotero/content/progressWindow.xhtml") {
        capturedProgressWindow = opened;
      }
      return opened;
    };

    progressWin = new Zotero.ProgressWindow({ window, closeOnClick: false });
    progressWin.changeHeadline(showDownloadControls ? "LGFetcher Download" : "LGFetcher Search");
    try {
      progressWin.show();
    } finally {
      window.openDialog = originalOpenDialog;
    }
    // Prefix every native ItemProgress status with a nonbreaking space.
    // Zotero's XUL layout can ignore CSS margins, flex gaps, and spacer nodes,
    // but a nonbreaking space inside the rendered label is preserved.
    const statusTextPrefix = "\u00A0";
    itemProgress = new progressWin.ItemProgress(
      "chrome://zotero/skin/tick.png",
      statusTextPrefix + String(initialText || "")
    );
    const nativeSetStatusText = itemProgress.setText.bind(itemProgress);
    itemProgress.setText = text => nativeSetStatusText(
      statusTextPrefix + String(text == null ? "" : text)
    );

    if (capturedProgressWindow) {
      capturedProgressWindow.addEventListener("load", () => {
        try {
          const doc = capturedProgressWindow.document;
          const container = doc.getElementById("zotero-progress-text-box");
          if (!container) return;

          // Allow long status messages to wrap and resize the native progress
          // window vertically instead of clipping into a fixed-height panel.
          // Keep the headline, quoted publication title, and status text on one
          // shared vertical guide, inset safely from the window's left edge.
          const alignProgressText = () => {
            try {
              // One shared left guide for the headline, title, status row,
              // and controls. The page icon remains in its own fixed column,
              // with a reliable gap before the gray status text.
              container.style.paddingLeft = "20px";
              container.style.paddingRight = "20px";

              const textOf = node => String(
                node.getAttribute?.("value") ||
                node.getAttribute?.("label") ||
                node.textContent || ""
              ).trim();

              const textNodes = Array.from(container.querySelectorAll("label, description"))
                .filter(node => !node.closest("button"));

              for (const node of textNodes) {
                node.style.marginLeft = "0";
                node.style.marginInlineStart = "0";
                node.style.paddingLeft = "0";
                node.style.paddingInlineStart = "0";
                node.style.transform = "none";
                node.style.whiteSpace = node.id === "lgfetcher-item-title" ? "nowrap" : "normal";
                node.style.maxWidth = "430px";
                node.style.height = "auto";

                const row = node.parentElement;
                if (row && row !== container) {
                  row.style.marginLeft = "0";
                  row.style.marginInlineStart = "0";
                  row.style.paddingLeft = "0";
                  row.style.paddingInlineStart = "0";
                }
              }

              // Style only the native ItemProgress icon row. Do not turn all
              // parent rows into flex containers, which can shift the headline
              // and publication title unpredictably.
              for (const image of container.querySelectorAll("image, img")) {
                if (image.closest("button")) continue;
                const iconBox = image.parentElement;
                const statusRow = iconBox?.parentElement;

                image.removeAttribute("hidden");
                image.style.display = "block";
                image.style.width = "24px";
                image.style.minWidth = "24px";
                image.style.maxWidth = "24px";
                image.style.height = "24px";
                image.style.margin = "0";
                image.style.padding = "0";
                image.style.flex = "0 0 24px";

                if (iconBox) {
                  iconBox.style.display = "flex";
                  iconBox.style.width = "24px";
                  iconBox.style.minWidth = "24px";
                  iconBox.style.maxWidth = "24px";
                  iconBox.style.height = "24px";
                  iconBox.style.margin = "0 10px 0 0";
                  iconBox.style.padding = "0";
                  iconBox.style.flex = "0 0 24px";
                  iconBox.style.alignItems = "flex-start";
                  iconBox.style.justifyContent = "flex-start";
                }

                if (statusRow && statusRow !== container) {
                  statusRow.style.display = "flex";
                  statusRow.style.alignItems = "flex-start";
                  statusRow.style.justifyContent = "flex-start";
                  statusRow.style.marginLeft = "0";
                  statusRow.style.marginInlineStart = "0";
                  statusRow.style.paddingLeft = "0";
                  statusRow.style.paddingInlineStart = "0";
                  statusRow.style.columnGap = "0";
                  statusRow.style.width = "100%";
                  statusRow.setAttribute?.("align", "start");
                  statusRow.setAttribute?.("pack", "start");
                }
              }

              // Keep custom controls on the same left guide.
              for (const controls of container.querySelectorAll("#lgfetcher-search-controls, #lgfetcher-download-controls")) {
                controls.style.marginLeft = "0";
                controls.style.marginInlineStart = "0";
                controls.style.paddingLeft = "0";
                controls.style.paddingInlineStart = "0";
              }
            } catch (e) {}
          };

          const resizeForContent = () => {
            try {
              alignProgressText();
              for (const node of container.querySelectorAll("label, description")) {
                if (node.id === "lgfetcher-item-title") continue;
                node.style.whiteSpace = "normal";
                node.style.maxWidth = "430px";
                node.style.height = "auto";
              }
              capturedProgressWindow.sizeToContent();
              Zotero.ProgressWindowSet.tile(capturedProgressWindow);
            } catch (e) {}
          };
          resizeForContent();
          const contentObserver = new capturedProgressWindow.MutationObserver(() => {
            capturedProgressWindow.setTimeout(resizeForContent, 0);
          });
          contentObserver.observe(container, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["value", "label"]
          });
          capturedProgressWindow.addEventListener("unload", () => {
            try { contentObserver.disconnect(); } catch (e) {}
          }, { once: true });

          if (itemTitle && !doc.getElementById("lgfetcher-item-title")) {
            const titleLabel = doc.createXULElement("label");
            titleLabel.id = "lgfetcher-item-title";
            const displayTitle = itemTitle.length > 52
              ? itemTitle.slice(0, 49).trimEnd() + "..."
              : itemTitle;
            titleLabel.setAttribute("value", `“${displayTitle}”`);
            titleLabel.style.fontWeight = "400";
            // Match the headline's left inset instead of sitting farther left.
            titleLabel.style.margin = "8px 0 8px 0";
            titleLabel.style.marginLeft = "0";
            titleLabel.style.paddingLeft = "0";
            titleLabel.style.maxWidth = "430px";
            titleLabel.style.whiteSpace = "nowrap";
            titleLabel.style.overflow = "hidden";
            titleLabel.style.textOverflow = "ellipsis";

            // Keep Zotero's headline first, then show the selected title,
            // followed by the live progress row.
            const children = Array.from(container.children);
            const insertionPoint = children.length > 1 ? children[1] : null;
            container.insertBefore(titleLabel, insertionPoint);
          }

          if (!showDownloadControls) {
            if (doc.getElementById("lgfetcher-search-controls")) return;

            const searchControls = doc.createXULElement("hbox");
            searchControls.id = "lgfetcher-search-controls";
            searchControls.setAttribute("pack", "start");
            searchControls.setAttribute("align", "center");
            searchControls.style.marginTop = "8px";
            searchControls.style.marginLeft = "0";
            searchControls.style.paddingLeft = "0";

            const searchCancelButton = doc.createXULElement("button");
            searchCancelButton.setAttribute("label", "Cancel");
            searchCancelButton.style.width = "82px";
            searchCancelButton.style.minWidth = "82px";
            searchCancelButton.style.maxWidth = "82px";
            searchCancelButton.style.setProperty("text-align", "center", "important");
            searchCancelButton.style.setProperty("-moz-box-pack", "center", "important");
            searchCancelButton.style.setProperty("justify-content", "center", "important");
            searchCancelButton.style.setProperty("padding-inline", "8px", "important");
            searchCancelButton.style.setProperty("margin", "0", "important");
            searchCancelButton.style.setProperty("margin-left", "0", "important");
            searchCancelButton.style.setProperty("margin-inline-start", "0", "important");
            searchCancelButton.addEventListener("command", () => {
              downloadControl.cancel();
              try { itemProgress.setText("Cancelling search..."); } catch (e) {}
              try { progressWin.close(); } catch (e) { try { capturedProgressWindow.close(); } catch (e2) {} }
            });

            downloadControl.cancelButton = searchCancelButton;
            searchControls.appendChild(searchCancelButton);
            container.appendChild(searchControls);
            capturedProgressWindow.sizeToContent();
            Zotero.ProgressWindowSet.tile(capturedProgressWindow);
            return;
          }

          if (doc.getElementById("lgfetcher-download-controls")) return;

          const controls = doc.createXULElement("hbox");
          controls.id = "lgfetcher-download-controls";
          controls.setAttribute("pack", "start");
          controls.setAttribute("align", "center");
          controls.style.marginTop = "8px";
          controls.style.marginLeft = "0";
          controls.style.marginInlineStart = "0";
          controls.style.paddingLeft = "0";
          controls.style.paddingInlineStart = "0";
          controls.style.columnGap = "6px";
          controls.style.setProperty("-moz-box-pack", "start", "important");
          controls.style.setProperty("justify-content", "flex-start", "important");

          const pauseButton = doc.createXULElement("button");
          pauseButton.setAttribute("label", "Pause");
          pauseButton.style.width = "82px";
          pauseButton.style.minWidth = "82px";
          pauseButton.style.maxWidth = "82px";
          pauseButton.style.setProperty("text-align", "center", "important");
          pauseButton.style.setProperty("-moz-box-pack", "center", "important");
          pauseButton.style.setProperty("justify-content", "center", "important");
          pauseButton.style.setProperty("padding-inline", "8px", "important");
          pauseButton.style.setProperty("margin", "0", "important");
          pauseButton.style.setProperty("margin-left", "0", "important");
          pauseButton.style.setProperty("margin-inline-start", "0", "important");
          pauseButton.addEventListener("command", () => {
            downloadControl.paused = !downloadControl.paused;
            pauseButton.setAttribute("label", downloadControl.paused ? "Resume" : "Pause");
            itemProgress.setText(downloadControl.paused ? "Download paused" : "Resuming download...");
          });

          const cancelButton = doc.createXULElement("button");
          cancelButton.setAttribute("label", "Cancel");
          cancelButton.style.width = "82px";
          cancelButton.style.minWidth = "82px";
          cancelButton.style.maxWidth = "82px";
          cancelButton.style.setProperty("text-align", "center", "important");
          cancelButton.style.setProperty("-moz-box-pack", "center", "important");
          cancelButton.style.setProperty("justify-content", "center", "important");
          cancelButton.style.setProperty("padding-inline", "8px", "important");
          cancelButton.style.setProperty("margin", "0", "important");
          cancelButton.style.setProperty("margin-left", "0", "important");
          cancelButton.style.setProperty("margin-inline-start", "0", "important");
          cancelButton.addEventListener("command", () => {
            downloadControl.cancel();
            closeProgressUI();
          });

          downloadControl.pauseButton = pauseButton;
          downloadControl.cancelButton = cancelButton;
          controls.appendChild(pauseButton);
          controls.appendChild(cancelButton);
          container.appendChild(controls);
          capturedProgressWindow.sizeToContent();
          Zotero.ProgressWindowSet.tile(capturedProgressWindow);
        } catch (e) {
          Zotero.debug("LGFetcher control-button error: " + e.message);
        }
      }, { once: true });
    }
  }

  openProgressUI("Starting search...", false);

  function normalizeCellText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function absoluteURL(value, baseURL) {
    if (!value) return "";
    try { return new URL(value, baseURL).href; }
    catch (e) { return ""; }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  async function localizeCoverURL(url, mirrorBase) {
    if (!url) return "";
    const normalized = absoluteURL(url, mirrorBase);
    if (!normalized) return "";
    try {
      const req = await HTTP.request("GET", normalized, {
        timeout: 10000,
        responseType: "arraybuffer",
        followRedirects: true,
        errorDelayMax: 0,
        successCodes: false,
        headers: {
          "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
          ...(mirrorBase ? { "Referer": mirrorBase } : {})
        }
      });
      const status = Number(req.status || 0);
      if (status && (status < 200 || status >= 400)) return normalized;
      const buffer = req.response;
      if (!buffer || buffer.byteLength < 32) return normalized;
      const type = String(req.getResponseHeader?.("Content-Type") || "image/jpeg").split(";")[0].trim();
      if (!/^image\//i.test(type)) return normalized;
      return `data:${type};base64,${arrayBufferToBase64(buffer)}`;
    } catch (e) {
      Zotero.debug(`LGFetcher cover retrieval error for ${normalized}: ${e.message}`);
      return normalized;
    }
  }

  function extractCoverFromDocument(doc, baseURL) {
    const selectors = [
      "meta[property='og:image']",
      "meta[name='twitter:image']",
      "img[src*='cover']",
      "img[src*='covers']",
      "img[src*='book']",
      "img[data-src]",
      "img[data-original]",
      "img[data-lazy-src]",
      "img[data-cover]",
      "img[srcset]",
      "img"
    ];
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const srcset = node?.getAttribute?.("srcset") || "";
      const raw = node?.getAttribute?.("content") || node?.getAttribute?.("data-src") || node?.getAttribute?.("data-original") || node?.getAttribute?.("data-lazy-src") || node?.getAttribute?.("data-cover") || node?.getAttribute?.("src") || srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
      const url = absoluteURL(raw, baseURL);
      if (url && !/sprite|logo|favicon|pixel|blank/i.test(url)) return url;
    }
    return "";
  }

  function getColumnMap(row) {
    const table = row.closest("table");
    if (!table) return {};
    const headerRow = Array.from(table.querySelectorAll("tr")).find(tr => tr.querySelectorAll("th").length || /author|title|publisher|year|pages|extension|format/i.test(tr.textContent || ""));
    if (!headerRow) return {};
    const headers = Array.from(headerRow.querySelectorAll("th,td")).map(cell => normalizeCellText(cell.textContent).toLowerCase());
    const map = {};
    headers.forEach((header, index) => {
      if (/author|creator/.test(header)) map.author = index;
      else if (/title/.test(header)) map.title = index;
      else if (/publisher/.test(header)) map.publisher = index;
      else if (/year|date/.test(header)) map.year = index;
      else if (/pages|pagination/.test(header)) map.pages = index;
      else if (/extension|format|type|^ext\.?$/.test(header)) map.format = index;
      else if (/cover/.test(header)) map.cover = index;
    });
    return map;
  }

  function candidateFields(row) {
    const cells = Array.from(row.querySelectorAll("td"));
    const texts = cells.map(cell => normalizeCellText(cell.textContent));
    const map = getColumnMap(row);
    const at = key => Number.isInteger(map[key]) && map[key] < texts.length ? texts[map[key]] : "";
    const anchors = Array.from(row.querySelectorAll("a[href]"));
    const detailAnchor = anchors.find(a => /book\/index\.php|edition\.php|ads\.php|main\//i.test(a.getAttribute("href") || "")) || anchors[0];

    let title = at("title");
    if (!title) {
      const titleAnchor = anchors.find(a => {
        const t = normalizeCellText(a.textContent);
        return t.length > 3 && !/^(get|download|mirror|open|\d+)$/i.test(t);
      });
      title = normalizeCellText(titleAnchor?.textContent) || "";
    }

    let author = at("author");
    // Common LibGen table layout: ID, Author(s), Title, Publisher, Year, Pages, Language, Size, Extension, Mirrors
    if (!author && texts.length >= 8) author = texts[1] || "";
    if (!title && texts.length >= 8) title = texts[2] || "";
    let publisher = at("publisher");
    if (!publisher && texts.length >= 8) publisher = texts[3] || "";
    let year = at("year");
    if (!year && texts.length >= 8) year = texts[4] || "";
    let pages = at("pages");
    if (!pages && texts.length >= 8) pages = texts[5] || "";
    let format = at("format");
    if (!format && texts.length >= 9) format = texts[8] || "";

    return { cells, texts, map, anchors, detailAnchor, title, author, publisher, year, pages, format };
  }

  function extractCandidateMetadata(candidate, mirror) {
    const fields = candidateFields(candidate.row);
    const rowText = normalizeCellText(candidate.row.textContent);
    const yearMatch = fields.year.match(/\b(18|19|20)\d{2}\b/) || rowText.match(/\b(18|19|20)\d{2}\b/);
    const formatMatch = fields.format.match(/\b(PDF|EPUB|DJVU|MOBI|AZW3)\b/i) || rowText.match(/\b(PDF|EPUB|DJVU|MOBI|AZW3)\b/i);
    let pages = parsePageCount(fields.pages, true) || candidate.pageCount || 0;

    const rowImages = Array.from(candidate.row.querySelectorAll("img"));
    const imageValue = img => {
      const attrs = [
        "data-src", "data-original", "data-lazy-src", "data-url", "data-cover",
        "src", "srcset"
      ];
      for (const attr of attrs) {
        let value = img.getAttribute(attr) || "";
        if (attr === "srcset" && value) value = value.split(",")[0]?.trim().split(/\s+/)[0] || "";
        if (value && !/^data:image\/svg\+xml/i.test(value)) return value;
      }
      const style = img.getAttribute("style") || "";
      const bg = style.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
      return bg ? bg[1] : "";
    };
    const bestImage = rowImages.find(img => /cover|book|upload|covers|content/i.test(imageValue(img))) || rowImages.find(img => imageValue(img));
    let cover = absoluteURL(imageValue(bestImage), mirror);
    if (!cover) {
      const coverCell = Number.isInteger(fields.map.cover) ? fields.cells[fields.map.cover] : fields.cells[0];
      const styled = coverCell?.querySelector?.("[style*='background-image']");
      const style = styled?.getAttribute?.("style") || "";
      const bg = style.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
      if (bg) cover = absoluteURL(bg[1], mirror);
    }
    const landingURL = absoluteURL(fields.detailAnchor?.getAttribute("href") || candidate.anchors?.[0]?.getAttribute("href") || "", mirror);

    return {
      author: fields.author || "Unknown",
      title: fields.title || "Untitled",
      publisher: fields.publisher || "Unknown",
      year: yearMatch ? yearMatch[0] : "Unknown",
      format: formatMatch ? formatMatch[1].toUpperCase() : (candidate.isPdf ? "PDF" : "Unknown"),
      pages: pages > 0 ? String(pages) : "Unknown",
      mirror: mirror.replace(/^https?:\/\//, ""),
      mirrorBase: mirror,
      cover,
      landingURL,
      candidate
    };
  }

  async function enrichOption(option) {
    try {
      if (option.landingURL) {
        const html = await fetchTextWithTimeout(option.landingURL, {}, 5000, downloadControl);
        const doc = new DOMParser().parseFromString(html, "text/html");
        if (!option.cover) option.cover = extractCoverFromDocument(doc, option.landingURL);

        const metaTitle = normalizeCellText(doc.querySelector("meta[property='og:title']")?.getAttribute("content"));
        if (metaTitle && (!option.title || option.title === "Untitled")) option.title = metaTitle;

        const pageText = normalizeCellText(doc.body?.textContent || "");
        if (option.pages === "Unknown") {
          const pageMatch = pageText.match(/\b(?:pages?|pagination)\s*[:\-]?\s*(\d{1,4})\b/i) || pageText.match(/\b(\d{1,4})\s*pages?\b/i);
          if (pageMatch) option.pages = pageMatch[1];
        }
      }
      // Convert the remote image to a data URL. This avoids image hotlink,
      // referrer, mixed-content, and .onion-host failures in the overlay.
      if (option.cover) option.cover = await localizeCoverURL(option.cover, option.mirrorBase);
    } catch (e) {
      Zotero.debug("LGFetcher option enrichment error: " + e.message);
    }
    return option;
  }

  function optionKey(option) {
    return [option.title, option.author, option.year, option.format, option.pages]
      .map(v => normalizeCellText(v).toLowerCase())
      .join("|");
  }

  async function chooseCandidate(options, itemTitle) {
    if (!options.length) return null;

    // Close the always-on-top search progress panel before showing the in-window chooser.
    try { capturedProgressWindow?.close(); } catch (e) {}
    capturedProgressWindow = null;
    progressWin = null;
    itemProgress = null;

    const doc = window.document;
    const HTML_NS = "http://www.w3.org/1999/xhtml";
    const existing = doc.getElementById("lgfetcher-options-overlay");
    if (existing) existing.remove();

    return await new Promise(resolve => {
      let settled = false;
      let selectedIndex = -1;

      const make = (tag, className = "", text = "") => {
        const el = doc.createElementNS(HTML_NS, tag);
        if (className) el.className = className;
        if (text) el.textContent = text;
        return el;
      };

      const overlay = make("div");
      overlay.id = "lgfetcher-options-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.style.cssText = [
        "position:fixed", "inset:0", "z-index:2147483647",
        "display:flex", "align-items:center", "justify-content:center",
        "padding:24px", "box-sizing:border-box",
        "background:rgba(0,0,0,.42)", "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
      ].join(";");

      const panel = make("div");
      panel.style.cssText = [
        "width:min(1180px,calc(100vw - 48px))", "max-height:calc(100vh - 48px)",
        "display:flex", "flex-direction:column", "box-sizing:border-box",
        "padding:20px", "border:1px solid rgba(127,127,127,.55)", "border-radius:14px",
        "background:Canvas", "color:CanvasText", "box-shadow:0 18px 70px rgba(0,0,0,.38)"
      ].join(";");

      const title = make("h1", "", "Choose a copy to download");
      title.style.cssText = "margin:0 0 5px;font-size:22px;line-height:1.2";
      const subtitle = make("p", "", `Top ${options.length} matches for “${itemTitle || "selected item"}”. Select one copy, then click Download.`);
      subtitle.style.cssText = "margin:0 0 14px;color:GrayText;font-size:13px";

      const tableWrap = make("div");
      tableWrap.style.cssText = "overflow:auto;border:1px solid rgba(127,127,127,.5);border-radius:9px;min-height:180px";
      const grid = make("div");
      grid.style.cssText = "display:grid;grid-template-columns:38px 62px minmax(120px,1fr) minmax(220px,2fr) minmax(120px,1fr) 58px 60px 62px 84px;min-width:1040px";

      const headers = ["", "Cover", "Author", "Title", "Publisher", "Year", "Pages", "Format", "Mirror"];
      for (const header of headers) {
        const cell = make("div", "", header);
        cell.style.cssText = "position:sticky;top:0;z-index:2;padding:9px 8px;font-size:12px;font-weight:700;background:Canvas;border-bottom:1px solid rgba(127,127,127,.45)";
        grid.appendChild(cell);
      }

      const rows = [];
      options.forEach((option, index) => {
        const rowCells = [];
        const addCell = child => {
          const cell = make("div");
          cell.style.cssText = "padding:9px 8px;font-size:12px;border-bottom:1px solid rgba(127,127,127,.28);display:flex;align-items:center;overflow-wrap:anywhere;min-height:66px";
          if (typeof child === "string") cell.textContent = child || "—";
          else if (child) cell.appendChild(child);
          grid.appendChild(cell);
          rowCells.push(cell);
        };

        const radio = make("input");
        radio.type = "radio";
        radio.name = "lgfetcher-copy-choice";
        radio.value = String(index);
        radio.setAttribute("aria-label", `Select ${option.title || "copy"}`);
        addCell(radio);

        let coverNode;
        if (option.cover) {
          coverNode = make("img");
          coverNode.src = option.cover;
          coverNode.alt = "Cover";
          coverNode.style.cssText = "width:44px;height:60px;object-fit:contain;border-radius:3px;background:rgba(127,127,127,.08)";
          coverNode.addEventListener("error", () => {
            const fallback = make("div", "", "No cover");
            fallback.style.cssText = "width:44px;height:60px;display:grid;place-items:center;border:1px solid rgba(127,127,127,.45);border-radius:3px;color:GrayText;font-size:9px;text-align:center";
            coverNode.replaceWith(fallback);
          }, { once: true });
        } else {
          coverNode = make("div", "", "No cover");
          coverNode.style.cssText = "width:44px;height:60px;display:grid;place-items:center;border:1px solid rgba(127,127,127,.45);border-radius:3px;color:GrayText;font-size:9px;text-align:center";
        }
        addCell(coverNode);
        addCell(option.author || "—");
        addCell(option.title || "—");
        rowCells[rowCells.length - 1].style.fontWeight = "600";
        addCell(option.publisher || "—");
        addCell(option.year || "—");
        addCell(option.pages || "—");
        addCell(option.format || "—");
        addCell(option.mirror || "—");

        const selectRow = () => {
          radio.checked = true;
          selectedIndex = index;
          downloadButton.disabled = false;
          rows.forEach(cells => cells.forEach(cell => cell.style.background = ""));
          rowCells.forEach(cell => cell.style.background = "color-mix(in srgb, Highlight 14%, transparent)");
        };
        radio.addEventListener("change", selectRow);
        rowCells.forEach(cell => cell.addEventListener("click", event => {
          if (event.target !== radio) selectRow();
        }));
        rowCells.forEach(cell => cell.addEventListener("dblclick", () => {
          selectRow();
          finish(options[index]);
        }));
        rows.push(rowCells);
      });

      tableWrap.appendChild(grid);

      const buttonBar = make("div");
      buttonBar.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:15px";
      const searchAgainButton = make("button", "", "Search Again");
      searchAgainButton.type = "button";
      searchAgainButton.style.cssText = "min-width:112px;height:34px;padding:0 15px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;line-height:1;text-align:center";
      const cancelButton = make("button", "", "Cancel");
      cancelButton.type = "button";
      cancelButton.style.cssText = "min-width:92px;height:34px;padding:0 15px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;line-height:1;text-align:center";
      const downloadButton = make("button", "", "Download");
      downloadButton.type = "button";
      downloadButton.disabled = true;
      downloadButton.style.cssText = "min-width:92px;height:34px;padding:0 15px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;line-height:1;text-align:center";
      buttonBar.appendChild(searchAgainButton);
      buttonBar.appendChild(cancelButton);
      buttonBar.appendChild(downloadButton);

      panel.appendChild(title);
      panel.appendChild(subtitle);
      panel.appendChild(tableWrap);
      panel.appendChild(buttonBar);
      overlay.appendChild(panel);
      doc.documentElement.appendChild(overlay);

      const previousOverflow = doc.documentElement.style.overflow;
      doc.documentElement.style.overflow = "hidden";

      const onKeyDown = event => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        } else if (event.key === "Enter" && selectedIndex >= 0) {
          event.preventDefault();
          finish(options[selectedIndex]);
        }
      };

      function finish(result) {
        if (settled) return;
        settled = true;
        window.removeEventListener("keydown", onKeyDown, true);
        doc.documentElement.style.overflow = previousOverflow;
        try { overlay.remove(); } catch (e) {}
        resolve(result || null);
      }

      searchAgainButton.addEventListener("click", () => finish({ searchAgain: true }));
      cancelButton.addEventListener("click", () => finish(null));
      downloadButton.addEventListener("click", () => {
        if (selectedIndex >= 0) finish(options[selectedIndex]);
      });
      overlay.addEventListener("click", event => {
        if (event.target === overlay) finish(null);
      });
      panel.addEventListener("click", event => event.stopPropagation());
      window.addEventListener("keydown", onKeyDown, true);
      try { cancelButton.focus(); } catch (e) {}
    });
  }

  let results = [];

  for (let item of items) {
    if (downloadControl.cancelled) break;
    if (!item.isRegularItem()) continue;

    let rawTitle = item.getField('title') || 'Untitled';
    let targetPublisher = item.getField('publisher') || '';
    
    // --- ITEM TYPE DISCRIMINATION ---
    let isBook = ['book', 'bookSection', 'monograph', 'thesis'].includes(item.itemType);
    let isArticle = ['journalArticle', 'conferencePaper', 'magazineArticle', 'newspaperArticle', 'article'].includes(item.itemType);
    let itemLabel = isBook ? "monograph" : (isArticle ? "article" : "document");

    // Extract page metadata using item-type context
    let rawZoteroPages = item.getField('numPages', true, true) || item.getField('pages', true, true) || '';
    let zoteroPageCount = parsePageCount(rawZoteroPages, isBook);

    itemProgress.setText(`Searching (${itemLabel})...`);

    // Clean main title
    let cleanTitle = rawTitle.replace(/[\u2010-\u2015]/g, '-').replace(/[^\w\s-:]/gi, ' ');
    let mainTitle = cleanTitle.split(/[:\?]/)[0].trim();

    // Skip if PDF/EPUB attachment already exists
    let hasAttachment = item.getAttachments().map(id => Zotero.Items.get(id)).some(att => {
      let path = (att.attachmentPath || '').toLowerCase();
      return att.isPDFAttachment() || ['.epub', '.djvu', '.mobi'].some(ext => path.endsWith(ext));
    });

    if (hasAttachment) {
      results.push(`Skipped "${rawTitle}": Attachment (PDF/EPUB) already exists.`);
      continue;
    }

    let creators = item.getCreators();
    let authorLastName = creators.length > 0 ? (creators[0].lastName || creators[0].name || '') : '';
    
    // --- EXTRACT METADATA FOR FILENAME NAMING ---
    let rawDate = '';
    try { rawDate = item.getField('date', true, true) || ''; } catch (e) {}
    let yearMatch = rawDate.match(/\b(18|19|20)\d{2}\b/);
    let itemYear = yearMatch ? yearMatch[0] : 'n.d.';

    let shortTitleField = '';
    try { shortTitleField = item.getField('shortTitle', true, true) || ''; } catch (e) {}
    let targetShortTitle = shortTitleField || mainTitle;
    if (targetShortTitle.length > 50) {
      targetShortTitle = targetShortTitle.substring(0, 50).trim();
    }

    let cleanAuthorForFile = sanitizeFilename(authorLastName || 'Unknown');
    let cleanYearForFile = sanitizeFilename(itemYear);
    let cleanShortTitleForFile = sanitizeFilename(targetShortTitle);

    // --- ITEM-TYPE TAILORED QUERY PIPELINE ---
    let queries = [];

    if (isArticle) {
      // 1. DOI takes primary priority for journal articles
      let rawDoi = item.getField('DOI', true, true) || '';
      if (rawDoi.trim()) {
        queries.push(rawDoi.trim());
      }
    } else if (isBook) {
      // 1. ISBN takes primary priority for monographs
      let rawIsbn = item.getField('ISBN', true, true) || '';
      let isbns = rawIsbn.split(/[\s,;]+/);
      for (let candidate of isbns) {
        let clean = candidate.replace(/[^0-9X]/gi, '');
        if (clean.length === 10 || clean.length === 13) {
          queries.push(clean);
        }
      }
    }

    // Keep search strings limited to fields LibGen indexes reliably.
    // Publisher and year remain ranking signals, but are not sent as title-search terms.
    const fullSearchTitle = cleanTitle.trim();
    if (authorLastName && fullSearchTitle) {
      queries.push(`${authorLastName} ${fullSearchTitle}`);
    }

    if (fullSearchTitle) queries.push(fullSearchTitle);

    // Conservative sanitized fallbacks for mirrors with stricter tokenization.
    const simplifiedMainTitle = rawTitle
      .split(/[:?]/)[0]
      .replace(/[\u2010-\u2015]/g, " ")
      .replace(/[\'"\u2018\u2019\u201c\u201d]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const simplifiedAuthor = String(authorLastName || "")
      .replace(/[\'"\u2018\u2019\u201c\u201d\u2010-\u2015]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (simplifiedMainTitle && simplifiedAuthor) queries.push(`${simplifiedMainTitle} ${simplifiedAuthor}`);
    if (simplifiedMainTitle) queries.push(simplifiedMainTitle);

    queries = [...new Set(queries.filter(Boolean))];

    let success = false;
    let displayOptions = [];
    let selectedOption = null;
    let anyOptionsFound = false;

    // Search mirrors sequentially. As soon as one mirror produces viable
    // matches, present them immediately. "Search Again" resumes at the next
    // configured mirror instead of repeating every query against every site.
    mirrorLoop:
    for (let mirrorIndex = 0; mirrorIndex < MIRRORS.length; mirrorIndex++) {
      if (downloadControl.cancelled) break;
      const mirror = MIRRORS[mirrorIndex];
      const domainLabel = mirror.replace(/^https?:\/\//, "");
      const optionMap = new Map();

      for (let queryStr of queries) {
        if (downloadControl.cancelled) break;
        await downloadControl.waitIfPaused();
        const encodedQuery = encodeURIComponent(queryStr);
        itemProgress.setText(`Querying ${domainLabel}...`);

        // The first URL matches the current libgen.li-style interface. The
        // remaining URLs retain compatibility with older mirror layouts.
        const searchURLs = [
          `${mirror}/index.php?req=${encodedQuery}&res=25&cover=on&covers=on&showcovers=1`,
          `${mirror}/index.php?req=${encodedQuery}&open=0&res=25&view=detailed&phrase=1&column=def&cover=on&covers=on&showcovers=1`
        ];

        for (const searchUrl of searchURLs) {
          if (downloadControl.cancelled) break;
          try {
            const htmlText = await fetchTextWithTimeout(searchUrl, {}, 4000, downloadControl);
            const doc = new DOMParser().parseFromString(htmlText, "text/html");
            const lowerHtml = htmlText.toLowerCase();
            if (lowerHtml.includes("no records found") || lowerHtml.includes("0 files found")) continue;

            const resultRows = Array.from(doc.querySelectorAll("table.table tr, table.c tr, table.data tr, table tr"))
              .filter(tr => tr.querySelectorAll("td").length >= 4);

            for (const row of resultRows.slice(0, 60)) {
              // Modern LibGen result rows often use numbered mirror links and
              // no longer expose only ads.php/get.php-style anchors.
              const anchors = Array.from(row.querySelectorAll("a[href]"))
                .filter(a => {
                  const href = a.getAttribute("href") || "";
                  return href && !/^javascript:/i.test(href) && !href.startsWith("#");
                });
              if (!anchors.length) continue;

              const matchResult = verifyCandidateMatch(fullSearchTitle, authorLastName, targetPublisher, itemYear, zoteroPageCount, queryStr, isBook, isArticle, row);
              if (!matchResult.isValid) continue;

              const candidate = {
                anchors,
                score: matchResult.score,
                pageCount: matchResult.pageCount,
                isPdf: matchResult.isPdf,
                row,
                fields: matchResult.fields
              };
              const option = extractCandidateMetadata(candidate, mirror);
              const key = optionKey(option) || option.landingURL;
              const existing = optionMap.get(key);
              if (!existing || candidate.score > existing.candidate.score) optionMap.set(key, option);
            }

            // Stop trying alternate URL layouts for this query once this
            // mirror has returned viable records.
            if (optionMap.size) break;
          } catch (err) {
            Zotero.debug(`LibGen search error (${searchUrl}): ${err.message}`);
          }
        }

        // A strong identifier or metadata query has already yielded useful
        // results; avoid slower fallback queries on the same mirror.
        if (optionMap.size) break;
      }

      if (!optionMap.size) continue;
      anyOptionsFound = true;
      displayOptions = Array.from(optionMap.values())
        .sort((a, b) => {
          if (a.candidate.isPdf !== b.candidate.isPdf) return b.candidate.isPdf ? 1 : -1;
          return b.candidate.score - a.candidate.score;
        })
        .slice(0, 10);

      for (const option of displayOptions) {
        if (downloadControl.cancelled) break;
        itemProgress.setText("Preparing download options...");
        await enrichOption(option);
      }

      const choice = await chooseCandidate(displayOptions, rawTitle);
      if (!choice) {
        downloadControl.cancelled = true;
        break;
      }
      if (choice.searchAgain) {
        // Reopen a search progress panel and continue with the next mirror.
        openProgressUI(`Continuing with the next mirror...`, false);
        continue;
      }
      selectedOption = choice;
      // Open the download progress window only after the chooser event has
      // fully completed and the overlay has been removed. Opening a native
      // progress window from inside the chooser click handler could be lost
      // on macOS, leaving the download running with no visible progress UI.
      openProgressUI("Preparing selected download...", true, targetShortTitle || rawTitle);
      break mirrorLoop;
    }

    if (selectedOption) {
        const candidateItem = selectedOption.candidate;
        const mirror = selectedOption.mirrorBase;
        const domainLabel = selectedOption.mirror;
        let linkData = null;

        const resolutionTargets = [
          selectedOption.landingURL,
          ...candidateItem.anchors.map(anchor => absoluteURL(anchor.getAttribute("href"), mirror))
        ].filter(Boolean);

        for (const landingUrl of [...new Set(resolutionTargets)]) {
          itemProgress.setText("Resolving LibGen download link...");
          linkData = await resolveLibGenKeyUrl(landingUrl, mirror, 0, new Set(), downloadControl);
          if (linkData && linkData.candidateUrls.length) break;
        }

        if (!linkData || !linkData.candidateUrls.length) {
          results.push(`The selected LibGen record did not expose a working download link for "${rawTitle}".`);
        } else {
          const downloadedFile = await streamToFileWithProgress(linkData.candidateUrls, linkData.refererUrl, itemProgress, downloadControl, candidateItem.format);
          if (!downloadedFile) {
            results.push(`The selected file could not be downloaded for "${rawTitle}".${downloadControl.lastDownloadError ? `\n\n${downloadControl.lastDownloadError}` : ""}`);
          } else {
            let accepted = true;
            if (downloadedFile.ext === "pdf") {
              itemProgress.setText("Verifying PDF structure...");
              const actualPdfPages = getPdfActualPageCount(downloadedFile.path);
              const fileSizeMb = downloadedFile.fileObj.fileSize / (1024 * 1024);

              if (isBook) {
                const isBookReview = actualPdfPages > 0 && actualPdfPages <= 10;
                const minPagesRequired = zoteroPageCount > 0 ? Math.floor(zoteroPageCount * 0.5) : 50;
                const failsMinPages = actualPdfPages > 0 && actualPdfPages < minPagesRequired;
                const failsSizeHeuristic = actualPdfPages === 0 && zoteroPageCount >= 150 && fileSizeMb < 1.0;
                if (isBookReview || failsMinPages || failsSizeHeuristic) {
                  accepted = false;
                  results.push(`The selected PDF was rejected as a short review, excerpt, or incomplete copy for "${rawTitle}".`);
                }
              } else if (fileSizeMb < 0.005) {
                accepted = false;
                results.push(`The selected file appeared to be empty or corrupt for "${rawTitle}".`);
              }
            }

            if (accepted) {
              const formattedFilename = `${cleanAuthorForFile} - ${cleanYearForFile} - ${cleanShortTitleForFile}.${downloadedFile.ext}`;
              try { downloadedFile.fileObj.moveTo(null, formattedFilename); } catch (renameErr) {
                Zotero.debug("File rename error: " + renameErr.message);
              }

              itemProgress.setText("Attaching to Zotero...");
              try {
                await Zotero.Attachments.importFromFile({
                  file: downloadedFile.fileObj.path,
                  parentItemID: item.id,
                  title: formattedFilename
                });
                results.push(`SUCCESS (${domainLabel}): Attached "${formattedFilename}" for "${rawTitle}".`);
                success = true;
              } catch (attachErr) {
                Zotero.debug("Attachment error: " + attachErr.message);
                results.push(`Downloaded file but failed to attach: ${attachErr.message}`);
              }
            }
            try { downloadedFile.fileObj.remove(false); } catch (e) {}
          }
        }
    }

    if (!success && !downloadControl.cancelled && !anyOptionsFound) {
      let reqText = isBook ? (zoteroPageCount > 0 ? `~${zoteroPageCount} pages` : "50+ pages") : "full-text";
      results.push(`No matching ${itemLabel} (${reqText}) found on LibGen for "${rawTitle}".`);
    }
  }

  if (downloadControl.cancelled) {
    // Cancellation is intentionally silent: close the progress window and
    // return no result text so the menu wrapper does not open an alert.
    try { progressWin.close(); } catch (e) {}
    return "";
  }

  itemProgress.setText("Process complete!");
  try {
    if (capturedProgressWindow && !capturedProgressWindow.closed) {
      const doc = capturedProgressWindow.document;
      const existingControls = doc.getElementById("lgfetcher-download-controls");
      if (existingControls) existingControls.remove();
      const container = doc.getElementById("zotero-progress-text-box");
      if (container) {
        const closeRow = doc.createXULElement("hbox");
        closeRow.id = "lgfetcher-complete-controls";
        closeRow.setAttribute("pack", "end");
        closeRow.setAttribute("align", "center");
        closeRow.style.marginTop = "8px";
        const closeButton = doc.createXULElement("button");
        closeButton.setAttribute("label", "Close");
        closeButton.style.width = "82px";
        closeButton.style.minWidth = "82px";
        closeButton.style.maxWidth = "82px";
        closeButton.style.setProperty("text-align", "center", "important");
        closeButton.style.setProperty("-moz-box-pack", "center", "important");
        closeButton.style.setProperty("justify-content", "center", "important");
        closeButton.addEventListener("command", () => {
          try { progressWin.close(); } catch (e) { try { capturedProgressWindow.close(); } catch (e2) {} }
        });
        closeRow.appendChild(closeButton);
        container.appendChild(closeRow);
        capturedProgressWindow.sizeToContent();
        Zotero.ProgressWindowSet.tile(capturedProgressWindow);
      }
    }
  } catch (e) {
    Zotero.debug("LGFetcher completion-button error: " + e.message);
  }
  setTimeout(() => {
    try { closeProgressUI(); } catch (e) {}
  }, 5000);

  return results.join("\n\n");

  /**
   * Removes OS-restricted characters for filenames
   */
  function sanitizeFilename(str) {
    if (!str) return 'Unknown';
    return str.replace(/[\/\\:\*\?"<>\|]/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Multi-strategy inspection of binary PDF structure for page counts
   */
  function getPdfActualPageCount(filePath) {
    try {
      let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(filePath);
      
      let fileStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
      fileStream.init(file, 0x01, 0444, 0);

      let binaryStream = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryInputStream);
      binaryStream.setInputStream(fileStream);

      let bytes = binaryStream.readBytes(fileStream.available());
      binaryStream.close();
      fileStream.close();

      let counts = [];

      // Strategy 1: Match /Count N in catalog page trees
      let countMatches = bytes.match(/\/Count\s+(\d+)/gi) || [];
      for (let m of countMatches) {
        let n = parseInt(m.replace(/[^\d]/g, ''), 10);
        if (!isNaN(n) && n > 0) counts.push(n);
      }

      // Strategy 2: Match /N N (Linearized PDF page count header)
      let linMatches = bytes.match(/\/Linearized\s+[\s\S]{1,100}?\/N\s+(\d+)/gi) || [];
      for (let m of linMatches) {
        let nMatch = m.match(/\/N\s+(\d+)/i);
        if (nMatch) counts.push(parseInt(nMatch[1], 10));
      }

      // Strategy 3: Uncompressed /Type /Page objects
      let pageObjMatches = bytes.match(/\/Type\s*\/Page\b(?![sS])/g) || [];
      if (pageObjMatches.length > 0) counts.push(pageObjMatches.length);

      if (counts.length > 0) {
        let detected = Math.max(...counts);
        Zotero.debug(`PDF Page Inspection successful: Detected ${detected} pages.`);
        return detected;
      }
    } catch (e) {
      Zotero.debug("PDF Page Count inspection error: " + e.message);
    }
    return 0;
  }

  /**
   * Dynamically parses LibGen table rows using itemType context
   */
  function verifyCandidateMatch(targetTitle, targetAuthor, targetPublisher, targetYear, zoteroPageCount, queryStr, isBook, isArticle, row) {
    const fields = candidateFields(row);
    if (fields.cells.length < 4) return { isValid: false };

    const normalize = value => normalizeCellText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const tokens = value => normalize(value).split(/\s+/).filter(token => token.length > 2 && !["the","and","for","with","from","into","una","uno","gli","della","delle"].includes(token));
    const similarity = (a, b) => {
      const aa = new Set(tokens(a));
      const bb = new Set(tokens(b));
      if (!aa.size || !bb.size) return 0;
      let common = 0;
      for (const token of aa) if (bb.has(token)) common++;
      return common / Math.max(aa.size, bb.size);
    };

    const rowText = normalizeCellText(row.textContent).toLowerCase();
    const candidateTitle = fields.title || "";
    const candidateAuthor = fields.author || "";
    const candidatePublisher = fields.publisher || "";
    const candidateYearMatch = fields.year.match(/\b(18|19|20)\d{2}\b/);
    const candidateYear = candidateYearMatch ? candidateYearMatch[0] : "";
    const candidatePages = parsePageCount(fields.pages, isBook);
    const formatText = `${fields.format} ${rowText}`;
    const detectedFormat = (formatText.match(/\b(PDF|EPUB|DJVU|MOBI)\b/i) || [])[1]?.toUpperCase() || "";
    const isPdf = detectedFormat === "PDF";
    if (!detectedFormat || !ENABLED_FORMATS.has(detectedFormat)) return { isValid: false };

    const isIdentifierQuery = /^\d{9,13}[0-9X]?$/i.test(queryStr) || /^10\.\d+\//i.test(queryStr);
    const titleScore = similarity(targetTitle, candidateTitle || rowText);
    const authorNorm = normalize(targetAuthor);
    const authorMatch = !authorNorm || normalize(candidateAuthor).includes(authorNorm) || rowText.includes(authorNorm);
    const publisherTokens = tokens(targetPublisher);
    const publisherMatch = !publisherTokens.length || publisherTokens.some(token => normalize(candidatePublisher).includes(token));
    const yearMatch = !targetYear || targetYear === "n.d." || !candidateYear || Math.abs(Number(candidateYear) - Number(targetYear)) <= 2;

    // Strong title match is mandatory unless an ISBN/DOI query returned the row.
    if (!isIdentifierQuery && titleScore < 0.58) return { isValid: false };
    // For ordinary title queries, require the Zotero author surname when available.
    if (!isIdentifierQuery && targetAuthor && !authorMatch) return { isValid: false };
    // Reject obvious book reviews and excerpts.
    if (isBook && /book review|review of|reviewed by|review essay|critical review|symposium|reviews in history/i.test(rowText)) return { isValid: false };
    // When both page counts are known, stay within the requested ±25-page range.
    if (isBook && zoteroPageCount > 0 && candidatePages > 0 && Math.abs(candidatePages - zoteroPageCount) > 25) return { isValid: false };

    let score = Math.round(titleScore * 1000);
    if (authorMatch) score += 350;
    if (publisherMatch) score += 120;
    if (yearMatch) score += 100;
    if (isIdentifierQuery) score += 500;
    if (isPdf) score += 80;
    if (zoteroPageCount > 0 && candidatePages > 0) score += Math.max(0, 250 - Math.abs(candidatePages - zoteroPageCount) * 10);

    return { isValid: true, score, pageCount: candidatePages, isPdf, fields };
  }

  /**
   * Handles page count ranges ("120-125"), libgen slash notation, and volume pagination
   */
  function parsePageCount(str, isBook) {
    if (!str) return 0;

    let rangeMatch = str.match(/(\d+)\s*[\u2010-\u2015\-]\s*(\d+)/);
    if (rangeMatch) {
      let p1 = parseInt(rangeMatch[1], 10);
      let p2 = parseInt(rangeMatch[2], 10);
      if (p2 >= p1 && (p2 - p1) < 500) {
        return (p2 - p1 + 1);
      }
    }

    let nums = str.match(/\d+/g);
    if (nums && nums.length > 0) {
      let parsedNums = nums.map(n => parseInt(n, 10));
      let val = Math.max(...parsedNums);
      
      // Ignore high continuous volume starting page numbers (e.g. page 5434) for non-books
      if (!isBook && val > 500) return 0; 
      return val;
    }

    return 0;
  }

  /**
   * Fetch wrapper with AbortSignal termination on timeout
   */
  async function fetchTextWithTimeout(url, options = {}, timeoutMs = 4000, control = null) {
    if (control) await control.waitIfPaused();
    try {
      if (HTTP?.request) {
        const req = await HTTP.request("GET", url, {
          timeout: timeoutMs,
          responseType: "text",
          headers: options.headers || {},
          followRedirects: true,
          errorDelayMax: 0,
          successCodes: false
        });
        const status = Number(req.status || 0);
        if (status && (status < 200 || status >= 400)) throw new Error(`HTTP status ${status}`);
        return req.responseText || (typeof req.response === "string" ? req.response : "");
      }
      const controller = new AbortController();
      if (control) control.activeAbortController = controller;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP status ${response.status}`);
        return await response.text();
      } finally {
        clearTimeout(timer);
        if (control?.activeAbortController === controller) control.activeAbortController = null;
      }
    } catch (err) {
      if (control?.cancelled) throw new Error("LGFETCHER_CANCELLED");
      throw err;
    }
  }

  /**
   * Finds and extracts a direct keyed download URL from a configured mirror
   */
  async function resolveLibGenKeyUrl(currentUrl, baseMirror, depth = 0, visited = new Set(), downloadControl = null) {
    if (downloadControl) await downloadControl.waitIfPaused();
    currentUrl = absoluteURL(currentUrl, baseMirror);
    if (depth > 3 || !currentUrl || visited.has(currentUrl)) return null;
    visited.add(currentUrl);

    try {
      // Preserve the older successful route: a keyed get.php URL is already
      // the preferred binary endpoint and must not be replaced or reordered.
      if (/get\.php/i.test(currentUrl) && /[?&]key=/i.test(currentUrl)) {
        return { candidateUrls: [currentUrl], refererUrl: currentUrl };
      }

      // A genuine direct document URL can be used as-is.
      if (/\.(?:pdf|epub)(?:$|[?#])/i.test(currentUrl)) {
        return { candidateUrls: [currentUrl], refererUrl: currentUrl };
      }

      const html = await fetchTextWithTimeout(currentUrl, {
        redirect: "follow",
        credentials: "include"
      }, 7000, downloadControl);
      const doc = new DOMParser().parseFromString(html, "text/html");
      const anchors = Array.from(doc.querySelectorAll("a[href]"));

      // Keyed get.php links are the route used by the older working build.
      const keyed = [];
      for (const anchor of anchors) {
        const href = anchor.getAttribute("href") || "";
        let resolved = "";
        try { resolved = new URL(href, currentUrl).href; } catch (e) { continue; }
        if (/get\.php/i.test(resolved) && /[?&]key=/i.test(resolved)) keyed.push(resolved);
      }
      if (keyed.length) {
        return { candidateUrls: [...new Set(keyed)], refererUrl: currentUrl };
      }

      // Follow only the same narrow family of LibGen hand-off pages used by
      // the earlier downloader. Avoid speculative IPFS/cloudflare candidates.
      for (const anchor of anchors) {
        const href = anchor.getAttribute("href") || "";
        if (!/ads\.php|get\.php|edition\.php|book\/index\.php|main\//i.test(href)) continue;
        let nextUrl = "";
        try { nextUrl = new URL(href, currentUrl).href; } catch (e) { continue; }
        if (visited.has(nextUrl)) continue;
        const resolved = await resolveLibGenKeyUrl(nextUrl, baseMirror, depth + 1, visited, downloadControl);
        if (resolved?.candidateUrls?.length) return resolved;
      }
    } catch (e) {
      Zotero.debug(`LGFetcher strict resolver error for ${currentUrl}: ${e.message}`);
    }
    return null;
  }

  /**
   * Streams the selected PDF/EPUB to a temporary file while reporting real
   * byte progress. This intentionally follows the older successful transport
   * path instead of cycling through speculative alternate servers.
   */
  async function streamToFileWithProgress(urls, refererUrl, itemProgress, downloadControl, expectedFormat = "") {
    let lastError = "No keyed LibGen route returned a PDF or EPUB";
    const uniqueUrls = [...new Set((urls || []).map(entry => typeof entry === "string" ? entry : entry?.url).filter(Boolean))];

    for (let index = 0; index < uniqueUrls.length; index++) {
      const url = uniqueUrls[index];
      const controller = new AbortController();
      downloadControl.activeAbortController = controller;
      let inactivityTimer = null;
      const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => controller.abort(), 30000);
      };

      try {
        await downloadControl.waitIfPaused();
        itemProgress.setText(`Connecting to selected copy (${index + 1}/${uniqueUrls.length})...`);

        const headers = {
          "Accept": "application/pdf,application/epub+zip,application/octet-stream,*/*"
        };
        if (refererUrl) headers["Referer"] = refererUrl;

        resetInactivityTimer();
        const response = await fetch(url, {
          method: "GET",
          headers,
          redirect: "follow",
          credentials: "include",
          signal: controller.signal
        });
        if (!response.ok) {
          lastError = `HTTP ${response.status} from ${url}`;
          continue;
        }

        const contentLength = Number(response.headers.get("content-length") || 0);
        const reader = response.body?.getReader?.();
        if (!reader) {
          lastError = `The server did not provide a readable response stream`;
          continue;
        }

        await downloadControl.waitIfPaused();
        resetInactivityTimer();
        const first = await reader.read();
        if (first.done || !first.value || first.value.length < 4) {
          lastError = `The response from ${url} was empty`;
          continue;
        }

        const firstBytes = first.value;
        let sample = "";
        for (let i = 0; i < Math.min(firstBytes.length, 1024); i++) sample += String.fromCharCode(firstBytes[i]);
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        const contentDisposition = String(response.headers.get("content-disposition") || "").toLowerCase();
        const declaredFormat = String(expectedFormat || "").toUpperCase();
        const responseUrl = String(response.url || url);
        const isGenericBinary = contentType.includes("application/octet-stream") || !contentType;
        const hasPdfMagic = sample.includes("%PDF");
        const hasZipMagic = firstBytes[0] === 0x50 && firstBytes[1] === 0x4B
          && ([0x03, 0x05, 0x07].includes(firstBytes[2]))
          && ([0x04, 0x06, 0x08].includes(firstBytes[3]));
        const filenameSaysPdf = /filename\*?=[^;]*\.pdf(?:["';]|$)/i.test(contentDisposition)
          || /\.pdf(?:$|[?#])/i.test(responseUrl);
        const filenameSaysEpub = /filename\*?=[^;]*\.epub(?:["';]|$)/i.test(contentDisposition)
          || /\.epub(?:$|[?#])/i.test(responseUrl);

        // LibGen commonly serves valid files as application/octet-stream.
        // Trust document signatures first, then the selected catalog format
        // and Content-Disposition filename when the MIME type is generic.
        const isPdf = hasPdfMagic
          || contentType.includes("application/pdf")
          || filenameSaysPdf
          || (isGenericBinary && declaredFormat === "PDF");
        const isEpub = !isPdf && (hasZipMagic
          || contentType.includes("epub")
          || filenameSaysEpub
          || (isGenericBinary && declaredFormat === "EPUB"));
        if (!isPdf && !isEpub) {
          lastError = `The selected route returned ${contentType || "unknown content"} and did not match the expected ${declaredFormat || "PDF/EPUB"} file`;
          try { await reader.cancel(); } catch (e) {}
          continue;
        }

        const ext = isPdf ? "pdf" : "epub";
        const tempFile = Zotero.File.pathToFile(Zotero.getTempDirectory().path);
        tempFile.append(`libgen_file_${Date.now()}.${ext}`);
        const fos = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
        fos.init(tempFile, 0x02 | 0x08 | 0x20, 0o666, 0);
        const bos = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
        bos.setOutputStream(fos);

        let loadedBytes = firstBytes.length;
        bos.writeByteArray(Array.from(firstBytes), firstBytes.length);

        const updateProgress = () => {
          const loadedMB = (loadedBytes / 1048576).toFixed(1);
          if (contentLength > 0) {
            const percent = Math.max(0, Math.min(100, Math.round((loadedBytes / contentLength) * 100)));
            const totalMB = (contentLength / 1048576).toFixed(1);
            itemProgress.setText(`Downloading: ${percent}% (${loadedMB} / ${totalMB} MB)`);
          } else {
            itemProgress.setText(`Downloading: ${loadedMB} MB received...`);
          }
        };
        updateProgress();

        while (true) {
          await downloadControl.waitIfPaused();
          if (downloadControl.cancelled) throw new Error("LGFETCHER_CANCELLED");
          resetInactivityTimer();
          const chunk = await reader.read();
          if (chunk.done) break;
          if (chunk.value?.length) {
            loadedBytes += chunk.value.length;
            bos.writeByteArray(Array.from(chunk.value), chunk.value.length);
            updateProgress();
          }
        }

        if (inactivityTimer) clearTimeout(inactivityTimer);
        bos.close();
        fos.close();
        downloadControl.activeAbortController = null;
        return { path: tempFile.path, fileObj: tempFile, ext };
      } catch (e) {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        downloadControl.activeAbortController = null;
        if (downloadControl.cancelled || e.message === "LGFETCHER_CANCELLED") throw new Error("LGFETCHER_CANCELLED");
        lastError = e.name === "AbortError" ? `The selected server stopped sending data for 30 seconds` : (e.message || String(e));
        Zotero.debug(`LGFetcher strict stream error from ${url}: ${lastError}`);
      }
    }

    downloadControl.lastDownloadError = lastError;
    return null;
  }


}

function createXULMenuItem(doc, id, label, callback, iconURL = null) {
  let item = doc.createXULElement
    ? doc.createXULElement("menuitem")
    : doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "menuitem");
  item.id = id;
  item.setAttribute("label", label);
  if (iconURL) {
    item.setAttribute("class", "menuitem-iconic");
    item.setAttribute("image", iconURL);
  }
  item.addEventListener("command", callback);
  return item;
}

function onMainWindowLoad({ window }) {
  let doc = window.document;

  function getSelectedItems() {
    return window.ZoteroPane?.getSelectedItems?.()
      || window.Zotero.getActiveZoteroPane()?.getSelectedItems?.()
      || [];
  }

  function showLGFetcherAlert(message) {
    try {
      const promptService = window.Services?.prompt
        || window.Cc["@mozilla.org/embedcomp/prompt-service;1"]
          .getService(window.Ci.nsIPromptService);
      promptService.alert(window, "LGFetcher", String(message));
    } catch (e) {
      window.alert(String(message));
    }
  }

  async function execute(items) {
    if (LGFetcherBusy) {
      showLGFetcherAlert("LGFetcher is already processing an item. Finish or cancel the current operation before starting another.");
      return;
    }
    LGFetcherBusy = true;
    try {
      let result = await runLGFetcher(window, items);
      if (result) showLGFetcherAlert(result);
    } catch (err) {
      if ((err?.message || String(err)) === "LGFETCHER_CANCELLED") return;
      window.Zotero.logError(err);
      showLGFetcherAlert(`LGFetcher error: ${err.message || err}`);
    } finally {
      LGFetcherBusy = false;
    }
  }

  function injectContextItem() {
    let popup = doc.getElementById("zotero-itemmenu");
    if (!popup) return;

    window._lgFetcherContextSelection = getSelectedItems();
    if (!doc.getElementById(MENU_ID_CONTEXT)) {
      let item = createXULMenuItem(doc, MENU_ID_CONTEXT, MENU_LABEL, async () => {
        let items = window._lgFetcherContextSelection || getSelectedItems();
        await execute(items);
      }, LGFetcherRootURI ? LGFetcherRootURI + "icon.svg" : null);
      popup.appendChild(item);
    }
  }

  function injectToolsItem() {
    let popup = doc.getElementById("menu_ToolsPopup");
    if (popup && !doc.getElementById(MENU_ID_TOOLS)) {
      let item = createXULMenuItem(doc, MENU_ID_TOOLS, MENU_LABEL, async () => {
        await execute(getSelectedItems());
      }, LGFetcherRootURI ? LGFetcherRootURI + "icon.svg" : null);
      popup.appendChild(item);
    }
  }

  window._lgFetcherCtxHandler = injectContextItem;
  window._lgFetcherToolsHandler = injectToolsItem;

  let itemMenu = doc.getElementById("zotero-itemmenu");
  let toolsMenu = doc.getElementById("menu_ToolsPopup");

  if (itemMenu) {
    itemMenu.addEventListener("popupshowing", window._lgFetcherCtxHandler);
    injectContextItem();
  }
  if (toolsMenu) {
    toolsMenu.addEventListener("popupshowing", window._lgFetcherToolsHandler);
    injectToolsItem();
  }
}

function onMainWindowUnload({ window }) {
  let doc = window.document;

  if (window._lgFetcherCtxHandler) {
    let itemMenu = doc.getElementById("zotero-itemmenu");
    if (itemMenu) itemMenu.removeEventListener("popupshowing", window._lgFetcherCtxHandler);
    delete window._lgFetcherCtxHandler;
    delete window._lgFetcherContextSelection;
  }
  if (window._lgFetcherToolsHandler) {
    let toolsMenu = doc.getElementById("menu_ToolsPopup");
    if (toolsMenu) toolsMenu.removeEventListener("popupshowing", window._lgFetcherToolsHandler);
    delete window._lgFetcherToolsHandler;
  }

  let ctxItem = doc.getElementById(MENU_ID_CONTEXT);
  if (ctxItem) ctxItem.remove();
  let toolsItem = doc.getElementById(MENU_ID_TOOLS);
  if (toolsItem) toolsItem.remove();
}

function install(data, reason) {}

async function startup({ id, version, rootURI }, reason) {
  LGFetcherRootURI = rootURI;

  // A preferences-pane failure must never prevent the Tools/context commands from loading.
  try {
    Zotero.PreferencePanes.register({
      id: "lgfetcher-preferences",
      pluginID: id,
      src: rootURI + "preferences.xhtml",
      scripts: [rootURI + "preferences.js"],
      label: "LGFetcher",
      image: rootURI + "icon.svg"
    });
  } catch (e) {
    Zotero.logError(e);
  }

  try {
    await Zotero.uiReadyPromise;
  } catch (e) {
    Zotero.logError(e);
  }

  for (let win of Zotero.getMainWindows()) {
    try { onMainWindowLoad({ window: win }); }
    catch (e) { Zotero.logError(e); }
  }
}

function shutdown({ id, version, rootURI }, reason) {
  for (let win of Zotero.getMainWindows()) {
    onMainWindowUnload({ window: win });
  }
  LGFetcherRootURI = null;
}

function uninstall(data, reason) {}
