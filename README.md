# LibGen Search & Redirect Extension

A lightweight browser extension designed to seamlessly route book, paper, ISBN, and DOI queries to available **Library Genesis (LibGen)** mirror sites.

---

## 📁 Project Structure

* **`manifest.json`**: Defines extension metadata, background script declarations, and required permissions (including host permissions for LibGen endpoints).
* **`bootstrap.js`**: The core execution script. Handles initialization, manages the hardwired list of mirror domains, checks endpoint health, and performs auto-redirection.

---

## ⚙️ How It Works

1. **Trigger & Interception**: The extension listens for search events, ISBN/DOI patterns, or explicit user clicks from the extension popup/context menu.
2. **Mirror Selection & Failover**: Upon receiving a query, `bootstrap.js` iterates through a hardwired priority list of LibGen mirror domains.
3. **Health Check / Fallback**: If the primary domain fails to respond (due to downtime or ISP blocking), the script automatically reroutes the request to the next available mirror in the list.

---

## 🌐 Hardwired LibGen Mirrors

The extension relies on a pre-configured array of mirror domains defined inside `bootstrap.js` to ensure uninterrupted access.

| Mirror Domain | Type | Role |
| :--- | :--- | :--- |
| `https://libgen.is` | Official Mirror | Primary Endpoint |
| `https://libgen.rs` | Official Mirror | Secondary Endpoint |
| `https://libgen.st` | Official Mirror | Secondary Endpoint |
| `https://libgen.li` | LibGen Fork / Alt | Backup Endpoint |
| `https://libgen.gs` | LibGen Fork / Alt | Backup Endpoint |

> **Note:** Because domain availability frequently changes due to ISP blocks and server migrations, these URLs are hardwired in code so they can be easily updated or rotated.

---

## 🛠️ Updating Hardwired Domains

If a mirror domain goes offline or a new mirror needs to be added:

1. Open **`bootstrap.js`**.
2. Locate the mirror array (typically structured like `const MIRRORS = [...]`).
3. Add, remove, or reorder the domain URLs:
   ```javascript
   const LIBGEN_MIRRORS = [
     "[https://libgen.is](https://libgen.is)",
     "[https://libgen.rs](https://libgen.rs)",
     "[https://libgen.st](https://libgen.st)",
     "[https://libgen.li](https://libgen.li)"
   ];# LGFetcher
Find, download, and attach full-text books and articles from LibGen directly to your Zotero items.
