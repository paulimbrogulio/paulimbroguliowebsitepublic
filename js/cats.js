/**
 * cats.js
 * -----------------------------------------------------------------------
 * Real predictions for Bean and Toffee, running entirely in the browser.
 *
 * There is no server here and no model here. The model lives in
 * cat_predictor.py and can't run in a browser — but its whole input space is
 * (day-of-week, hour, quarter-hour), so export_predictions.py enumerates every
 * cell offline and ships the answers as window.CAT_DATA. Everything below is
 * table lookups over that data.
 *
 * The one thing this file does reimplement is cat_chat.py's question parsing —
 * intent routing, time expressions, confidence wording. Those are ports, and
 * the thresholds are kept identical so the site and the terminal agree.
 *
 * Data contract (see export_predictions.py):
 *   CAT_DATA.buckets      ["Bedroom", "Living Room", ...]
 *   CAT_DATA.tags         interned specific-spot strings
 *   CAT_DATA.cats[name].night  [[bucketIdx, prob, tagIdx], ...]
 *   CAT_DATA.cats[name].day    336 such rows, indexed by slotIndex()
 * ----------------------------------------------------------------------- */

const D = window.CAT_DATA;
const CAT_NAMES = ["Bean", "Toffee"];

/* Fallback dot position per bucket, in the floor-plan SVG (viewBox 0 0 300 470).
   Used only when a cat's specific spot has no entry in SPOT_POINTS below — a
   new label in the form data, most likely. "On a lap" is the one bucket that
   isn't a room; it's the living-room couch, kept separate because "which room"
   and "on a person" are different answers.
   Only edit if you also move the <rect> shapes in cats.html. */
const BUCKET_POINTS = {
  Bedroom: { x: 174, y: 68 },
  Bathroom: { x: 232, y: 161 },
  Office: { x: 200, y: 245 },
  "Living Room": { x: 66, y: 350 },
  "On a lap": { x: 148, y: 393 },
};

/* Where each *specific spot* sits. This is what the dots actually use, so a cat
   predicted on the climbing wall is drawn on the climbing wall rather than in
   the middle of the office.

   Keys must match the tag strings in BUCKET_MAP (export_predictions.py) exactly
   — a typo doesn't throw, it silently falls back to the room centroid. Values
   are the centres of the <rect> shapes in cats.html; move a rect, move the
   point.

   Conventions, chosen once so they stay consistent:
     - Bed: Paul on the left, Sarah on the right. Head = upper half, feet =
       lower half, "under" and "between you both" = dead centre. Those last two
       deliberately share a point with "on the bed"; all three are rare enough
       that the overlap costs nothing.
     - Couch: Paul's lap is the upper cushion, Sarah's the lower.
     - Floor tags go to an empty part of the room, clear of every rect, so a
       floor dot never looks like it's sitting on the furniture. */
const SPOT_POINTS = {
  // Bedroom — bed rect is x 140-208, y 21-114.
  "by Paul's head": { x: 157, y: 44 },
  "by Sarah's head": { x: 191, y: 44 },
  "on Paul's feet": { x: 157, y: 91 },
  "on Sarah's feet": { x: 191, y: 91 },
  "on the bed": { x: 174, y: 68 },
  "under the bed": { x: 174, y: 68 },
  "between you both": { x: 174, y: 68 },
  "on the bedroom floor": { x: 240, y: 48 },   // right of the bed, above the closet
  "on the floor": { x: 240, y: 48 },           // unqualified "floor" buckets to Bedroom

  // Bathroom.
  "in the bathroom closet": { x: 143, y: 150 },

  // Office.
  "on Sarah's desk": { x: 183, y: 214 },
  "on the green dresser": { x: 259, y: 214 },
  "on Paul's desk": { x: 270, y: 262 },
  "in the office closet": { x: 132, y: 240 },
  "climbing wall": { x: 143, y: 292 },
  "on the office floor": { x: 205, y: 256 },   // gap below the desks, right of the closet

  // Living room — the kitchen table is furniture in here, not a room.
  "cat tree": { x: 34, y: 419 },
  "in the box": { x: 264, y: 325 },
  floating: { x: 271, y: 381 },
  "on the kitchen table": { x: 209, y: 393 },
  "on the living room floor": { x: 86, y: 390 },  // left of the couch, above the tree

  // On a lap — one cushion each.
  "Paul's lap": { x: 148, y: 380 },
  "Sarah's lap": { x: 148, y: 424 },
};

