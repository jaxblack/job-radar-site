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
    return pick(s, [
      "last_success_at", "last_ok_at", "last_successful_at",
      "fetched_at", "last_fetched_at", "last_run_at", "updated_at", "timestamp", "time"
    ]);
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

      var b = el("span", "badge " + cls);
      b.appendChild(el("span", "dot"));
      b.appendChild(el("span", null, name + " · " + statusLabel(st)));
      b.title = name + "：" + statusLabel(st) + (t ? "（" + fmtRaw(t) + "）" : "");
      badges.appendChild(b);

      if (st !== "ok") {
        var when = t ? fmtRaw(t) : "更早";
        var line = el("div", "warn-line" + (st === "failed" ? " is-failed" : ""));
        line.textContent = "⚠️ 来源「" + name + "」" +
          (st === "failed" ? "本次抓取失败" : "数据已陈旧") +
          "，展示的是 " + when + " 的旧数据。";
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

  function buildFilters() {
    fillSelect($("filter-company"), uniqueSorted(state.jobs.map(getCompany)), "全部公司");
    fillSelect($("filter-location"), uniqueSorted(state.jobs.map(getLocation)), "全部地点");
  }

  function currentView() {
    var company = $("filter-company").value;
    var location = $("filter-location").value;
    var kw = $("filter-keyword").value.trim().toLowerCase();
    var order = $("sort-order").value;

    var rows = state.jobs.filter(function (j) {
      if (company && getCompany(j) !== company) return false;
      if (location && getLocation(j) !== location) return false;
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
    $("empty-hint").hidden = rows.length !== 0;

    rows.forEach(function (j) {
      var li = el("li", "job-card");
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
    box.appendChild(el("strong", null, "数据加载失败"));
    box.appendChild(el("p", null, msg));
    box.appendChild(el("p", null, "请确认 site/data/ 下存在 jobs.json、sources.json、meta.json，并通过 HTTP 服务打开页面（例如在 site/ 目录执行 python3 -m http.server 后访问 http://localhost:8000/）。"));
    $("generated-at").textContent = "不可用";
    $("result-count").textContent = "";
  }

  function init() {
    ["filter-company", "filter-location", "sort-order"].forEach(function (id) {
      $(id).addEventListener("change", renderJobs);
    });
    $("filter-keyword").addEventListener("input", renderJobs);
    $("reset-btn").addEventListener("click", function () {
      $("filter-company").value = "";
      $("filter-location").value = "";
      $("filter-keyword").value = "";
      $("sort-order").value = "desc";
      renderJobs();
    });

    Promise.all([
      loadJson("data/jobs.json"),
      loadJson("data/sources.json").catch(function () { return []; }),
      loadJson("data/meta.json").catch(function () { return {}; })
    ]).then(function (res) {
      state.jobs = toArray(res[0], ["jobs", "items", "data", "results"]);
      state.sources = toArray(res[1], ["sources", "items", "data"]);
      state.meta = (res[2] && typeof res[2] === "object" && !Array.isArray(res[2])) ? res[2] : {};
      renderHeader();
      buildFilters();
      renderJobs();
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
    module.exports = { toDate: toDate, pick: pick, asText: asText, toArray: toArray, normStatus: normStatus };
  }
})();
