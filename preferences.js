window.LGFetcher_Preferences = {
  PREF: "extensions.lgfetcher.mirrors",
  FORMAT_PREFS: {
    pdf: "extensions.lgfetcher.formats.pdf",
    epub: "extensions.lgfetcher.formats.epub",
    djvu: "extensions.lgfetcher.formats.djvu",
    mobi: "extensions.lgfetcher.formats.mobi"
  },

  normalize(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map(line => line.trim().replace(/\/+$/, ""))
      .filter(Boolean)
      .join("\n");
  },

  getDefaults(box) {
    return this.normalize(box?.getAttribute("data-default-mirrors") || box?.textContent || "");
  },

  init() {
    const box = document.getElementById("lgfetcher-mirrors");
    const status = document.getElementById("lgfetcher-save-status");
    if (!box) return;

    const defaults = this.getDefaults(box);
    let saved = "";
    try {
      saved = this.normalize(Zotero.Prefs.get(this.PREF, true) || "");
    } catch (e) {
      Zotero.logError(e);
    }

    // Migrate the one-mirror value used by an earlier build to the full editable default list.
    const legacySingleMirror = saved === "https://libgen.is";
    const value = (!saved || legacySingleMirror) ? defaults : saved;
    box.value = value;
    box.textContent = value;

    // Seed or repair the saved preference so the fetcher can run immediately.
    if ((!saved || legacySingleMirror) && value) {
      try {
        Zotero.Prefs.set(this.PREF, value, true);
      } catch (e) {
        Zotero.logError(e);
      }
    }

    for (const [format, pref] of Object.entries(this.FORMAT_PREFS)) {
      const checkbox = document.getElementById(`lgfetcher-format-${format}`);
      if (!checkbox) continue;
      let enabled = true;
      try {
        const value = Zotero.Prefs.get(pref, true);
        enabled = value === undefined ? true : Boolean(value);
      } catch (e) {
        Zotero.logError(e);
      }
      checkbox.checked = enabled;
    }

    if (status) status.textContent = "";
  },

  save() {
    const box = document.getElementById("lgfetcher-mirrors");
    const status = document.getElementById("lgfetcher-save-status");
    if (!box) return;

    const cleaned = this.normalize(box.value);
    if (!cleaned) {
      if (status) status.textContent = "Enter at least one mirror URL before saving.";
      return;
    }

    const invalid = cleaned.split("\n").find(url => !/^https?:\/\//i.test(url));
    if (invalid) {
      if (status) status.textContent = `Invalid URL: ${invalid}`;
      return;
    }

    const enabledFormats = Object.entries(this.FORMAT_PREFS).filter(([format]) => {
      return document.getElementById(`lgfetcher-format-${format}`)?.checked;
    });
    if (!enabledFormats.length) {
      if (status) status.textContent = "Select at least one file type before saving.";
      return;
    }

    try {
      Zotero.Prefs.set(this.PREF, cleaned, true);
      for (const [format, pref] of Object.entries(this.FORMAT_PREFS)) {
        Zotero.Prefs.set(pref, Boolean(document.getElementById(`lgfetcher-format-${format}`)?.checked), true);
      }
      box.value = cleaned;
      box.textContent = cleaned;
      if (status) status.textContent = "Settings saved.";
    } catch (e) {
      if (status) status.textContent = "Could not save settings.";
      Zotero.logError(e);
    }
  }
};