/* "in the office", but "on a lap" — the one bucket that isn't a room doesn't
   take "in the". */
const BUCKET_PHRASE = {
  "On a lap": "on a lap",
};

function bucketPhrase(bucket) {
  return BUCKET_PHRASE[bucket] || "in the " + bucket.toLowerCase();
}

/* Words a visitor might type -> bucket. Checked longest-first so "cat tree"
   wins over "tree" and "office closet" doesn't get grabbed by "closet". */
const BUCKET_ALIASES = {
  "on a lap": "On a lap",
  lap: "On a lap",
  laps: "On a lap",
  bedroom: "Bedroom",
  bed: "Bedroom",
  "under the bed": "Bedroom",
  "living room": "Living Room",
  lounge: "Living Room",
  couch: "Living Room",
  sofa: "Living Room",
  "cat tree": "Living Room",
  tree: "Living Room",
  box: "Living Room",
  floating: "Living Room",
  office: "Office",
  "climbing wall": "Office", // installed Jul 2026, mounted in the office
  wall: "Office",
  climbing: "Office",
  desk: "Office",
  desks: "Office",
  dresser: "Office",
  "green dresser": "Office",
  study: "Office",
  // The house has no kitchen — the table stands in the living room, so both
  // spellings resolve there. The answer still names the table, because the
  // spot tag ("on the kitchen table") survives the bucketing.
  kitchen: "Living Room",
  "kitchen table": "Living Room",
  // Deliberately no bare "table" alias — the raw data calls the desks
  // "Table - Paul Desk" too, so an unqualified "table" is ambiguous.
  bathroom: "Bathroom",
  closet: "Office", // green dresser + office closet dominate the closet counts
};

const WEEKDAYS = [
  "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday", "sunday",
];

/* ----------------------------------------------------------------------
   Core lookup
   ---------------------------------------------------------------------- */

function isNight(date) {
  const h = date.getHours();
  return h >= D.nightStartHour || h < D.dayStartHour;
}

/**
 * Index into the flat 336-cell day grid.
 * Layout mirrors the emit order in export_predictions.py:
 *   dow (0=Mon) -> hour (8..19) -> quarter-hour bin (0..3)
 * JS getDay() is 0=Sunday, so it's shifted to match Python's weekday().
 */
function slotIndex(date) {
  const dow = (date.getDay() + 6) % 7;
  const hourOffset = date.getHours() - D.dayStartHour;
  const bin = Math.floor(date.getMinutes() / 15);
  return dow * D.slotsPerDay + hourOffset * 4 + bin;
}

/** Ranked buckets for one cat at one moment. */
function predict(cat, date) {
  const c = D.cats[cat];
  const night = isNight(date);
  const row = night ? c.night : c.day[slotIndex(date)];
  return {
    night: night,
    ranked: row.map(function (r) {
      return { bucket: D.buckets[r[0]], prob: r[1], tag: D.tags[r[2]] };
    }),
  };
}

/** Probability that `cat` is in `bucket` at `date` (0 if outside the top 5). */
function probOf(cat, bucket, date) {
  const hit = predict(cat, date).ranked.filter(function (r) {
    return r.bucket === bucket;
  })[0];
  return hit ? hit.prob : 0;
}

/* Same thresholds as _fmt_prob() in cat_chat.py — keep these in sync. */
function confidenceWord(p) {
  if (p >= 0.7) return "very likely";
  if (p >= 0.45) return "likely";
  if (p >= 0.25) return "possibly";
  return "unlikely but possible";
}

/**
 * Port of when_at_location() in cat_predictor.py: sweep the next 7 days and
 * find when this cat is most often in `bucket`.
 *
 * Consecutive hours with an identical probability collapse into one window,
 * the same way when_at_location() does in Python. This matters more than it
 * used to: the daytime model is now a flat frequency table, so every hour from
 * 8am to 8pm ties exactly, and listing them separately would present five
 * arbitrary hours as though they were a ranking. Nights already tied this way.
 *
 * If the Random Forest is ever switched back on (USE_DAY_FOREST in
 * cat_predictor.py), hours stop tying and this naturally splits them again.
 */
