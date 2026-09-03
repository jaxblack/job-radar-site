/* Job Radar static frontend — vanilla JS, no build step. */
(function () {
  "use strict";

  var state = { jobs: [], sources: [], meta: {} };
  var PLACEHOLDER = "未提供";

  // ---------- tolerant field access ----------

  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      return v;
    }
    return null;
  }

  function asText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      return v.map(asText).filter(Boolean).join(" / ");
    }
    if (typeof v === "object") {
      var inner = pick(v, ["name", "label", "title", "text", "value"]);
      return inner ? asText(inner) : "";
    }
    return "";
  }

  function getTitle(j) { return asText(pick(j, ["title", "job_title", "postingTitle", "name", "position"])); }
  function getCompany(j) { return asText(pick(j, ["company", "company_name", "employer", "source", "org"])); }
  function getLocation(j) { return asText(pick(j, ["location", "city", "locations", "city_info", "workLocation", "place"])); }
  function getUrl(j) {
    var u = asText(pick(j, ["url", "apply_url", "source_url", "link", "job_url", "jobDetailUrl", "href"]));
    return /^https?:\/\//i.test(u) ? u : "";
  }
  function getSource(j) { return asText(pick(j, ["source", "source_name", "site", "provider"])); }
  function getEmploymentType(j) { return asText(pick(j, ["employment_type", "employmentType", "timeType"])); }
  function getRemote(j) { return asText(pick(j, ["remote", "workplace_type", "workplaceType"])); }
  function getExperience(j) { return asText(pick(j, ["experience_requirement", "experience"])); }
  function getEducation(j) { return asText(pick(j, ["education_requirement", "education"])); }
  function getDescription(j) { return asText(pick(j, ["description", "summary", "description_short"])); }

  function getSalary(j) {
    var text = asText(pick(j, ["salary_text", "salary", "compensation"]));
    if (text) return text;
    var low = pick(j, ["salary_min"]);
    var high = pick(j, ["salary_max"]);
    if (typeof low !== "number" && typeof high !== "number") return "";
    var currency = asText(pick(j, ["salary_currency", "currency"]));
    var range = (typeof low === "number" ? low.toLocaleString() : "?") + "–" +
      (typeof high === "number" ? high.toLocaleString() : "?");
    return (currency ? currency + " " : "") + range;
  }

  function educationLabel(value) {
    var labels = {
      "high-school": "高中",
      associate: "大专",
      bachelor: "本科",
      master: "硕士",
      doctorate: "博士"
    };
    return labels[value] || value;
  }

  // 城市 / 公司类别：字段可能缺失，缺失一律降级为 UNKNOWN，不抛错。
  var UNKNOWN = "unknown";

  var CATEGORY_LABELS = {
    foreign: "外企",
    bigtech: "大厂",
    unicorn: "独角兽",
    soe: "国企央企",
    bank: "银行",
    finance: "金融",
    quant: "量化",
    unknown: "未分类"
  };

  var CATEGORY_ALIASES = {
    "外企": "foreign",
    "大厂": "bigtech",
    "独角兽": "unicorn",
    "国企央企": "soe",
    "银行": "bank",
    "金融": "finance",
    "量化": "quant",
    "未分类": "unknown"
  };

  var ROLE_LABELS = {
    data: "数据 / AI",
    engineering: "研发 / 工程",
    product: "产品",
    design: "设计",
    operations: "运营 / 客服",
    sales: "销售 / 市场",
    finance: "金融 / 财务",
    people: "人力 / 行政 / 法务",
    other: "其他"
  };

  // 分类只使用公开导出字段（公司、来源、标题、描述），规则与顺序固定，结果可复现。
  var COMPANY_RULES = [
    ["quant", /quant|量化|hedge fund|高毅|幻方|九坤|明汯/i],
    ["bank", /bank|银行|农商行|信用社/i],
    ["soe", /国家电网|中国电信|中国移动|中国联通|中石油|中石化|中国邮政|央企|国有/i],
    ["finance", /证券|保险|基金|金融|capital|securities|insurance/i],
    ["unicorn", /独角兽|小红书|滴滴|大疆|商汤|地平线|蔚来|小鹏|理想汽车/i],
    ["bigtech", /字节|bytedance|腾讯|tencent|阿里|alibaba|百度|baidu|京东|美团|快手|华为|小米|网易|拼多多/i],
    ["foreign", /apple|microsoft|google|amazon|meta|netflix|tesla|nvidia|intel|ibm|oracle|sap|siemens|bosch|stripe|palantir|外企/i]
  ];

  var ROLE_RULES = [
    ["data", /机器学习|人工智能|算法|数据科学|数据分析|数据平台|大模型|深度学习|machine learning|\bai\b|data scien|data analy|data engineer|research scientist/i],
    ["product", /产品经理|产品运营|product manager|product owner/i],
    ["design", /设计|交互|用户体验|视觉|designer|\bux\b|\bui\b/i],
    ["operations", /运营|客服|客户成功|内容审核|operation|customer success|support/i],
    ["sales", /销售|市场|商务|客户经理|渠道|营销|sales|marketing|business development/i],
    ["finance", /财务|会计|审计|投研|投资|风控|精算|finance|accounting|audit|risk/i],
    ["people", /人力|招聘|行政|法务|合规|采购|human resources|recruit|legal|compliance|admin/i],
    ["engineering", /工程师|开发|研发|架构|测试|运维|安全|云网|电网调度|software|engineer|developer|architect|\bsre\b|devops|security/i]
  ];

  function deriveCompanyCategories(j) {
    var explicit = getCategories(j).filter(function (c) { return c !== UNKNOWN; });
    var hay = [getCompany(j), getSource(j)].join(" ");
    var derived = [];
    COMPANY_RULES.forEach(function (rule) {
      if (rule[1].test(hay)) derived.push(rule[0]);
    });
    var combined = explicit.concat(derived).filter(function (v, i, a) { return a.indexOf(v) === i; });
    return combined.length ? combined : [UNKNOWN];
  }

  function deriveRole(j) {
    var hay = [getTitle(j), getDescription(j)].join(" ");
    for (var i = 0; i < ROLE_RULES.length; i++) {
      if (ROLE_RULES[i][1].test(hay)) return ROLE_RULES[i][0];
    }
    return "other";
  }

  function roleLabel(v) { return ROLE_LABELS[v] || ROLE_LABELS.other; }

  function getCity(j) {
    var v = asText(pick(j, ["city", "city_name", "work_city", "job_city"]));
    return v || UNKNOWN;
  }

  // 一条记录可能有多个类别（数组），也可能是单个字符串；缺失 → ["unknown"]
  function getCategories(j) {
    var raw = pick(j, ["company_category", "companyCategory", "company_categories", "category"]);
    if (raw === null || raw === undefined) return [UNKNOWN];
    var list = Array.isArray(raw) ? raw : [raw];
    var out = [];
    list.forEach(function (item) {
      var text = asText(item);
      var v = CATEGORY_ALIASES[text] || text.toLowerCase();
      if (v && out.indexOf(v) === -1) out.push(v);
    });
    return out.length ? out : [UNKNOWN];
  }

  function categoryLabel(v) {
    return CATEGORY_LABELS[v] || v;
  }

  // 北京识别：城市或地点字段命中「北京」/「Beijing」即视为北京岗位。
  function isBeijing(j) {
    var hay = (getCity(j) + " " + getLocation(j)).toLowerCase();
    return hay.indexOf("北京") !== -1 || hay.indexOf("beijing") !== -1;
  }

  function selectedValues(sel) {
    if (!sel) return [];
    var out = [];
    var opts = sel.options || [];
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].selected && opts[i].value) out.push(opts[i].value);
    }
    return out;
  }
  function getRawTime(j) {
    return pick(j, [
      "posted_at", "published_at", "publish_time", "postingDate",
      "date", "first_seen_at", "last_seen_at", "created_at", "updated_at"
    ]);
  }

  function getPostedTime(j) {
    return pick(j, ["posted_at", "published_at", "publish_time", "postingDate", "date", "created_at"]);
  }

  function getUpdatedTime(j) {
    return pick(j, ["last_seen_at", "updated_at", "last_updated", "fetched_at"]);
  }

  // ---------- time ----------

  function toDate(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw === "number") {
      var ms = raw > 1e12 ? raw : raw * 1000;
      var dn = new Date(ms);
      return isNaN(dn.getTime()) ? null : dn;
    }
    var s = String(raw).trim();
    if (/^\d+$/.test(s)) return toDate(Number(s));
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    d = new Date(s.replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function fmtDate(d) {
    if (!d) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function fmtDateTime(d) {
    if (!d) return "";
    return fmtDate(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fmtRaw(raw) {
    var d = toDate(raw);
    return d ? fmtDateTime(d) : (asText(raw) || "未知时间");
  }

  // ---------- DOM helpers ----------

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------- sources / meta ----------

  function normStatus(s) {
    var v = asText(pick(s, ["status", "state", "result"])).toLowerCase();
    if (v === "ok" || v === "success" || v === "succeeded") return "ok";
    if (v === "stale" || v === "outdated") return "stale";
    if (v === "failed" || v === "fail" || v === "error") return "failed";
    return v || "unknown";
  }

  function sourceName(s) {
    return asText(pick(s, ["name", "source", "id", "key", "slug"])) || "未知来源";
  }

  function sourceTime(s) {
    // NOTE: export.py 的 SourceReport 实际写出的字段是 last_updated，
    // 必须排在最前，否则降级提示会退化成「更早」。
    return pick(s, [
      "last_updated",
      "last_success_at", "last_ok_at", "last_successful_at",
      "fetched_at", "last_fetched_at", "last_run_at", "updated_at", "timestamp", "time"
    ]);
  }

  function sourceDetail(s) {
    return asText(pick(s, ["detail", "message", "error", "reason"]));
  }

  function sourceCount(s) {
    var v = pick(s, ["count", "total", "n"]);
    return typeof v === "number" ? v : null;
  }

  function statusLabel(st) {
    if (st === "ok") return "正常";
    if (st === "stale") return "数据陈旧";
    if (st === "failed") return "抓取失败";
    return "状态未知";
  }

  function statusClass(st) {
    if (st === "ok") return "badge-ok";
    if (st === "stale") return "badge-stale";
    if (st === "failed") return "badge-failed";
    return "badge-unknown";
  }

  function sourceBadge(s) {
    var st = normStatus(s);
    var name = sourceName(s);
    var t = sourceTime(s);
    var cnt = sourceCount(s);
    var detail = sourceDetail(s);
    var badge = el("span", "badge " + statusClass(st));
    badge.appendChild(el("span", "dot"));
    badge.appendChild(el("span", null, name + " · " + statusLabel(st) +
      (cnt !== null ? "（" + cnt + "）" : "")));
    badge.title = name + "：" + statusLabel(st) +
      (t ? "（数据时间 " + fmtRaw(t) + "）" : "") +
      (detail ? "｜" + detail : "");
    return badge;
  }

  function renderHeader() {
    var gen = pick(state.meta, ["generated_at", "generatedAt", "updated_at", "timestamp"]);
    $("generated-at").textContent = gen ? fmtRaw(gen) : "未知";

    var badges = $("source-badges");
    var warns = $("stale-warnings");
    clear(badges);
    clear(warns);

    var counts = { ok: 0, stale: 0, failed: 0, unknown: 0 };
    var abnormal = [];
    state.sources.forEach(function (s) {
      var st = normStatus(s);
      counts[st in counts ? st : "unknown"] += 1;
      if (st !== "ok") abnormal.push(s);
    });

    ["ok", "stale", "failed", "unknown"].forEach(function (st) {
      if (!counts[st]) return;
      var badge = el("span", "badge " + statusClass(st));
      badge.appendChild(el("span", "dot"));
      badge.appendChild(el("span", null, statusLabel(st) + " " + counts[st]));
      badges.appendChild(badge);
    });

    var allDetails = el("details", "source-details");
    allDetails.appendChild(el("summary", null, "查看全部 " + state.sources.length + " 个来源"));
    var allBadges = el("div", "badges source-detail-grid");
    state.sources.forEach(function (s) { allBadges.appendChild(sourceBadge(s)); });
    allDetails.appendChild(allBadges);
    badges.appendChild(allDetails);

    if (abnormal.length) {
      var warningDetails = el("details", "warning-details");
      warningDetails.appendChild(el("summary", null, "查看 " + abnormal.length + " 个异常来源详情"));
      abnormal.forEach(function (s) {
        var st = normStatus(s);
        var name = sourceName(s);
        var t = sourceTime(s);
        var cnt = sourceCount(s);
        var detail = sourceDetail(s);
        var when = t ? fmtRaw(t) : "更早";
        var line = el("div", "warn-line" + (st === "failed" ? " is-failed" : ""));
        if (st === "failed" && !cnt) {
          line.textContent = "来源「" + name + "」本次抓取失败，且没有可展示的旧数据。";
        } else {
          line.textContent = "来源「" + name + "」" +
            (st === "failed" ? "本次抓取失败" : "数据已陈旧") +
            "，展示的是 " + when + " 的旧数据。";
        }
        if (detail) line.textContent += "（" + detail + "）";
        warningDetails.appendChild(line);
      });
      warns.appendChild(warningDetails);
    }
  }

  // ---------- 数据源状态面板 + 覆盖率汇总 ----------

  // meta.json 里可能带一个数字型「配置公司总数」；缺失则回退到实际源条数。
  function configuredCount() {
    var v = pick(state.meta, [
      "configured_companies", "companies_configured", "total_companies",
      "companies", "configured_sources", "total_sources", "sources_configured", "sources"
    ]);
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
    if (Array.isArray(v)) return v.length;
    return null;
  }

  // 面板数据：优先 meta.json 内嵌的源列表，否则用 sources.json。
  function panelSources() {
    var fromMeta = toArray(
      pick(state.meta, ["sources", "source_reports", "companies", "results"]),
      ["sources", "items", "data"]
    );
    if (fromMeta.length) return fromMeta;
    return state.sources || [];
  }

  function renderSourcePanel() {
    var tbody = $("source-panel-rows");
    var emptyHint = $("source-panel-empty");
    var summaryNode = $("source-panel-summary");
    if (!tbody) return [];

    var rows = panelSources();
    clear(tbody);

    rows.forEach(function (s) {
      var st = normStatus(s);
      var tr = el("tr", "source-row status-" + st);
      tr.appendChild(el("td", "src-name", sourceName(s)));

      var tdStatus = el("td", "src-status");
      var badge = el("span", "status-pill pill-" + st, statusLabel(st));
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      var cnt = sourceCount(s);
      tr.appendChild(el("td", "src-count", cnt === null ? "未知" : String(cnt)));

      var t = sourceTime(s);
      tr.appendChild(el("td", "src-time", t ? fmtRaw(t) : "未知"));

      var detail = sourceDetail(s);
      tr.appendChild(el("td", "src-detail", detail || (st === "failed" ? "未知" : "—")));

      tbody.appendChild(tr);
    });

    if (emptyHint) emptyHint.hidden = rows.length !== 0;
    if (summaryNode) {
      summaryNode.textContent = rows.length
        ? "数据源状态（" + rows.length + " 条记录，点击展开）"
        : "数据源状态（暂无记录，点击展开）";
    }
    return rows;
  }

  function renderCoverage(rows) {
    var node = $("coverage-summary");
    if (!node) return;

    var ok = 0, failed = 0;
    (rows || []).forEach(function (s) {
      var st = normStatus(s);
      if (st === "ok") ok += 1;
      else failed += 1; // stale / failed / unknown 一律不计入「成功」
    });

    var configured = configuredCount();
    var configuredText = configured === null ? "未知" : String(configured);
    var jobCount = state.jobs.length;

    node.textContent = "本次共 " + configuredText + " 家配置公司，成功 " + ok +
      " 家，失败 " + failed + " 家，展示职位 " + jobCount + " 条";
  }

  // ---------- filters ----------

  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) {
      if (!v || seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    return out.sort(function (a, b) { return a.localeCompare(b, "zh-Hans-CN"); });
  }

  function fillSelect(sel, values, allLabel) {
    var prev = sel.value;
    clear(sel);
    sel.appendChild(new Option(allLabel, ""));
    values.forEach(function (v) { sel.appendChild(new Option(v, v)); });
    if (values.indexOf(prev) !== -1) sel.value = prev;
  }

  // 城市下拉：真实城市按拼音排序，unknown 固定放在最后，标签为「未知城市」
  function fillCitySelect(sel, jobs) {
    if (!sel) return;
    var prev = sel.value;
    var cities = uniqueSorted(jobs.map(getCity).filter(function (c) { return c !== UNKNOWN; }));
    var hasUnknown = jobs.some(function (j) { return getCity(j) === UNKNOWN; });
    clear(sel);
    sel.appendChild(new Option("全部城市", ""));
    cities.forEach(function (c) { sel.appendChild(new Option(c, c)); });
    if (hasUnknown) sel.appendChild(new Option("未知城市", UNKNOWN));
    var values = cities.concat(hasUnknown ? [UNKNOWN] : []);
    if (values.indexOf(prev) !== -1) sel.value = prev;
  }

  // 公司类别多选：固定 7 类 + unknown；数据里出现的未知取值也补进来，避免筛不到
  function syncCategorySelect(sel, jobs) {
    if (!sel) return;
    var known = {};
    var i;
    for (i = 0; i < sel.options.length; i++) known[sel.options[i].value] = true;
    var extra = [];
    jobs.forEach(function (j) {
      getCategories(j).forEach(function (c) {
        if (!known[c] && extra.indexOf(c) === -1) extra.push(c);
      });
    });
    extra.sort().forEach(function (c) { sel.appendChild(new Option(categoryLabel(c), c)); });
  }

  function buildFilters() {
    fillSelect($("filter-company"), uniqueSorted(state.jobs.map(getCompany)), "全部公司");
    fillSelect($("filter-location"), uniqueSorted(state.jobs.map(getLocation)), "全部地点");
    fillCitySelect($("filter-city"), state.jobs);
    syncCategorySelect($("filter-category"), state.jobs);
    fillSelect($("filter-role"), uniqueSorted(state.jobs.map(deriveRole).map(roleLabel)), "全部岗位类别");
  }

  function sourceForJob(j) {
    var wanted = getSource(j).toLowerCase();
    for (var i = 0; i < state.sources.length; i++) {
      if (sourceName(state.sources[i]).toLowerCase() === wanted) return state.sources[i];
    }
    return null;
  }

  function filterAndSortJobs(jobs, criteria) {
    criteria = criteria || {};
    var kw = (criteria.keyword || "").trim().toLowerCase();
    var cats = criteria.categories || [];
    var rows = jobs.filter(function (j) {
      if (criteria.onlyBeijing && !isBeijing(j)) return false;
      if (criteria.company && getCompany(j) !== criteria.company) return false;
      if (criteria.location && getLocation(j) !== criteria.location) return false;
      if (criteria.city && getCity(j) !== criteria.city) return false;
      if (criteria.role && roleLabel(deriveRole(j)) !== criteria.role) return false;
      if (cats.length) {
        var jc = deriveCompanyCategories(j);
        if (!cats.some(function (c) { return jc.indexOf(c) !== -1; })) return false;
      }
      if (kw) {
        var hay = [getTitle(j), getCompany(j), getLocation(j), getSource(j), getDescription(j),
          deriveCompanyCategories(j).map(categoryLabel).join(" "), roleLabel(deriveRole(j))].join(" ").toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });

    rows.sort(function (a, b) {
      var da = toDate(getRawTime(a));
      var db = toDate(getRawTime(b));
      var ta = da ? da.getTime() : null;
      var tb = db ? db.getTime() : null;
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return criteria.order === "asc" ? ta - tb : tb - ta;
    });
    return rows;
  }

  function currentView() {
    return filterAndSortJobs(state.jobs, {
      company: $("filter-company").value,
      location: $("filter-location").value,
      city: $("filter-city") ? $("filter-city").value : "",
      categories: selectedValues($("filter-category")),
      role: $("filter-role") ? $("filter-role").value : "",
      keyword: $("filter-keyword").value,
      order: $("sort-order").value,
      onlyBeijing: $("only-beijing") ? $("only-beijing").checked : false
    });
  }

  function renderJobs() {
    var rows = currentView();
    var list = $("job-list");
    clear(list);

    $("result-count").textContent = "共 " + rows.length + " 条职位（总计 " + state.jobs.length + " 条）";
    var emptyHint = $("empty-hint");
    emptyHint.hidden = rows.length !== 0;
    if (rows.length === 0) {
      emptyHint.textContent = state.jobs.length === 0
        ? "暂无职位数据。"
        : "没有符合条件的职位，请放宽筛选条件或点击「重置」。";
    }

    var hlBJ = $("highlight-beijing") ? $("highlight-beijing").checked : true;

    rows.forEach(function (j) {
      var bj = isBeijing(j);
      var li = el("li", "job-card" + (bj && hlBJ ? " is-beijing" : ""));
      var h = el("h2", "job-title");
      var title = getTitle(j) || PLACEHOLDER;
      var url = getUrl(j);
      if (url) {
        var a = el("a", null, title);
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        h.appendChild(a);
      } else {
        h.appendChild(el("span", "plain", title));
      }
      li.appendChild(h);

      var meta = el("div", "job-meta");
      if (bj) meta.appendChild(el("span", "tag-bj", "北京"));
      var company = getCompany(j) || PLACEHOLDER;
      meta.appendChild(el("span", "company", "公司：" + company));
      var loc = getLocation(j) || PLACEHOLDER;
      meta.appendChild(el("span", null, "地点：" + loc));
      var posted = toDate(getPostedTime(j));
      meta.appendChild(el("span", null, "发布时间：" + (posted ? fmtDate(posted) : PLACEHOLDER)));
      var updated = toDate(getUpdatedTime(j));
      meta.appendChild(el("span", null, "更新时间：" + (updated ? fmtDateTime(updated) : PLACEHOLDER)));
      var src = getSource(j) || PLACEHOLDER;
      meta.appendChild(el("span", null, "来源：" + src));
      var sourceRecord = sourceForJob(j);
      var sourceStatus = sourceRecord ? normStatus(sourceRecord) : ((j.stale === true) ? "stale" : "unknown");
      meta.appendChild(el("span", "status-pill pill-" + sourceStatus, "源状态：" + statusLabel(sourceStatus)));
      li.appendChild(meta);

      var taxonomy = el("div", "taxonomy");
      deriveCompanyCategories(j).forEach(function (category) {
        taxonomy.appendChild(el("span", "taxonomy-tag", "公司类别：" + categoryLabel(category)));
      });
      taxonomy.appendChild(el("span", "taxonomy-tag", "岗位类别：" + roleLabel(deriveRole(j))));
      li.appendChild(taxonomy);

      var facts = el("div", "job-facts");
      var employment = getEmploymentType(j);
      var remote = getRemote(j);
      var typeText = employment || PLACEHOLDER;
      if (remote) typeText += (employment ? " · " : "") + remote;
      facts.appendChild(el("div", employment || remote ? "job-fact" : "job-fact is-missing", "类型：" + typeText));

      var salary = getSalary(j);
      facts.appendChild(el("div", salary ? "job-fact" : "job-fact is-missing", "薪资：" + (salary || PLACEHOLDER)));

      var experience = getExperience(j);
      facts.appendChild(el("div", experience && experience !== UNKNOWN ? "job-fact" : "job-fact is-missing", "经验：" + (experience && experience !== UNKNOWN ? experience : PLACEHOLDER)));

      var education = getEducation(j);
      facts.appendChild(el("div", education && education !== UNKNOWN ? "job-fact" : "job-fact is-missing", "学历：" + (education && education !== UNKNOWN ? educationLabel(education) : PLACEHOLDER)));
      li.appendChild(facts);

      var description = getDescription(j);
      li.appendChild(el(
        "p",
        description ? "job-summary" : "job-summary is-missing",
        "职位描述：" + (description || PLACEHOLDER)
      ));

      var link = getUrl(j);
      if (link) {
        var original = el("a", "original-link", "查看原始招聘链接 ↗");
        original.href = link;
        original.target = "_blank";
        original.rel = "noopener noreferrer";
        li.appendChild(original);
      } else {
        li.appendChild(el("span", "original-link is-missing", "原始招聘链接：" + PLACEHOLDER));
      }

      list.appendChild(li);
    });
  }

  // ---------- loading ----------

  function loadJson(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path + " → HTTP " + r.status);
      return r.json();
    });
  }

  function toArray(v, keys) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      for (var i = 0; i < keys.length; i++) {
        if (Array.isArray(v[keys[i]])) return v[keys[i]];
      }
      // object map form: { "apple": {...}, ... }
      var out = [];
      Object.keys(v).forEach(function (k) {
        if (v[k] && typeof v[k] === "object") {
          var item = {};
          Object.keys(v[k]).forEach(function (kk) { item[kk] = v[k][kk]; });
          if (item.name === undefined) item.name = k;
          out.push(item);
        }
      });
      return out;
    }
    return [];
  }

  function showError(msg) {
    var box = $("error-box");
    box.hidden = false;
    clear(box);
    box.appendChild(el("strong", null, "职位数据加载失败"));
    box.appendChild(el("p", null, msg));
    box.appendChild(el("p", null, "页面仍可正常使用，但暂时没有职位可展示。请确认 site/data/ 下存在 jobs.json、sources.json、meta.json，并通过 HTTP 服务打开页面（例如在 site/ 目录执行 python3 -m http.server 后访问 http://localhost:8000/）。"));
  }

  function init() {
    ["filter-company", "filter-location", "filter-city", "filter-category", "filter-role", "sort-order", "highlight-beijing", "only-beijing"].forEach(function (id) {
      var node = $(id);
      if (node) node.addEventListener("change", renderJobs);
    });
    $("filter-keyword").addEventListener("input", renderJobs);
    $("reset-btn").addEventListener("click", function () {
      $("filter-company").value = "";
      $("filter-location").value = "";
      if ($("filter-city")) $("filter-city").value = "";
      if ($("filter-role")) $("filter-role").value = "";
      var cat = $("filter-category");
      if (cat) {
        for (var i = 0; i < cat.options.length; i++) cat.options[i].selected = false;
      }
      $("filter-keyword").value = "";
      $("sort-order").value = "desc";
      if ($("highlight-beijing")) $("highlight-beijing").checked = true;
      if ($("only-beijing")) $("only-beijing").checked = false;
      renderJobs();
    });

    Promise.all([
      loadJson("data/jobs.json").then(
        function (v) { return { ok: true, value: v }; },
        function (e) { return { ok: false, error: e }; }
      ),
      loadJson("data/sources.json").catch(function () { return []; }),
      loadJson("data/meta.json").catch(function () { return {}; })
    ]).then(function (res) {
      var jobsRes = res[0];
      state.jobs = jobsRes.ok ? toArray(jobsRes.value, ["jobs", "items", "data", "results"]) : [];
      state.sources = toArray(res[1], ["sources", "items", "data"]);
      state.meta = (res[2] && typeof res[2] === "object" && !Array.isArray(res[2])) ? res[2] : {};

      // 即使 jobs.json 缺失/损坏，页面仍然可用：渲染头部与空列表 + 友好提示，不白屏。
      renderHeader();
      renderCoverage(renderSourcePanel());
      buildFilters();
      renderJobs();

      if (!jobsRes.ok) {
        showError(String((jobsRes.error && jobsRes.error.message) || jobsRes.error));
      }
    }).catch(function (err) {
      showError(String((err && err.message) || err));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  var api = { toDate: toDate, pick: pick, asText: asText, toArray: toArray,
    normStatus: normStatus, getCity: getCity, getCategories: getCategories,
    deriveCompanyCategories: deriveCompanyCategories, deriveRole: deriveRole,
    roleLabel: roleLabel, filterAndSortJobs: filterAndSortJobs,
    sourceTime: sourceTime, sourceName: sourceName, isBeijing: isBeijing };
  if (typeof window !== "undefined") window.JobRadar = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
