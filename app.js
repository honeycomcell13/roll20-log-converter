const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let blocks = [];
let insertIndex = 0;
let coverData = "";
let pastedHtml = "";

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

const removeEscapes = (value) =>
  String(value ?? "").replace(/\\([~*])/g, "$1");

function sanitizeHtml(html) {
  const documentObject = new DOMParser().parseFromString(
    `<div>${html || ""}</div>`,
    "text/html"
  );
  const root = documentObject.body.firstElementChild;

  root
    .querySelectorAll("script, style, iframe, object, embed, form, input, button")
    .forEach((element) => element.remove());

  root.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        (
          (name === "href" || name === "src") &&
          /^javascript:/i.test(value)
        )
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return root.innerHTML;
}

function inlineMarkdown(value) {
  return escapeHtml(removeEscapes(value))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

function htmlToText(html) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element.textContent || "";
}

function makeTableBlock(lines) {
  return {
    type: "table",
    caption: "",
    rows: lines
      .filter((line, index) => index !== 1)
      .map((line) =>
        line
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) =>
            removeEscapes(cell.trim()).replace(/^\*\*|\*\*$/g, "")
          )
      )
  };
}

function parseMarkdown(markdown) {
  const lines = markdown
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n");

  const output = [];
  let pendingImage = "";
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    const imageMatch = line.match(
      /^!?(?:\[image\]|!\[[^\]]*\])\((https?:\/\/[^)]+)\)$/i
    );

    if (imageMatch) {
      pendingImage = imageMatch[1];
      index += 1;
      continue;
    }

    const speakerMatch = line.match(/^\*\*([^*\n]+?):\*\*\s*(.*)$/);

    if (speakerMatch) {
      let body = speakerMatch[2];
      let nextIndex = index + 1;

      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex];
        const trimmed = nextLine.trim();

        if (!trimmed) {
          if (body && !body.endsWith("\n")) {
            body += "\n";
          }

          nextIndex += 1;
          continue;
        }

        if (
          /^\[image\]\(/.test(trimmed) ||
          /^\*\*[^*]+?:\*\*/.test(trimmed) ||
          /^\*\*\*/.test(trimmed) ||
          /^\|/.test(trimmed)
        ) {
          break;
        }

        body += `${body ? "\n" : ""}${nextLine}`;
        nextIndex += 1;
      }

      output.push({
        type: "speech",
        speaker: removeEscapes(speakerMatch[1]),
        body: removeEscapes(body.trim()),
        avatar: pendingImage
      });

      pendingImage = "";
      index = nextIndex;
      continue;
    }

    if (
      /^\|/.test(line) &&
      index + 1 < lines.length &&
      /^\|?\s*:?-+/.test(lines[index + 1].trim())
    ) {
      const tableLines = [lines[index]];
      let nextIndex = index + 1;

      while (
        nextIndex < lines.length &&
        /^\|/.test(lines[nextIndex].trim())
      ) {
        tableLines.push(lines[nextIndex]);
        nextIndex += 1;
      }

      output.push(makeTableBlock(tableLines));
      index = nextIndex;
      continue;
    }

    const narrationMatch = line.match(/^\*\*\*(.*?)\*\*\*$/);

    if (narrationMatch) {
      output.push({
        type: "narration",
        body: removeEscapes(narrationMatch[1])
      });

      index += 1;
      continue;
    }

    if (pendingImage) {
      output.push({
        type: "contentImage",
        src: pendingImage
      });

      pendingImage = "";
    }

    let rawText = line;
    let nextIndex = index + 1;

    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();

      if (
        !trimmed ||
        /^\[image\]\(/.test(trimmed) ||
        /^\*\*[^*]+?:\*\*/.test(trimmed) ||
        /^\*\*\*/.test(trimmed) ||
        /^\|/.test(trimmed)
      ) {
        break;
      }

      rawText += `\n${lines[nextIndex]}`;
      nextIndex += 1;
    }

    output.push({
      type: "raw",
      body: removeEscapes(rawText)
    });

    index = nextIndex;
  }

  if (pendingImage) {
    output.push({
      type: "contentImage",
      src: pendingImage
    });
  }

  return output;
}

function makeHtmlTable(table) {
  return {
    type: "table",
    caption: table.querySelector("caption")?.textContent?.trim() || "",
    rows: [...table.querySelectorAll("tr")].map((row) =>
      [...row.children].map((cell) => cell.textContent.trim())
    )
  };
}

