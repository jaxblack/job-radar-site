"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

class FakeElement {
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = "";
    this.children = [];
    this.parentNode = null;
    this._text = "";
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.selected = false;
    this.listeners = {};
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  get firstChild() { return this.children[0] || null; }
  get options() { return this.children; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatch(type) { (this.listeners[type] || []).forEach((callback) => callback({ target: this })); }
}

class FakeOption extends FakeElement {
  constructor(text, value) {
    super("option");
    this.textContent = text;
    this.value = value;
  }
}

const ids = [
  "generated-at", "source-badges", "stale-warnings", "coverage-summary",
  "source-panel-rows", "source-panel-empty", "source-panel-summary",
  "filter-company", "filter-location", "filter-city", "filter-category", "filter-role",
  "filter-keyword", "sort-order", "highlight-beijing", "only-beijing", "reset-btn",
  "result-count", "error-box", "job-list", "empty-hint"
];
const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement("div", id)]));
["filter-company", "filter-location", "filter-city", "filter-category", "filter-role", "sort-order"]
  .forEach((id) => { elements[id].tagName = "SELECT"; });
["foreign", "bigtech", "unicorn", "soe", "bank", "finance", "quant", "unknown"]
  .forEach((value) => elements["filter-category"].appendChild(new FakeOption(value, value)));
elements["sort-order"].appendChild(new FakeOption("新到旧", "desc"));
elements["sort-order"].appendChild(new FakeOption("旧到新", "asc"));
elements["sort-order"].value = "desc";
elements["highlight-beijing"].checked = true;

global.Option = FakeOption;
global.document = {
  readyState: "complete",
  getElementById(id) { return elements[id] || null; },
  createElement(tag) { return new FakeElement(tag); },
  addEventListener() {}
};
global.window = {};

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "data", name), "utf8"));
const combinedFilterJobs = [
  {
    title: "Fixture Data Target",
    company: "Fixture Labs",
    location: "Fixture City; Remote",
    company_category: "foreign",
    description: "machine learning unique-needle"
  },
  {
    title: "Fixture Wrong Company",
    company: "Other Fixture Labs",
    location: "Fixture City; Remote",
    company_category: "foreign",
    description: "machine learning unique-needle"
  },
  {
    title: "Fixture Wrong Location",
    company: "Fixture Labs",
    location: "Other Fixture City",
    company_category: "foreign",
    description: "machine learning unique-needle"
  },
  {
    title: "Fixture Wrong Category",
    company: "Fixture Labs",
    location: "Fixture City; Remote",
    company_category: "bigtech",
    description: "machine learning unique-needle"
  },
  {
    title: "Fixture Product Manager",
    company: "Fixture Labs",
    location: "Fixture City; Remote",
    company_category: "foreign",
    description: "unique-needle"
  },
  {
    title: "Fixture Wrong Keyword",
    company: "Fixture Labs",
    location: "Fixture City; Remote",
    company_category: "foreign",
    description: "machine learning"
  }
];
const jobs = fixture("jobs.json").concat(combinedFilterJobs);
const sources = fixture("sources.json");
sources.find((source) => source.source === "bytedance").status = "failed";
sources.find((source) => source.source === "bytedance").detail = "fixture timeout";
const responses = { "data/jobs.json": jobs, "data/sources.json": sources, "data/meta.json": fixture("meta.json") };
global.fetch = async (url) => ({ ok: true, async json() { return responses[url]; } });

function descendants(node) {
  return node.children.flatMap((child) => [child].concat(descendants(child)));
}

const consoleErrors = [];
const originalConsoleError = console.error;
console.error = (...args) => consoleErrors.push(args.join(" "));
const radar = require("./app.js");
const ready = new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

test.after(() => { console.error = originalConsoleError; });

test("fixture renders cards, derived classifications, links, placeholders and failed-source warning", async () => {
  await ready;
  assert.equal(elements["job-list"].children.length, jobs.length);
  const pageText = elements["job-list"].textContent;
  assert.match(pageText, /公司类别：外企/);
  assert.match(pageText, /岗位类别：数据 \/ AI/);
  assert.match(pageText, /更新时间：未提供/);
  assert.match(pageText, /查看原始招聘链接/);
  const firstCardLinks = descendants(elements["job-list"].children[0]).filter((node) => node.tagName === "A");
  assert.ok(jobs.some((job) => job.url === firstCardLinks.at(-1).href));
  assert.match(pageText, /源状态：抓取失败/);
  assert.match(elements["stale-warnings"].textContent, /来源「bytedance」本次抓取失败/);
  assert.match(elements["stale-warnings"].textContent, /fixture timeout/);
  assert.deepEqual(consoleErrors, []);
});

test("combined company, location, company category, role and free-text filters work", async () => {
  await ready;
  elements["filter-company"].value = "Fixture Labs";
  elements["filter-location"].value = "Fixture City; Remote";
  elements["filter-role"].value = "数据 / AI";
  elements["filter-keyword"].value = "unique-needle";
  elements["filter-category"].options.forEach((option) => { option.selected = option.value === "foreign"; });
  elements["filter-keyword"].dispatch("input");

  assert.equal(elements["job-list"].children.length, 1);
  assert.match(elements["job-list"].textContent, /Fixture Data Target/);
});

test("time sorting is deterministic and keeps undated jobs last", async () => {
  await ready;
  const sample = [
    { title: "Older Fixture", posted_at: "2024-01-01T00:00:00Z" },
    { title: "Newer Fixture", posted_at: "2025-01-01T00:00:00Z" },
    { title: "Undated Fixture" }
  ];
  assert.deepEqual(
    radar.filterAndSortJobs(sample, { order: "desc" }).map((job) => job.title),
    ["Newer Fixture", "Older Fixture", "Undated Fixture"]
  );
  assert.deepEqual(
    radar.filterAndSortJobs(sample, { order: "asc" }).map((job) => job.title),
    ["Older Fixture", "Newer Fixture", "Undated Fixture"]
  );
});

test("classification rules use exported fields and have stable fallbacks", () => {
  assert.deepEqual(radar.deriveCompanyCategories({ company: "国家电网有限公司" }), ["soe"]);
  assert.deepEqual(radar.deriveCompanyCategories({ company: "Apple" }), ["foreign"]);
  assert.equal(radar.deriveRole({ title: "后端开发工程师" }), "engineering");
  assert.equal(radar.deriveRole({ title: "神秘职位" }), "other");
});
