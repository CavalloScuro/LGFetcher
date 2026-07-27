<p align="center">
  <img src="assets/lgfetcher_banner.jpg" alt="LGFetcher Banner" width="100%">
</p>

# LGFetcher

**LGFetcher** is a native Zotero plugin that automatically searches Library Genesis (LibGen) mirrors, downloads full-text books and research articles, and attaches them directly to your Zotero items.

---

## 🚀 Features

* **Smart Querying:** Searches by **DOI** (for articles), **ISBN** (for books), or metadata combinations (**Author + Title**).
* **Multi-Mirror Redundancy:** Automatically fails over between mirror domains if a mirror is blocked or offline.
* **Match Verification:** Verifies file extension (PDF/EPUB), title/author match, and page count criteria before downloading.
* **Automatic File Attachment:** Streams the file into a temporary buffer, renames it according to standard conventions (`Author - Year - Title.ext`), and attaches it directly to the Zotero parent item.
* **Zotero Compatibility:** Supports Zotero 6, 7, and 8.

---

## 🌐 Hardwired LibGen Mirrors

LGFetcher uses a prioritized list of mirror domains hardwired into the execution engine. If a query on the primary domain fails or times out, LGFetcher automatically retries the query on the next mirror in line.

| Domain | Role | Notes |
| :--- | :--- | :--- |
| `https://libgen.is` | Primary | Main mirror endpoint |
| `https://libgen.rs` | Secondary | Primary failover mirror |
| `https://libgen.st` | Secondary | Additional backup mirror |
| `https://libgen.li` | Alternative | Alternate LibGen schema backup |

---

## 📁 Project Structure

* **`manifest.json`**: Package manifest for Zotero 7 & 8 plugin engine integration.
* **`install.rdf`**: Legacy manifest providing backward compatibility for Zotero 6.
* **`bootstrap.js`**: Core plugin engine containing the menu UI event listeners, LibGen mirror query loop, key resolver, stream handler, and attachment logic.

---

## 🛠️ Modifying Mirror List

If mirror domains change or new ones need to be added:

1. Open `bootstrap.js`.
2. Locate the `MIRRORS` array near the top of the search engine block:
   ```javascript
   const MIRRORS = [
     "[https://libgen.is](https://libgen.is)",
     "[https://libgen.rs](https://libgen.rs)",
     "[https://libgen.st](https://libgen.st)",
     "[https://libgen.li](https://libgen.li)"
   ];
