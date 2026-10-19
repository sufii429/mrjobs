/* MrJobs — share card renderer.
   Renders the approved share-card design (mockup variant 1, 2026-10-19) on a
   client-side canvas and shares it via the Web Share API with a download
   fallback. HARD RULES baked in: no WhatsApp/employer number ever appears on
   the card, and salary is never disclosed — the card always shows the generic
   "Competitive + Incentives" line, even when the listing states pay.
   Usage: MrJobsShareCard.shareJob({id,title,company,location,experience,top20,isNew})
*/
(function () {
  "use strict";

  var W = 1080;
  var PAD = 70;
  var TEAL = "#2b7d99";        // header
  var TEAL_DARK = "#123b47";   // footer
  var TEAL_TEXT = "#1e6f8b";   // title + bullets
  var GOLD = "#f0ad0e";        // mrjobs.top + pill
  var GOLD_LINE = "#c9960a";   // top-20 line
  var INK = "#14343e";         // company + values
  var MUTED = "#6b7c82";       // row labels

  function wrap(ctx, text, maxWidth) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var lines = [], line = "";
    words.forEach(function (w) {
      var t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = w; }
      else { line = t; }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function pill(ctx, text, cx, cy) {
    ctx.save();
    ctx.font = "700 48px Arial, Helvetica, sans-serif";
    var tw = ctx.measureText(text).width;
    var pw = tw + 96, ph = 96;
    var x = cx - pw, y = cy - ph / 2;
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, pw, ph, ph / 2);
    else ctx.rect(x, y, pw, ph);
    ctx.fill();
    ctx.fillStyle = TEAL_DARK;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 48, cy + 2);
    ctx.restore();
  }

  function render(job) {
    var cv = document.createElement("canvas");
    cv.width = W;
    var ctx = cv.getContext("2d");
    var maxW = W - PAD * 2;

    /* ---- measure pass: compute body height ---- */
    ctx.font = "700 62px Arial, Helvetica, sans-serif";
    var companyLines = wrap(ctx, job.company || "", maxW).slice(0, 2);
    ctx.font = "700 42px Arial, Helvetica, sans-serif";
    var top20Line = job.top20 ? ["\u2605 Top 20 Pharma Company"] : [];
    ctx.font = "700 88px Arial, Helvetica, sans-serif";
    var titleLines = wrap(ctx, job.title || "", maxW).slice(0, 3);
    ctx.font = "700 46px Arial, Helvetica, sans-serif";
    var locText = (job.location || "").replace(/\s*[\u2014-]\s*/g, " \u2014 ");
    var rows = [["Location", locText]];
    if (job.experience) rows.push(["Experience", job.experience]);
    rows.push(["Salary", "Competitive + Incentives"]); // generic line — NEVER the real figure

    var HEADER_H = 300;
    var y = HEADER_H + 110;
    y += companyLines.length * 76;
    if (top20Line.length) y += 12 + 56;
    y += 26 + titleLines.length * 104;
    y += 40 + 2;                      // divider
    y += rows.length * 74 + 40;
    var FOOTER_H = 350;
    cv.height = Math.ceil(y + FOOTER_H);

    /* ---- draw ---- */
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, cv.height);

    // header
    ctx.fillStyle = TEAL;
    ctx.fillRect(0, 0, W, HEADER_H);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 112px Arial, Helvetica, sans-serif";
    ctx.fillText("MrJobs", PAD, 148);
    ctx.fillStyle = "#d4e6ec";
    ctx.font = "400 46px Arial, Helvetica, sans-serif";
    ctx.fillText("Pakistan's Job Board  \u00B7  Pharma & Beyond", PAD + 2, 216);
    if (job.isNew) pill(ctx, "NEW JOB", W - PAD, 118);

    // body
    y = HEADER_H + 110;
    ctx.fillStyle = INK;
    ctx.font = "700 62px Arial, Helvetica, sans-serif";
    companyLines.forEach(function (l) { ctx.fillText(l, PAD, y); y += 76; });
    if (top20Line.length) {
      y += 12;
      ctx.fillStyle = GOLD_LINE;
      ctx.font = "700 42px Arial, Helvetica, sans-serif";
      ctx.fillText(top20Line[0], PAD, y);
      y += 56;
    }
    y += 26;
    ctx.fillStyle = TEAL_TEXT;
    ctx.font = "700 88px Arial, Helvetica, sans-serif";
    titleLines.forEach(function (l) { ctx.fillText(l, PAD, y); y += 104; });
    y += 40;
    ctx.fillStyle = "#dfe7ea";
    ctx.fillRect(PAD, y, maxW, 2);
    y += 2 + 58;
    ctx.font = "700 46px Arial, Helvetica, sans-serif";
    rows.forEach(function (r) {
      ctx.fillStyle = TEAL_TEXT;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(PAD, y - 36, 34, 34, 8); ctx.fill(); }
      else ctx.fillRect(PAD, y - 36, 34, 34);
      var lx = PAD + 56;
      ctx.fillStyle = MUTED;
      ctx.fillText(r[0] + ":", lx, y);
      var lw = ctx.measureText(r[0] + ": ").width;
      ctx.fillStyle = INK;
      ctx.fillText(r[1], lx + lw, y);
      y += 74;
    });

    // footer
    var fy = cv.height - FOOTER_H;
    ctx.fillStyle = TEAL_DARK;
    ctx.fillRect(0, fy, W, FOOTER_H);
    ctx.fillStyle = "#bcd2d8";
    ctx.font = "400 50px Arial, Helvetica, sans-serif";
    ctx.fillText("Apply now at", PAD, fy + 96);
    ctx.fillStyle = GOLD;
    ctx.font = "700 132px Arial, Helvetica, sans-serif";
    ctx.fillText("mrjobs.top", PAD, fy + 232);
    ctx.fillStyle = "#9fb8bf";
    ctx.font = "400 42px Arial, Helvetica, sans-serif";
    ctx.fillText("Free for job seekers  \u00B7  New jobs every day", PAD, fy + 300);

    return cv;
  }

  function shareJob(job) {
    var cv = render(job || {});
    var done = function (blob) {
      var file = new File([blob], "mrjobs-job-" + (job.id || "share") + ".png",
                          { type: "image/png" });
      var text = (job.title || "") + " — " + (job.company || "") +
                 " (" + (job.location || "") + ")\nApply now at mrjobs.top";
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: "MrJobs — " + (job.title || ""),
                          text: text }).catch(function () { /* user dismissed */ });
      } else {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "mrjobs-job-" + (job.id || "share") + ".png";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      }
    };
    if (cv.toBlob) cv.toBlob(done, "image/png");
    else done((function () {
      var parts = cv.toDataURL("image/png").split(",");
      var bin = atob(parts[1]), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: "image/png" });
    })());
  }

  window.MrJobsShareCard = { render: render, shareJob: shareJob };
})();
