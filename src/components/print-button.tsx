"use client";
export function PrintButton() {
  return <button onClick={() => window.print()} className="rounded-full border border-navy-900/25 px-4 py-2 text-sm font-semibold hover:bg-navy-900/5 print:hidden">Print / save as PDF</button>;
}
