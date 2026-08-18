/* GoliathRogue — on-device crash log.
 *
 * There's no backend (it's a static Pages site), so the log lives in
 * localStorage and survives the crash + reload. The tester reads it back at
 * /log.html and sends it over.
 *
 * The important trick: iOS Safari enforces a hard memory ceiling and just KILLS
 * the tab when a WASM heap grows past it. That produces NO error event — the
 * page simply reloads or goes white. So we can't only listen for errors; we
 * flag a session as "running" on load and clear the flag on a clean exit. If
 * the flag is still set at the next boot, the previous session died abnormally,
 * which is our strongest signal for an out-of-memory kill.
 */
(function () {
  var KEY = "gr_log";        // ring buffer of entries
  var RUN = "gr_running";    // set while a session is live
  var MAX = 220;             // entries kept (~40 KB, well under the 5 MB cap)

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function fetch(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function read() {
    try { return JSON.parse(fetch(KEY) || "[]"); } catch (e) { return []; }
  }

  function push(line) {
    var log = read();
    log.push(new Date().toISOString().slice(11, 23) + "  " + line);
    if (log.length > MAX) log = log.slice(log.length - MAX);
    store(KEY, JSON.stringify(log));
  }
  window.grLog = push;       // Godot calls this via JavaScriptBridge

  /* ---- what device are we even on? -------------------------------------- */
  function deviceInfo() {
    var gl = null, renderer = "?";
    try {
      var c = document.createElement("canvas");
      gl = c.getContext("webgl2") || c.getContext("webgl");
      if (gl) {
        var dbg = gl.getExtension("WEBGL_debug_renderer_info");
        renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "masked";
      }
    } catch (e) {}
    var mem = "?";
    if (navigator.deviceMemory) mem = navigator.deviceMemory + "GB";
    return [
      "ua=" + navigator.userAgent,
      "screen=" + screen.width + "x" + screen.height + "@" + (window.devicePixelRatio || 1),
      "view=" + window.innerWidth + "x" + window.innerHeight,
      "deviceMemory=" + mem,
      "cores=" + (navigator.hardwareConcurrency || "?"),
      "gl=" + renderer,
    ].join("  ");
  }

  /* ---- boot: did the LAST session die on us? ---------------------------- */
  if (fetch(RUN) === "1") {
    push("!!!! PREVIOUS SESSION ENDED ABNORMALLY — no clean exit.");
    push("!!!! On iOS this almost always means the tab was killed for memory.");
  }
  store(RUN, "1");
  push("==== BOOT ====");
  push(deviceInfo());

  // a clean exit clears the flag; anything else leaves it set
  function cleanExit() { store(RUN, "0"); }
  window.addEventListener("pagehide", cleanExit);
  window.addEventListener("beforeunload", cleanExit);

  /* ---- errors ----------------------------------------------------------- */
  window.addEventListener("error", function (e) {
    if (e.message) push("JS ERROR: " + e.message + " @ " + (e.filename || "?") + ":" + (e.lineno || 0));
    else push("ERROR event (no message) — often a lost WebGL context");
  });
  window.addEventListener("unhandledrejection", function (e) {
    push("PROMISE REJECT: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
  });
  // WebGL context loss reads as a freeze/crash to a player
  window.addEventListener("webglcontextlost", function () { push("WEBGL CONTEXT LOST"); }, true);

  // Godot routes its own errors through console.error — keep them
  var realErr = console.error;
  console.error = function () {
    try { push("GODOT/CONSOLE: " + Array.prototype.join.call(arguments, " ").slice(0, 400)); } catch (e) {}
    return realErr.apply(console, arguments);
  };

  /* ---- memory watch ------------------------------------------------------
   * Chromium gives us performance.memory. Safari gives us NOTHING — no heap
   * API at all — so on the iPhone we're chasing this we cannot read the number
   * that actually kills the tab. Say so once, plainly, rather than leave a
   * future reader wondering why the memory lines are missing: on iOS the
   * evidence is the abnormal-exit flag above plus the last breadcrumb.
   */
  var haveMem = !!(window.performance && performance.memory);
  push(haveMem ? "mem sampling: performance.memory available"
               : "mem sampling: UNAVAILABLE (Safari/iOS) — rely on the exit flag + last breadcrumb");
  if (haveMem) {
    setInterval(function () {
      try {
        push("mem  jsHeap=" + (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + "MB" +
             "  limit=" + (performance.memory.jsHeapSizeLimit / 1048576).toFixed(0) + "MB");
      } catch (e) {}
    }, 15000);
  }
})();
