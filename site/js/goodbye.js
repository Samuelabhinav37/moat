// The uninstall page's one question (samuelabhinav.com/moat/goodbye/). Sends
// the answer, the optional note and the version from the page's address to
// Moat's report service, which files it with the week's other answers. The
// shape is checked again there (src/shared/feedback.ts).
(() => {
  const ENDPOINT = "https://moat-reports.samuelabhinav37.workers.dev/goodbye";
  const form = document.getElementById("bye-form");
  const send = document.getElementById("bye-send");
  const status = document.getElementById("bye-status");
  const note = document.getElementById("bye-note");
  const v = new URLSearchParams(location.search).get("v") || "";
  const version = /^\d+(?:\.\d+){1,3}$/.test(v) ? v : "";
  const reason = () => form.querySelector('input[name="reason"]:checked')?.value;

  form.addEventListener("change", () => {
    send.disabled = !reason();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!reason()) return;
    send.disabled = true;
    status.textContent = "Sending…";
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-moat-report": "1" },
        body: JSON.stringify({ v: 1, reason: reason(), note: note.value.slice(0, 1000), moatVersion: version }),
      });
      if (!response.ok) throw new Error(String(response.status));
      form.hidden = true;
      document.getElementById("bye-thanks").hidden = false;
    } catch {
      send.disabled = false;
      status.textContent = "Couldn't send. Try again in a minute.";
    }
  });
})();