function parseRoll20Html(html) {
  const documentObject = new DOMParser().parseFromString(html, "text/html");
  const output = [];

  [...documentObject.body.children].forEach((element) => {
    if (element.matches(".message.desc")) {
      const clone = element.cloneNode(true);

      clone
        .querySelectorAll(".spacer")
        .forEach((item) => item.remove());

      output.push({
        type: "narration",
        bodyHtml: sanitizeHtml(clone.innerHTML)
      });

      return;
    }

    if (element.matches(".message.general")) {
      const clone = element.cloneNode(true);

      const avatar =
        clone.querySelector(".avatar img")?.src || "";

      const speaker =
        clone
          .querySelector(".by")
          ?.textContent
          ?.replace(/:\s*$/, "")
          .trim() || "이름 없음";

      clone
        .querySelectorAll(".spacer, .avatar, .by")
        .forEach((item) => item.remove());

      output.push({
        type: "speech",
        speaker,
        bodyHtml: sanitizeHtml(clone.innerHTML),
        avatar
      });

      return;
    }

    if (
      element.matches(".sheet-rolltemplate-coc-1") ||
      element.tagName === "TABLE"
    ) {
      const table = element.matches("table")
        ? element
        : element.querySelector("table");

      if (table) {
        output.push(makeHtmlTable(table));
      }

      return;
    }

    const image = element.querySelector?.("img");

    if (image) {
      output.push({
        type: "contentImage",
        src: image.src
      });
    }
  });

  return output;
}

