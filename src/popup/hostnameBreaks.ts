// A long hostname in the popup should wrap at a dot ("theguardian." /
// "com"), not wherever the line runs out ("theguardian.co" / "m"). The popup
// puts a <wbr> between these pieces; CSS overflow-wrap: break-word still
// breaks inside a piece only when that one label can't fit on a line.
export function hostnameSegments(hostname: string): string[] {
  return hostname.split(/(?<=\.)/);
}

/** Sets el's text to hostname with a line-break opportunity after each dot.
 * Built from text nodes, never innerHTML: the hostname comes from the page. */
export function setBreakableHostname(el: HTMLElement, hostname: string): void {
  el.replaceChildren();
  hostnameSegments(hostname).forEach((segment, i) => {
    if (i > 0) el.append(document.createElement("wbr"));
    el.append(document.createTextNode(segment));
  });
}
