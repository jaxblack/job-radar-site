/* Job Radar static frontend — vanilla JS, no build step. */
(function () {
  "use strict";

  var state = { jobs: [], sources: [], meta: {} };

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
      var v = asText(item).toLowerCase();
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

  function renderHeader() {
    var gen = pick(state.meta, ["generated_at", "generatedAt", "updated_at", "timestamp"]);
    $("generated-at").textContent = gen ? fmtRaw(gen) : "未知";

    var badges = $("source-badges");
    var warns = $("stale-warnings");
    clear(badges);
    clear(warns);

    state.sources.forEach(function (s) {
      var st = normStatus(s);
      var name = sourceName(s);
      var t = sourceTime(s);
      var cls = st === "ok" ? "badge-ok" : st === "stale" ? "badge-stale" : st === "failed" ? "badge-failed" : "badge-unknown";

      var cnt = sourceCount(s);
      var detail = sourceDetail(s);

      var b = el("span", "badge " + cls);
      b.appendChild(el("span", "dot"));
      b.appendChild(el("span", null, name + " · " + statusLabel(st) +
        (cnt !== null ? "（" + cnt + "）" : "")));
      b.title = name + "：" + statusLabel(st) +
        (t ? "（数据时间 " + fmtRaw(t) + "）" : "") +
        (detail ? "｜" + detail : "");
      badges.appendChild(b);

      if (st !== "ok") {
        var when = t ? fmtRaw(t) : "更早";
        var line = el("div", "warn-line" + (st === "failed" ? " is-failed" : ""));
        if (st === "failed" && !cnt) {
          line.textContent = "⚠️ 来源「" + name + "」本次抓取失败，且没有可展示的旧数据。";
        } else {
          line.textContent = "⚠️ 来源「" + name + "」" +
            (st === "failed" ? "本次抓取失败" : "数据已陈旧") +
            "，展示的是 " + when + " 的旧数据。";
        }
        if (detail) line.textContent += "（" + detail + "）";
        warns.appendChild(line);
      }
    });
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
  }

  function currentView() {
    var company = $("filter-company").value;
    var location = $("filter-location").value;
    var city = $("filter-city") ? $("filter-city").value : "";
    var cats = selectedValues($("filter-category"));
    var kw = $("filter-keyword").value.trim().toLowerCase();
    var order = $("sort-order").value;
    var onlyBJ = $("only-beijing") ? $("only-beijing").checked : false;

    var rows = state.jobs.filter(function (j) {
      if (onlyBJ && !isBeijing(j)) return false;
      if (company && getCompany(j) !== company) return false;
      if (location && getLocation(j) !== location) return false;
      if (city && getCity(j) !== city) return false;
      if (cats.length) {
        var jc = getCategories(j);
        var hit = cats.some(function (c) { return jc.indexOf(c) !== -1; });
        if (!hit) return false;
      }
      if (kw) {
        var hay = [getTitle(j), getCompany(j), getLocation(j), getSource(j)].join(" ").toLowerCase();
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
      if (ta === null) return 1;   // undated always last
      if (tb === null) return -1;
      return order === "asc" ? ta - tb : tb - ta;
    });

    return rows;
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
      var title = getTitle(j) || "（无标题）";
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
      var company = getCompany(j);
      if (company) meta.appendChild(el("span", "company", company));
      var loc = getLocation(j);
      if (loc) meta.appendChild(el("span", null, "📍 " + loc));
      var d = toDate(getRawTime(j));
      meta.appendChild(el("span", null, "🕒 " + (d ? fmtDate(d) : "时间未知")));
      var src = getSource(j);
      if (src && src !== company) meta.appendChild(el("span", null, "来源：" + src));
      li.appendChild(meta);

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
    ["filter-company", "filter-location", "filter-city", "filter-category", "sort-order", "highlight-beijing", "only-beijing"].forEach(function (id) {
      var node = $(id);
      if (node) node.addEventListener("change", renderJobs);
    });
    $("filter-keyword").addEventListener("input", renderJobs);
    $("reset-btn").addEventListener("click", function () {
      $("filter-company").value = "";
      $("filter-location").value = "";
      if ($("filter-city")) $("filter-city").value = "";
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

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { toDate: toDate, pick: pick, asText: asText, toArray: toArray, normStatus: normStatus, getCity: getCity, getCategories: getCategories, sourceTime: sourceTime, sourceName: sourceName, isBeijing: isBeijing };
  }
})();
