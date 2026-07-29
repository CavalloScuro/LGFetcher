"use strict";

const XHTML = "http://www.w3.org/1999/xhtml";

var LGFetcherSelection = {
  args: null,

  init() {
    this.args = window.arguments && window.arguments[0]
      ? window.arguments[0]
      : { options: [], selectedIndex: -1, cancelled: true };

    const host = document.getElementById("options");
    const header = document.createElementNS(XHTML, "div");
    header.className = "row header";
    ["", "Cover", "Author", "Title", "Publisher", "Year", "Format", "Pages", "Mirror"].forEach(text => {
      const cell = document.createElementNS(XHTML, "div");
      cell.className = "cell";
      cell.textContent = text;
      header.appendChild(cell);
    });
    host.appendChild(header);

    (this.args.options || []).forEach((option, index) => {
      const row = document.createElementNS(XHTML, "label");
      row.className = "row option";

      const radioWrap = document.createElementNS(XHTML, "div");
      const radio = document.createElementNS(XHTML, "input");
      radio.type = "radio";
      radio.name = "lgfetcher-choice";
      radio.value = String(index);
      radio.addEventListener("change", () => {
        document.querySelectorAll(".option.selected").forEach(el => el.classList.remove("selected"));
        row.classList.add("selected");
        document.getElementById("download").disabled = false;
      });
      radioWrap.appendChild(radio);
      row.appendChild(radioWrap);

      const coverCell = document.createElementNS(XHTML, "div");
      coverCell.className = "cell";
      if (option.cover) {
        const image = document.createElementNS(XHTML, "img");
        image.className = "cover";
        image.src = option.cover;
        image.alt = "Cover";
        image.addEventListener("error", () => image.replaceWith(this.makeCoverPlaceholder()), { once: true });
        coverCell.appendChild(image);
      } else {
        coverCell.appendChild(this.makeCoverPlaceholder());
      }
      row.appendChild(coverCell);

      [option.author, option.title, option.publisher, option.year, option.format, option.pages, option.mirror].forEach((value, i) => {
        const cell = document.createElementNS(XHTML, "div");
        cell.className = "cell" + (i === 1 ? " title" : "");
        cell.textContent = value || "—";
        row.appendChild(cell);
      });

      row.addEventListener("dblclick", () => {
        radio.checked = true;
        radio.dispatchEvent(new Event("change"));
        this.download();
      });
      host.appendChild(row);
    });

    document.getElementById("cancel").addEventListener("click", () => this.cancel());
    document.getElementById("download").addEventListener("click", () => this.download());
    window.addEventListener("dialogcancel", event => {
      event.preventDefault();
      this.cancel();
    });
  },

  makeCoverPlaceholder() {
    const placeholder = document.createElementNS(XHTML, "div");
    placeholder.className = "cover-placeholder";
    placeholder.textContent = "No cover";
    return placeholder;
  },

  download() {
    const checked = document.querySelector('input[name="lgfetcher-choice"]:checked');
    if (!checked) return;
    this.args.selectedIndex = Number(checked.value);
    this.args.cancelled = false;
    this.args.done = true;
    window.close();
  },

  cancel() {
    this.args.selectedIndex = -1;
    this.args.cancelled = true;
    this.args.done = true;
    window.close();
  }
};