function looksLikeHtml(value) {
  return (
    /<(div|table|p|span)[\s>]/i.test(value) &&
    /(class=["'][^"']*(message|sheet-rolltemplate)|<table)/i.test(value)
  );
}

function initials(name) {
  return (name || "?").trim().slice(0, 1);
}

function narrationClass(text) {
  if (/CHAPTER|챕터/i.test(text)) {
    return "chapter";
  }

  if (/판정/.test(text) && /[✷✦]/.test(text)) {
    return "check-banner";
  }

  if (/^[─━―\s✦✷]+$/.test(text)) {
    return "divider-text";
  }

  return "";
}

function resultClass(value) {
  if (/대성공|극단|어려운|보통 성공|성공/.test(value)) {
    return "result-success";
  }

  if (/대실패|실패/.test(value)) {
    return "result-fail";
  }

  return "";
}

function renderBlock(block, index, editable = true) {
  let output = "";

  if (block.type === "speech") {
    const body = block.bodyHtml
      ? sanitizeHtml(block.bodyHtml)
      : inlineMarkdown(block.body);

    output = `
      <div class="message general">
        ${
          block.avatar
            ? `<img
                class="avatar"
                src="${escapeHtml(block.avatar)}"
                alt="${escapeHtml(block.speaker)} 인장"
              >`
            : `<span class="avatar placeholder">
                ${escapeHtml(initials(block.speaker))}
              </span>`
        }

        <span
          class="by editable"
          ${
            editable
              ? 'contenteditable="true" data-field="speaker"'
              : ""
          }
        >${escapeHtml(block.speaker)}</span><span>:</span>

        <span
          class="editable"
          ${
            editable
              ? 'contenteditable="true" data-field="bodyHtml"'
              : ""
          }
        >${body}</span>
      </div>
    `;
  }

  if (block.type === "narration") {
    const body = block.bodyHtml
      ? sanitizeHtml(block.bodyHtml)
      : inlineMarkdown(block.body);

    const decoration = narrationClass(htmlToText(body));

    output = `
      <div class="message desc">
        <span
          class="editable ${decoration}"
          ${
            editable
              ? 'contenteditable="true" data-field="bodyHtml"'
              : ""
          }
        >${body}</span>
      </div>
    `;
  }

  if (block.type === "table") {
    output = `
      <div class="roll-wrap">
        <table class="roll-table">
          ${
            block.caption
              ? `<caption
                  class="editable"
                  ${
                    editable
                      ? 'contenteditable="true" data-field="caption"'
                      : ""
                  }
                >${escapeHtml(block.caption)}</caption>`
              : ""
          }

          <tbody>
            ${block.rows.map((row, rowIndex) => `
              <tr>
                ${row.map((value, cellIndex) => {
                  const tag = cellIndex === 0 ? "th" : "td";

                  const result =
                    cellIndex === 1 &&
                    /판정결과/.test(row[0])
                      ? resultClass(value)
                      : "";

                  return `
                    <${tag}
                      class="editable ${result}"
                      ${
                        editable
                          ? `contenteditable="true"
                             data-row="${rowIndex}"
                             data-cell="${cellIndex}"`
                          : ""
                      }
                    >${escapeHtml(value)}</${tag}>
                  `;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  if (block.type === "raw") {
    output = `
      <div
        class="raw editable"
        ${
          editable
            ? 'contenteditable="true" data-field="body"'
            : ""
        }
      >${inlineMarkdown(block.body)}</div>
    `;
  }

  if (block.type === "contentImage") {
    output = `
      <div class="content-image">
        <img
          src="${escapeHtml(block.src)}"
          alt="삽입 이미지"
        >
      </div>
    `;
  }

  if (block.type === "handout") {
    output = `
      <article class="handout">
        <div class="handout-head">
          <strong
            class="editable"
            ${
              editable
                ? 'contenteditable="true" data-field="title"'
                : ""
            }
          >${escapeHtml(block.title)}</strong>

          <small>HANDOUT</small>
        </div>

        <div
          class="handout-body editable"
          ${
            editable && block.mode === "text"
              ? 'contenteditable="true" data-field="body"'
              : ""
          }
        >${
          block.mode === "image"
            ? `<img
                src="${escapeHtml(block.data)}"
                alt="${escapeHtml(block.title)}"
              >`
            : inlineMarkdown(block.body)
        }</div>
      </article>
    `;
  }

  if (!editable) {
    return output;
  }

  return `
    <div class="block" data-index="${index}">
      ${output}

      <div class="block-tools">
        <button type="button" data-move="up">↑</button>
        <button type="button" data-delete>삭제</button>
        <button type="button" data-move="down">↓</button>
      </div>
    </div>
  `;
}

function syncEditedContent(element) {
  const wrapper = element.closest(".block");

  if (!wrapper) {
    return;
  }

  const block = blocks[Number(wrapper.dataset.index)];

  if (element.dataset.row !== undefined) {
    block.rows[
      Number(element.dataset.row)
    ][
      Number(element.dataset.cell)
    ] = element.textContent;

    return;
  }

  if (element.dataset.field === "bodyHtml") {
    block.bodyHtml = sanitizeHtml(element.innerHTML);
    return;
  }

  if (element.dataset.field) {
    block[element.dataset.field] = element.textContent;
  }
}

function renderEditor() {
  const timeline = $("#timeline");

  timeline.innerHTML =
    blocks.map((block, index) => `
      <div class="insert-slot">
        <button type="button" data-insert="${index}">
          ＋ 핸드아웃
        </button>
      </div>

      ${renderBlock(block, index)}
    `).join("") +
    `
      <div class="insert-slot">
        <button type="button" data-insert="${blocks.length}">
          ＋ 핸드아웃
        </button>
      </div>
    `;

  const characters = new Set(
    blocks
      .filter((block) => block.type === "speech")
      .map((block) => block.speaker)
  );

  $("#message-count").textContent =
    `로그 항목 ${blocks.length}`;

  $("#character-count").textContent =
    `등장인물 ${characters.size}`;

  $("#handout-count").textContent =
    `핸드아웃 ${
      blocks.filter((block) => block.type === "handout").length
    }`;

  $$("[data-insert]").forEach((button) => {
    button.addEventListener("click", () => {
      openHandoutDialog(Number(button.dataset.insert));
    });
  });

  $$("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const index =
        Number(button.closest(".block").dataset.index);

      blocks.splice(index, 1);
      renderEditor();
    });
  });

  $$("[data-move]").forEach((button) => {
    button.addEventListener("click", () => {
      const index =
        Number(button.closest(".block").dataset.index);

      const nextIndex =
        button.dataset.move === "up"
          ? index - 1
          : index + 1;

      if (
        nextIndex < 0 ||
        nextIndex >= blocks.length
      ) {
        return;
      }

      [blocks[index], blocks[nextIndex]] =
        [blocks[nextIndex], blocks[index]];

      renderEditor();
    });
  });

  $$(".editable").forEach((element) => {
    element.addEventListener("input", () => {
      syncEditedContent(element);
    });
  });
}

function showImportError(message) {
  $("#import-error").textContent = message;
  $("#import-error").hidden = false;
}

function startEditor(content, fileName = "") {
  blocks = looksLikeHtml(content)
    ? parseRoll20Html(content)
    : parseMarkdown(content);

  if (!blocks.length) {
    showImportError("변환할 수 있는 로그를 찾지 못했어요.");
    return;
  }

  const title =
    $("#session-title").value.trim() ||
    fileName.replace(/\.(md|markdown|txt|html)$/i, "") ||
    "롤20 세션 로그";

  $("#title-input").value = title;
  $("#import-view").hidden = true;
  $("#editor-view").hidden = false;

  renderEditor();
  window.scrollTo(0, 0);
}

function readLogFile(file) {
  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.addEventListener("load", () => {
    startEditor(reader.result, file.name);
  });

  reader.addEventListener("error", () => {
    showImportError("파일을 읽지 못했어요.");
  });

  reader.readAsText(file);
}

/* 파일 선택과 드래그 */

const dropzone = $("#dropzone");

dropzone.addEventListener("click", () => {
  $("#file-input").click();
});

dropzone.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" ||
    event.key === " "
  ) {
    event.preventDefault();
    $("#file-input").click();
  }
});

