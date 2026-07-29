<p align="center">
  <img src="/images/lgfetcher_banner.jpg" alt="LGFetcher Banner" width="100%">
</p>

# LGFetcher

**LGFetcher** is a native Zotero plugin that searches Library Genesis (LibGen) mirrors for full-text books and research materials, lets you choose the most appropriate available copy, downloads the selected file, renames it, and attaches it directly to the corresponding Zotero item.

## What’s New in Version 1.1.0

LGFetcher v1.1.0 introduces a redesigned search-and-download workflow, configurable mirror and file-type settings, improved candidate filtering, a download-options window, streamed download progress, and automatic file storage and naming.

---

## 🚀 Features

- **Smart Querying:** Searches using available Zotero metadata, including **DOI**, **ISBN**, **title**, and **author** information. Search terms are cleaned and simplified to improve matching across different LibGen database formats.

- **Candidate Filtering and Ranking:** Compares search results against the selected Zotero item and prioritizes the most likely matches. LGFetcher considers title, author, ISBN, year, page count, and file format while filtering out unlikely results such as book reviews.

- **Download Options Window:** When one or more suitable copies are available, LGFetcher presents the strongest matches in a selection window. Each result may include:
  - Cover image
  - Author
  - Title
  - Publisher
  - Year
  - Page count
  - File format
  - Mirror source

  You can review the available editions and choose the specific copy and format you want to download. See [Figure 3](#figure-3-download-options-window).

- **Customizable LibGen Mirrors:** Mirror addresses are no longer hardwired into the plugin. You can add, remove, and reorder LibGen mirrors from the LGFetcher pane in Zotero Settings. LGFetcher checks the configured mirrors in the order shown. See [Figure 1](#figure-1-lgfetcher-settings).

- **Customizable File Types:** Choose which formats LGFetcher should include in search results:
  - PDF
  - EPUB
  - DJVU
  - MOBI

  File-type preferences are configured from the same LGFetcher settings pane shown in [Figure 1](#figure-1-lgfetcher-settings).

- **Multi-Mirror Redundancy:** If a configured mirror is unavailable, blocked, or returns no suitable results, LGFetcher automatically continues to the next mirror.

- **Download Progress:** Files are streamed locally through the LGFetcher download window. When the server reports the total file size, LGFetcher displays byte-by-byte percentage progress. Downloads can be paused or canceled from the progress window.

- **File Validation:** LGFetcher checks the downloaded file data to confirm that the server returned a supported document rather than an HTML error page or unusable response. Generic binary responses such as `application/octet-stream` are evaluated using the file signature, filename, selected format, and response URL.

- **Automatic Storage and Attachment:** The selected file is downloaded into Zotero’s managed attachment storage and attached directly to the selected parent item.

- **Automatic File Renaming:** Downloaded files are renamed according to a consistent Zotero-friendly convention:

  ```text
  Author - Year - Title.ext
  ```

  A successfully downloaded and renamed attachment is shown in [Figure 4](#figure-4-downloaded-file-in-zotero).

- **Integrated Zotero Interface:** LGFetcher is available from the Zotero **Tools** menu and includes its own pane in **Zotero Settings**. See [Figures 1 and 2](#figures).

- **Zotero Compatibility:** Supports Zotero 6, 7, and 8.

---

## 🔎 How It Works

1. Select a regular bibliographic item in Zotero.
2. Open **Tools → LGFetcher – Find a Copy**. See [Figure 2](#figure-2-lgfetcher-in-the-tools-menu).
3. LGFetcher searches the configured mirrors using the selected item’s metadata.
4. Search results are filtered, ranked, and compared against the selected Zotero item.
5. The download-options window displays the strongest available matches.
6. Review the available metadata and select the desired edition and file format. See [Figure 3](#figure-3-download-options-window).
7. Click **Download**.
8. LGFetcher resolves the file link, downloads and validates the document, renames it, and attaches it to the selected Zotero item. See [Figure 4](#figure-4-downloaded-file-in-zotero).

---

## ⚙️ Configuring Mirrors and File Types

Open:

**Zotero Settings → LGFetcher**

The LGFetcher settings pane allows you to configure both mirror addresses and permitted file formats.

### LibGen Mirror URLs

Enter one mirror URL per line. LGFetcher checks the mirrors in the order shown.

Each address must include the protocol:

```text
https://libgen.li
https://libgen.la
https://libgen.gl
```

You may add, remove, or reorder mirror addresses whenever LibGen domains change.

### File Types

Select the formats that LGFetcher should include in its search results:

- PDF
- EPUB
- DJVU
- MOBI

Click **Save Settings** after making changes.

The mirror and file-type controls are shown in [Figure 1](#figure-1-lgfetcher-settings).

---

## 📥 Choosing a Copy

The download-options window appears when LGFetcher finds one or more suitable candidates.

Results are ranked according to their similarity to the selected Zotero item. Review the available metadata before downloading, particularly when multiple editions or formats are listed.

The options window includes the following controls:

- **Download** retrieves the selected copy.
- **Search Again** repeats the search.
- **Cancel** closes the window without downloading.

The example in [Figure 3](#figure-3-download-options-window) shows the same title available in both PDF and EPUB formats.

---

## 📁 Downloaded Files

LGFetcher downloads the selected document into Zotero’s managed attachment storage. After the download is complete, the file is:

1. Validated as a supported document.
2. Renamed using the item’s author, year, and title.
3. Imported as a stored attachment under the selected Zotero item.

Example:

```text
Pawlicka-Deger - 2023 - Digital Humanities and Laboratories.pdf
```

The resulting stored attachment is shown in [Figure 4](#figure-4-downloaded-file-in-zotero).

---

## 📁 Project Structure

- **`manifest.json`**: Plugin manifest for the current Zotero extension system.
- **`install.rdf`**: Legacy manifest used for compatibility with older Zotero versions.
- **`bootstrap.js`**: Core plugin engine containing the Zotero interface integration, search logic, candidate ranking and filtering, mirror loop, download resolver, progress handling, file validation, renaming, and attachment import.
- **`preferences.xhtml`**: LGFetcher settings pane for mirror URLs and file-type preferences.
- **`selection.xhtml`**: Download-options window used to display and select matching copies.
- **`icon.svg`**: LGFetcher interface icon used in Zotero menus, settings, and plugin management.

---

## 🛠️ Updating the Mirror List

Mirror domains can be updated without editing `bootstrap.js`.

1. Open **Zotero Settings**.
2. Select **LGFetcher**.
3. Add, remove, or reorder the addresses under **LibGen mirror URLs**.
4. Click **Save Settings**.

LGFetcher will use the updated list during the next search.

---

## Installation

1. Download the latest LGFetcher `.xpi` release.
2. Open Zotero.
3. Go to **Tools → Plugins**.
4. Open the plugin-management menu and select **Install Plugin From File…**
5. Select the downloaded `.xpi` file.
6. Restart Zotero if prompted.

---

## Figures

### Figure 1. LGFetcher settings

The LGFetcher settings pane allows users to add, remove, and reorder LibGen mirror URLs and select which file formats should appear in search results.

<p align="center">
  <img src="/images/fig_1_settings_menu.jpg" alt="LGFetcher settings pane showing mirror URLs and file-type options" width="85%">
</p>

---

### Figure 2. LGFetcher in the Tools menu

LGFetcher can be launched from **Tools → LGFetcher – Find a Copy** after selecting a bibliographic item in Zotero.

<p align="center">
  <img src="/images/fig_2_tools_menu.jpg" alt="LGFetcher Find a Copy command in the Zotero Tools menu" width="55%">
</p>

---

### Figure 3. Download-options window

LGFetcher displays the strongest candidate matches and allows the user to choose among available editions and file formats before downloading.

<p align="center">
  <img src="/images/fig_3_download_options.jpg" alt="LGFetcher download-options window showing PDF and EPUB matches" width="100%">
</p>

---

### Figure 4. Downloaded file in Zotero

After a successful download, LGFetcher stores the file under the selected Zotero item and automatically renames it according to the item’s author, year, and title.

<p align="center">
  <img src="/images/fig_4_download_success.jpg" alt="Downloaded and automatically renamed LGFetcher attachment in Zotero" width="85%">
</p>

---

## Disclaimer

LGFetcher is an independent Zotero plugin and is not affiliated with or endorsed by Zotero, the Corporation for Digital Scholarship, or Library Genesis.

Users are responsible for complying with the copyright laws and access regulations applicable in their jurisdiction.