function whenAtBucket(cat, bucket, from) {
  const seen = {};
  const out = [];

  for (let i = 0; i < 7 * 24 * 2; i++) {
    const dt = new Date(from.getTime() + i * 30 * 60 * 1000);
    const dow = (dt.getDay() + 6) % 7;
    const night = isNight(dt);
    const key = night ? "night:" + dow : "day:" + dow + ":" + dt.getHours();
    if (seen[key]) continue;
    seen[key] = true;

    const prob = probOf(cat, bucket, dt);
    const prev = out[out.length - 1];

    // Extend the open window while the day, the day/night half and the
    // probability are all unchanged.
    if (prev && !night && !prev.night && prev.dow === dow &&
        prev.prob === prob) {
      prev.endHour = dt.getHours();
      continue;
    }
    out.push({
      when: dt, night: night, dow: dow, prob: prob,
      startHour: dt.getHours(), endHour: dt.getHours(),
    });
  }

  return out
    .filter(function (w) { return w.prob > 0; })
    .sort(function (a, b) { return b.prob - a.prob; })
    .slice(0, 5);
}

/* ----------------------------------------------------------------------
   Formatting helpers
   ---------------------------------------------------------------------- */

function hourLabel(h) {
  const suffix = h >= 12 ? "pm" : "am";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return twelve + suffix;
}