$("#file-input").addEventListener("change", (event) => {
  readLogFile(event.target.files[0]);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("drag");
  });
});

dropzone.addEventListener("drop", (event) => {
  readLogFile(event.dataTransfer.files[0]);
});

/* 서식이 포함된 붙여넣기 */

$("#rich-input").addEventListener("paste", (event) => {
  const html =
    event.clipboardData.getData("text/html");

  const text =
    event.clipboardData.getData("text/plain");

  if (html) {
    event.preventDefault();
    pastedHtml = html;
    $("#rich-input").innerHTML = sanitizeHtml(html);
  } else {
    pastedHtml = text;
  }
});

$("#rich-input").addEventListener("input", () => {
  if (!$("#rich-input").innerHTML.trim()) {
    pastedHtml = "";
  }
});

$("#convert-button").addEventListener("click", () => {
  const content =
    pastedHtml ||
    $("#rich-input").innerText;

  if (!content.trim()) {
    showImportError("파일이나 붙여넣은 내용이 없어요.");
    return;
  }

  startEditor(content);
});

/* 핸드아웃 팝업 */

function openHandoutDialog(index) {
  insertIndex = index;

  $("#handout-title").value = "";
  $("#handout-body").value = "";
  $("#handout-image").value = "";
  $("#image-name").textContent = "이미지 선택";
  $("#handout-type").value = "text";
  $("#text-field").hidden = false;
  $("#image-field").hidden = true;

  $("#handout-dialog").showModal();
}

function closeHandoutDialog() {
  $("#handout-dialog").close();
}

$("#modal-x").addEventListener(
  "click",
  closeHandoutDialog
);

$("#modal-cancel").addEventListener(
  "click",
  closeHandoutDialog
);

$("#handout-dialog").addEventListener("click", (event) => {
  if (event.target === $("#handout-dialog")) {
    closeHandoutDialog();
  }
});

$("#handout-type").addEventListener("change", (event) => {
  const imageMode =
    event.target.value === "image";

  $("#text-field").hidden = imageMode;
  $("#image-field").hidden = !imageMode;
});

$("#handout-image").addEventListener("change", (event) => {
  $("#image-name").textContent =
    event.target.files[0]?.name ||
    "이미지 선택";
});

$("#add-handout").addEventListener("click", () => {
  const title =
    $("#handout-title").value.trim() ||
    "제목 없는 핸드아웃";

  const mode =
    $("#handout-type").value;

  if (mode === "text") {
    blocks.splice(insertIndex, 0, {
      type: "handout",
      mode,
      title,
      body: $("#handout-body").value
    });

    closeHandoutDialog();
    renderEditor();
    return;
  }

  const imageFile =
    $("#handout-image").files[0];

  if (!imageFile) {
    showToast("이미지를 선택해주세요.");
    return;
  }

  const reader = new FileReader();

  reader.addEventListener("load", () => {
    blocks.splice(insertIndex, 0, {
      type: "handout",
      mode,
      title,
      data: reader.result
    });

    closeHandoutDialog();
    renderEditor();
  });

  reader.readAsDataURL(imageFile);
});

