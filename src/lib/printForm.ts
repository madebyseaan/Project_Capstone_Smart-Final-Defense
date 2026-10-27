export interface PrintFormOptions {
  styleId: string;
  orientation?: "portrait" | "landscape";
  extraCss?: string;
}

/**
 * Clone a rendered form into a body-level container, inject scoped print CSS,
 * print, then clean up. Mirrors SchoolForms.executePrint but supports extra
 * per-form CSS for the advisory printables.
 */
export function printForm(
  node: HTMLElement | null,
  styleIdOrOptions: string | PrintFormOptions,
  orientation: "portrait" | "landscape" = "portrait",
): void {
  if (!node) return;

  const options: PrintFormOptions =
    typeof styleIdOrOptions === "string"
      ? { styleId: styleIdOrOptions, orientation }
      : styleIdOrOptions;

  const printContainer = document.createElement("div");
  printContainer.className = "sf-print-container";
  printContainer.appendChild(node.cloneNode(true));
  document.body.appendChild(printContainer);

  const printStyle = document.createElement("style");
  printStyle.id = options.styleId;
  printStyle.textContent = `
    @media print {
      @page { size: A4 ${options.orientation ?? "portrait"}; margin: 10mm 8mm; }
      body > *:not(.sf-print-container) { display: none !important; }
      .sf-print-container { display: block !important; width: 100% !important; }
      .sf-print-container .print-form { box-shadow: none !important; margin: 0 !important; padding: 4mm !important; border: none !important; width: 100% !important; max-width: none !important; page-break-after: always !important; }
      .sf-print-container img { max-width: 56px !important; max-height: 56px !important; object-fit: contain !important; }
      .sf-print-container * { font-size: 9pt !important; line-height: 1.3 !important; }
      .sf-print-container h1 { font-size: 11pt !important; font-weight: bold !important; }
      .sf-print-container h2, .sf-print-container h3 { font-size: 10pt !important; font-weight: bold !important; }
      .sf-print-container table { width: 100% !important; border-collapse: collapse !important; table-layout: fixed; }
      .sf-print-container th, .sf-print-container td { border: 1px solid #000 !important; padding: 1.5px 3px !important; vertical-align: middle; }
      .sf-print-container .bg-gray-200, .sf-print-container .bg-gray-100 { background: #eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sf9-page-break { page-break-before: always !important; break-before: page !important; }
      ${options.extraCss ?? ""}
    }
  `;
  document.head.appendChild(printStyle);

  const cleanup = () => {
    if (document.body.contains(printContainer)) document.body.removeChild(printContainer);
    const style = document.getElementById(options.styleId);
    if (style) style.remove();
  };

  window.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 60000);
  window.print();
}