function dayName(dow) {
  const n = WEEKDAYS[dow];
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Compact form, for the label column of a results row. */
function windowLabel(w) {
  if (w.night) {
    return dayName(w.dow) + " night (" +
      hourLabel(D.nightStartHour) + "–" + hourLabel(D.dayStartHour) + ")";
  }
  if (w.endHour > w.startHour) {
    return dayName(w.dow) + " " + hourLabel(w.startHour) + "–" +
      hourLabel(w.endHour + 1);
  }
  return dayName(w.dow) + " " + hourLabel(w.startHour);
}

/** Sentence form, for prose. Kept separate so day names stay capitalised. */
function windowPhrase(w) {
  if (w.night) return "overnight on " + dayName(w.dow);
  if (w.endHour > w.startHour) {
    return "on " + dayName(w.dow) + " between " + hourLabel(w.startHour) +
      " and " + hourLabel(w.endHour + 1);
  }
  return "on " + dayName(w.dow) + " around " + hourLabel(w.startHour);
}

function timeLabel(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return twelve + (m ? ":" + String(m).padStart(2, "0") : "") + suffix;
}

/* ----------------------------------------------------------------------
   Question parsing — ported from cat_chat.py
   ---------------------------------------------------------------------- */

function parseCats(text) {
  const found = CAT_NAMES.filter(function (c) {
    return new RegExp("\\b" + c + "\\b", "i").test(text);
  });
  return found.length ? found : CAT_NAMES;
}

function parseBucket(text) {
  const lower = text.toLowerCase();
  // Longest alias first, so "cat tree" beats "tree".
  const keys = Object.keys(BUCKET_ALIASES).sort(function (a, b) {
    return b.length - a.length;
  });
  for (const k of keys) {
    if (new RegExp("\\b" + k.replace(/ /g, "\\s+") + "\\b").test(lower)) {
      return BUCKET_ALIASES[k];
    }
  }
  return null;
}

/**
 * Resolve a time expression to a Date, or null if there isn't one.
 * Ports the am/pm and weekday arithmetic from cat_chat.py, including the
 * `% 7 or 7` rule: "Friday" said on a Friday means *next* Friday, not today.
 */
function parseTime(text, now) {
  const lower = text.toLowerCase();
  const target = new Date(now.getTime());
  let matched = false;

  const wdIndex = WEEKDAYS.findIndex(function (d) {
    return new RegExp("\\b" + d + "\\b").test(lower);
  });
  if (wdIndex !== -1) {
    const current = (now.getDay() + 6) % 7;
    const diff = (wdIndex - current) % 7 || 7;
    target.setDate(target.getDate() + diff);
    target.setHours(12, 0, 0, 0);
    matched = true;
  }

  if (/\btomorrow\b/.test(lower)) {
    target.setDate(target.getDate() + 1);
    target.setHours(12, 0, 0, 0);
    matched = true;
  }

  // Named parts of the day. "tonight" is treated as 10pm today.
  if (/\btonight\b/.test(lower)) { target.setHours(22, 0, 0, 0); matched = true; }
  else if (/\bmorning\b/.test(lower)) { target.setHours(9, 0, 0, 0); matched = true; }
  else if (/\bafternoon\b/.test(lower)) { target.setHours(15, 0, 0, 0); matched = true; }
  else if (/\bevening\b/.test(lower)) { target.setHours(19, 0, 0, 0); matched = true; }
  else if (/\b(midnight|overnight)\b/.test(lower)) { target.setHours(0, 0, 0, 0); matched = true; }
  else if (/\bnight\b/.test(lower)) { target.setHours(23, 0, 0, 0); matched = true; }
  else if (/\bnoon|lunch\b/.test(lower)) { target.setHours(12, 0, 0, 0); matched = true; }

  // Explicit clock time wins over the named part of day.
  const clock = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (clock) {
    let hour = parseInt(clock[1], 10);
    const min = clock[2] ? parseInt(clock[2], 10) : 0;
    const meridiem = clock[3];
    if (meridiem === "pm" && hour < 12) hour += 12;
    else if (meridiem === "am" && hour === 12) hour = 0;
    if (hour <= 23) {
      target.setHours(hour, min, 0, 0);
      matched = true;
    }
  }

  return matched ? target : null;
}

/**
 * Route to an intent. Order matters and mirrors cat_chat.py:
 * "when" beats "now" beats "future".
 */
function parseIntent(text) {
  const lower = text.toLowerCase();

  if (/\b(who|which cat|more likely|compare)\b/.test(lower)) return "compare";
  if (/\b(when|what time|likely to be at|usually|tend to|often)\b/.test(lower)) return "when";
  if (/\b(right now|currently|at the moment)\b/.test(lower)) return "now";
  if (/\b(will|going to|tomorrow|tonight)\b/.test(lower)) return "future";
  if (/\b(where is|where's|where are|where do|where does)\b/.test(lower)) return "now";
  return "unknown";
}

/* ----------------------------------------------------------------------
   Answering
   ---------------------------------------------------------------------- */

function answerNow(cats, at, headingOverride) {
  const when = at || new Date();
  const sections = cats.map(function (cat) {
    const p = predict(cat, when);
    const top = p.ranked[0];
    return {
      cat: cat,
      lead: cat + " is " + confidenceWord(top.prob) + " in the " +
        top.bucket.toLowerCase() + ", " + top.tag + ".",
      rows: p.ranked,
      night: p.night,
    };
  });

  return {
    heading: headingOverride ||
      ("Where they are around " + timeLabel(when) + " on " +
        dayName((when.getDay() + 6) % 7)),
    sections: sections,
    night: sections[0].night,
  };
}

function answerWhen(cats, bucket, now) {
  const sections = cats.map(function (cat) {
    const windows = whenAtBucket(cat, bucket, now);
    return {
      cat: cat,
      lead: windows.length
        ? cat + " is most often " +
          bucketPhrase(bucket) +
          " " + windowPhrase(windows[0]) + " (" +
          Math.round(windows[0].prob * 100) + "%)."
        : cat + " has never been recorded there.",
      windows: windows,
    };
  });

  return {
    heading: "Best times to find them " +
      bucketPhrase(bucket) +
      ", over the next 7 days",
    sections: sections,
  };
}

function answerCompare(bucket, now) {
  const scored = CAT_NAMES.map(function (cat) {
    return { cat: cat, prob: probOf(cat, bucket, now) };
  }).sort(function (a, b) { return b.prob - a.prob; });

  const lead = scored[0].prob === scored[1].prob
    ? "Right now they're equally likely — both " +
      Math.round(scored[0].prob * 100) + "%."
    : scored[0].cat + " is more likely (" + Math.round(scored[0].prob * 100) +
      "% vs " + Math.round(scored[1].prob * 100) + "%).";

  return {
    heading: "Who's more likely to be " +
      bucketPhrase(bucket) +
      " right now",
    sections: [{
      cat: null,
      lead: lead,
      rows: scored.map(function (s) {
        return { bucket: s.cat, prob: s.prob, tag: "" };
      }),
    }],
  };
}

/** Turn any question — preset or freehand — into a renderable answer. */
function answerQuestion(text) {
  const now = new Date();
  const cats = parseCats(text);
  const bucket = parseBucket(text);
  const intent = parseIntent(text);
  const at = parseTime(text, now);

  if (intent === "compare" && bucket) return answerCompare(bucket, at || now);
  if (intent === "when" && bucket) return answerWhen(cats, bucket, now);

  // "When is Bean most likely somewhere?" with no location named is really
  // just a question about their day, so fall through to a time-based answer.
  if (at) return answerNow(cats, at);
  if (intent === "now" || intent === "unknown") return answerNow(cats, now);
  return answerNow(cats, now);
}

/* ----------------------------------------------------------------------
   Rendering
   All DOM built with createElement/textContent — never innerHTML with user
   input, since the free-text box means anything can end up in here.
   ---------------------------------------------------------------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function probBar(prob) {
  const wrap = el("div", "prob-bar");
  const fill = el("span");
  fill.style.width = Math.round(prob * 100) + "%";
  wrap.appendChild(fill);
  return wrap;
}

function renderRow(label, detail, prob) {
  const row = el("div", "pred-row");
  const name = el("span", "pred-name", label);
  row.appendChild(name);
  if (detail) row.appendChild(el("span", "pred-tag", detail));
  row.appendChild(probBar(prob));
  row.appendChild(el("span", "pred-pct", Math.round(prob * 100) + "%"));
  return row;
}

function renderAnswer(answer) {
  const panel = document.getElementById("answerPanel");
  panel.textContent = "";

  panel.appendChild(el("h3", "answer-heading", answer.heading));

  answer.sections.forEach(function (section) {
    const block = el("div", "answer-block");
    block.appendChild(el("p", "answer-lead", section.lead));

    if (section.rows) {
      section.rows.forEach(function (r) {
        block.appendChild(renderRow(r.bucket, r.tag, r.prob));
      });
    }
    if (section.windows) {
      section.windows.forEach(function (w) {
        block.appendChild(renderRow(windowLabel(w), "", w.prob));
      });
    }
    panel.appendChild(block);
  });

  if (answer.night) {
    panel.appendChild(el("p", "answer-note",
      "That's an overnight window (" + hourLabel(D.nightStartHour) + "–" +
      hourLabel(D.dayStartHour) + "). Overnight uses the plain frequency of " +
      "where they've been logged at night, so it's the same answer at 9pm " +
      "and 3am."));
  }

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ----------------------------------------------------------------------
   Preset questions
   Each is just a question string put through the same pipeline as typed
   input, so presets can't drift away from what free text does.
   ---------------------------------------------------------------------- */
const PRESETS = [
  "Where is Bean right now?",
  "Where is Toffee right now?",
  "Where will they be tonight?",
  "Where are they on Saturday afternoon?",
  "When is Bean most likely on a lap?",
  "When is Toffee most likely in the office?",
  "Who is more likely to be in the bedroom?",
  "Where will Bean be at 9pm on Friday?",
];

function initQuestions() {
  const form = document.getElementById("askForm");
  const input = document.getElementById("askInput");
  const chips = document.getElementById("presetChips");

  PRESETS.forEach(function (q) {
    const btn = el("button", null, q);
    btn.type = "button";
    btn.addEventListener("click", function () {
      input.value = q;
      renderAnswer(answerQuestion(q));
    });
    chips.appendChild(btn);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    renderAnswer(answerQuestion(text));
  });

  // Open on something useful rather than an empty panel.
  renderAnswer(answerNow(CAT_NAMES, new Date(), "Where they probably are right now"));
}

/* ----------------------------------------------------------------------
   Floor plan
   ---------------------------------------------------------------------- */
function initFloorplan() {
  const layer = document.getElementById("catsLayer");
  const statusEl = document.getElementById("catStatus");

  CAT_NAMES.forEach(function (name, i) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "cat-dot");
    g.setAttribute("id", "cat-" + i);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", "11");
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("dy", "1");
    label.textContent = name.charAt(0);

    g.appendChild(circle);
    g.appendChild(label);
    layer.appendChild(g);
  });

  function refresh() {
    const now = new Date();
    statusEl.textContent = "";

    // Resolve both cats first: the nudge below depends on whether they collide.
    const tops = CAT_NAMES.map(function (name) {
      return predict(name, now).ranked[0];
    });
    const points = tops.map(function (top) {
      // Spot first, room only as a fallback — an unmapped tag lands somewhere
      // vague rather than crashing on point.x.
      return SPOT_POINTS[top.tag] || BUCKET_POINTS[top.bucket];
    });
    // Only separate the discs when they'd overlap. Applying the nudge
    // unconditionally would shove a dot clean off the furniture it names —
    // 13px is wider than half of most of these shapes.
    const collide = points[0].x === points[1].x && points[0].y === points[1].y;

    CAT_NAMES.forEach(function (name, i) {
      const top = tops[i];
      const point = points[i];
      // Must exceed the circle radius (11) or the two discs merge into a blob.
      const offset = collide ? (i % 2 === 0 ? -13 : 13) : 0;
      document
        .getElementById("cat-" + i)
        .setAttribute("transform",
          "translate(" + (point.x + offset) + ", " + point.y + ")");

      const line = el("span", "status-line");
      line.appendChild(el("strong", null, name));
      line.appendChild(el("span", "status-room", top.bucket));
      line.appendChild(el("span", "status-tag", top.tag));
      line.appendChild(el("span", "status-pct",
        Math.round(top.prob * 100) + "%"));
      statusEl.appendChild(line);
    });
  }

  refresh();
  // Re-evaluate against the real clock. Predictions change on quarter-hour
  // boundaries, so a one-minute tick is plenty and costs nothing.
  setInterval(refresh, 60 * 1000);
}

/**
 * Build the accuracy sentence from the exported numbers rather than hardcoding
 * it, so it can't quietly go stale when the model is retrained on new data.
 */
function initMeta() {
  const meta = document.getElementById("dataMeta");
  const acc = document.getElementById("accuracyNote");
  const m = D.meta;

  if (meta) {
    meta.textContent =
      m.totalObs + " sightings logged between " + m.dateFrom + " and " +
      m.dateTo + ". Predictions last exported " + m.generated + ".";
  }

  if (!acc) return;

  const pct = function (x) { return Math.round(x * 100) + "%"; };
  const parts = CAT_NAMES.map(function (name) {
    const c = D.cats[name];
    return name + " " + pct(c.roomAccuracy) + " (vs " + pct(c.roomBaseline) +
      " for always guessing their commonest room)";
  });

  // Measured by training on everything up to a few weeks ago and checking
  // against what actually happened since — not by shuffling all the sightings
  // together. The shuffled version scores much lower and is the wrong test:
  // half the data predates the climbing wall, and the model deliberately
  // discounts that period.
  acc.textContent =
    "Tested on the most recent few weeks, after training only on what came " +
    "before, the daytime guess gets the room right: " + parts.join(", ") +
    ". Picking the exact spot out of " + D.cats.Bean.spotClasses +
    " is much harder and lands nearer " +
    pct(D.cats.Bean.spotAccuracy) + "–" + pct(D.cats.Toffee.spotAccuracy) +
    ". The gap between the two cats is real rather than noise: when one of " +
    "them takes up a new spot, the model needs a few weeks of sightings " +
    "before it catches up, and Bean moved to the climbing wall later than " +
    "Toffee did. Either way the honest use of this page is the shape of the " +
    "distribution, not the top pick.";
}

document.addEventListener("DOMContentLoaded", function () {
  if (!window.CAT_DATA) {
    document.getElementById("answerPanel").textContent =
      "Prediction data failed to load. Check that js/cat-data.js is present.";
    return;
  }
  initQuestions();
  initFloorplan();
  initMeta();
});