/* 상단 썸네일 */

$("#cover-input").addEventListener("change", (event) => {
  const imageFile = event.target.files[0];

  if (!imageFile) {
    return;
  }

  const reader = new FileReader();

  reader.addEventListener("load", () => {
    coverData = reader.result;
    $("#cover-preview img").src = coverData;
    $("#cover-preview").hidden = false;
    $("#remove-cover").hidden = false;
    $("#cover-label").textContent = imageFile.name;
  });

  reader.readAsDataURL(imageFile);
});

$("#remove-cover").addEventListener("click", () => {
  coverData = "";
  $("#cover-preview").hidden = true;
  $("#remove-cover").hidden = true;
  $("#cover-label").textContent = "이미지 선택";
});

/* 저장될 HTML의 디자인 */

const exportCss = `
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    color: #333333;
    background: #ffffff;
    font: 13.65px/1.55 "Segoe UI", Roboto, sans-serif;
  }

  .archive {
    width: min(960px, 100%);
    margin: auto;
    background: #f1f1f1;
  }

  .cover {
    padding: 24px;
    background: #ffffff;
    border-bottom: 1px solid #dddddd;
  }

  .cover img {
    display: block;
    max-width: 100%;
    max-height: 720px;
    margin: auto;
  }

  .title {
    padding: 22px;
    text-align: center;
    background: #ffffff;
    border-bottom: 1px solid #dddddd;
  }

  .title h1 {
    margin: 0;
    font: 700 28px/1.3 Georgia, serif;
  }

  .message {
    position: relative;
    color: #333333;
  }

  .message.general {
    padding: 7px 16px 8px 45px;
    background: #f1f1f1 !important;
  }

  .message.desc {
    padding: 8px 18px;
    text-align: center;
    background: #f1f1f1;
    font-style: italic;
    font-weight: 700;
  }

  .message::before {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    height: 2px;
    background: #e1e1e1;
    content: "";
  }

  .avatar {
    position: absolute;
    top: 8px;
    left: 6px;
    width: 28px;
    height: 28px;
    object-fit: cover;
  }

  .avatar.placeholder {
    display: grid;
    place-items: center;
    background: #d3d3d3;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
  }

  .by {
    margin-right: 4px;
    font-weight: 700;
  }

  .chapter {
    display: block;
    margin: -8px -18px;
    padding: 8px 12px;
    color: #ffffff;
    background: #9e2733;
    font-style: normal;
  }

  .check-banner {
    display: inline-block;
    padding: 5px 25px;
    color: #ffffff;
    background: linear-gradient(135deg, #9e2733, #24090c);
    border-radius: 20px;
    font-style: normal;
  }

  .divider-text {
    color: #9e2733;
    font-style: normal;
  }

  .roll-wrap {
    padding: 8px 16px 9px 45px;
    background: #f1f1f1;
  }

  .roll-table {
    width: min(100%, 620px);
    color: #111111;
    background: #ffffff;
    border-collapse: collapse;
    table-layout: fixed;
  }

  .roll-table caption {
    padding: 3px;
    color: #ffffff;
    background: #111111;
    border: 1px solid #111111;
    font-weight: 700;
  }

  .roll-table td,
  .roll-table th {
    padding: 3px 6px;
    border: 1px solid #111111;
  }

  .roll-table th {
    width: 38%;
    text-align: left;
  }

  .roll-table td {
    text-align: center;
  }

  .result-success {
    color: #ffffff;
    background: #18743a !important;
  }

  .result-fail {
    color: #ffffff;
    background: #bd1831 !important;
  }

  .handout {
    margin: 24px 36px;
    background: #ffffff;
    border: 1px solid #242424;
    box-shadow: 6px 6px 0 #bdbdb9;
  }

  .handout-head {
    display: flex;
    justify-content: space-between;
    padding: 9px 13px;
    color: #ffffff;
    background: #242424;
  }

  .handout-head small {
    color: #dddddd;
    font: 700 10px ui-monospace;
  }

  .handout-body {
    padding: 18px;
    white-space: pre-wrap;
  }

  .handout img,
  .content-image img {
    display: block;
    max-width: 100%;
    max-height: 80vh;
    margin: auto;
  }

  .content-image {
    padding: 20px;
    background: #ffffff;
  }

  .raw {
    padding: 7px 16px;
    background: #f1f1f1;
    white-space: pre-wrap;
  }

  @media (max-width: 600px) {
    .message.general {
      padding-right: 8px;
    }

    .handout {
      margin: 20px 14px;
    }
  }
`;

function makeDocumentHtml(data, title) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <title>${escapeHtml(title)}</title>
  <style>${exportCss}</style>
</head>
<body>
  <main class="archive">
    ${
      coverData
        ? `<div class="cover">
            <img
              src="${coverData}"
              alt="${escapeHtml(title)} 썸네일"
            >
          </div>`
        : ""
    }

    <header class="title">
      <h1>${escapeHtml(title)}</h1>
    </header>

    ${data
      .map((block, index) =>
        renderBlock(block, index, false)
      )
      .join("")}
  </main>
</body>
</html>`;
}

/* 인장을 HTML 파일 안에 포함 */

async function embedAvatarImages() {
  const copiedBlocks = structuredClone(blocks);

  const imageUrls = [...new Set(
    copiedBlocks
      .filter((block) =>
        block.avatar &&
        !block.avatar.startsWith("data:")
      )
      .map((block) => block.avatar)
  )];

  if (!imageUrls.length) {
    return copiedBlocks;
  }

  $("#image-status").hidden = false;
  let completed = 0;

  for (
    let index = 0;
    index < imageUrls.length;
    index += 1
  ) {
    const imageUrl = imageUrls[index];

    $("#image-status").textContent =
      `인장 저장 중 ${index + 1}/${imageUrls.length}`;

    try {
      const response = await fetch(imageUrl);

      if (!response.ok) {
        throw new Error("이미지 요청 실패");
      }

      const blob = await response.blob();

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.addEventListener(
          "load",
          () => resolve(reader.result)
        );

        reader.addEventListener(
          "error",
          reject
        );

        reader.readAsDataURL(blob);
      });

      copiedBlocks.forEach((block) => {
        if (block.avatar === imageUrl) {
          block.avatar = dataUrl;
        }
      });

      completed += 1;
    } catch (error) {
      /*
        이미지 서버가 파일 변환을 막으면
        기존 Roll20 이미지 주소를 그대로 유지합니다.
      */
    }
  }

  $("#image-status").textContent =
    completed === imageUrls.length
      ? `인장 ${completed}개를 HTML에 저장했어요.`
      : `인장 ${completed}/${imageUrls.length}개 저장. 나머지는 원본 링크로 유지돼요.`;

  return copiedBlocks;
}

async function createFinalHtml() {
  const data = $("#embed-images").checked
    ? await embedAvatarImages()
    : structuredClone(blocks);

  const title =
    $("#title-input").value.trim() ||
    "롤20 세션 로그";

  return makeDocumentHtml(data, title);
}

/* 미리보기와 다운로드 */

$("#preview-button").addEventListener("click", async () => {
  const html = await createFinalHtml();

  const url = URL.createObjectURL(
    new Blob([html], {
      type: "text/html"
    })
  );

  $("#preview-frame").src = url;
  $("#preview-dialog").showModal();
});

$("#preview-close").addEventListener("click", () => {
  $("#preview-dialog").close();
});

$("#download-button").addEventListener("click", async () => {
  const html = await createFinalHtml();

  const title =
    $("#title-input").value.trim() ||
    "롤20 세션 로그";

  const link = document.createElement("a");

  link.href = URL.createObjectURL(
    new Blob([html], {
      type: "text/html;charset=utf-8"
    })
  );

  link.download =
    `${title.replace(/[\\/:*?"<>|]/g, "_")}.html`;

  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(link.href);
  }, 3000);

  showToast("HTML을 저장했어요.");
});

$("#reset-button").addEventListener("click", () => {
  if (!confirm("현재 편집 내용을 닫을까요?")) {
    return;
  }

  blocks = [];
  coverData = "";
  pastedHtml = "";

  $("#editor-view").hidden = true;
  $("#import-view").hidden = false;
  $("#rich-input").innerHTML = "";

  window.scrollTo(0, 0);
});

function showToast(message) {
  const toast = $("#toast");

  toast.textContent = message;
  toast.hidden = false;

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}
