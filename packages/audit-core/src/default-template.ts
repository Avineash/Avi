import type { AuditTemplate } from './types.ts';

/**
 * A generic hotel night-audit checklist, structured like a real property's: work before the system roll,
 * the roll itself, then post-roll reports and handover. Properties replace it with their own.
 * It names no vendor, folder or person, so it can ship as a neutral starting point.
 */
export const DEFAULT_TEMPLATE: AuditTemplate = {
  name: 'Standard night audit',
  links: { paylink: { label: 'Payment link portal', url: 'https://example.com/payment-links' } },
  folders: {
    Primary: ['Daily card reconciliation', 'Income audit', 'Out of order / out of service report', 'Daily credit check', 'AR activity report', 'Adjustments report', 'No-show report', 'Cashier summary', 'Open checks', 'Voids', 'Rate check', 'Room status discrepancy'],
    Supporting: ['Card rec: PMS report', 'Card rec: terminal slips', 'Income audit: PMS', 'Income audit: POS', 'Valet / parking', 'Laundry invoices'],
  },
  phases: [
    { id: 'p0', name: 'Start of shift', when: 'pre', steps: [
      { id: 'p0-1', text: 'Security walk: all levels and plant rooms' },
      { id: 'p0-2', text: 'Log in and have ready', subs: ['PMS', 'Email', 'CCTV', 'Messaging', 'POS'] },
      { id: 'p0-3', text: 'Handover from the evening team', subs: ['Arrivals', 'Early morning requests'] },
      { id: 'p0-4', text: 'Check arrivals, traces and action emails', key: true },
    ] },
    { id: 'p1', name: 'Parking & valet', when: 'pre', steps: [
      { id: 'p1-1', text: 'Photograph vehicles parked on site' },
      { id: 'p1-2', text: 'Photograph the keys in the key safe' },
      { id: 'p1-3', text: 'Audit valet cars and keys against the log', key: true, subs: ['Log matches vehicles', 'Keys in order'] },
      { id: 'p1-4', text: 'Post valet parking charges for the audit date', key: true, warn: 'Room number and guest name must match between the log and the PMS.', subs: ['Room and name match', 'Supporting report saved', 'New log sheet created for the business day'] },
    ] },
    { id: 'p2', name: 'Credit card reconciliation', when: 'pre', steps: [
      { id: 'p2-1', text: 'Check and post payment-link payments', key: true, tool: 'paylink', subs: ['Download card rec from the PMS', 'List payments received on the portal', 'Cross-check; post any not yet in the PMS'] },
      { id: 'p2-2', text: 'Bring the unreconciled manual-payment balance to 0', warn: 'Balance must be 0 before the card rec can be processed.', subs: ['Post manual payments', 'Larger variances: rectify or move to the dispute account'] },
      { id: 'p2-3', text: 'Process the card rec (balance is 0)' },
      { id: 'p2-4', text: 'Download the terminal reports', subs: ['F&B terminal report', 'Front office terminal report'] },
      { id: 'p2-5', text: 'Complete the card reconciliation and save it as PDF (Primary)', key: true, tool: 'ccrec' },
      { id: 'p2-6', text: 'Save card rec supporting documents (Supporting)', key: true, subs: ['PMS report', 'Front office terminal slips', 'F&B terminal slips'] },
    ] },
    { id: 'p3', name: 'Income audit', when: 'pre', steps: [
      { id: 'p3-1', text: 'Get exact values from the POS detail check reports' },
      { id: 'p3-2', text: 'Pull the PMS reports', subs: ['Revenue report', 'Tips report', 'Manual postings report'] },
      { id: 'p3-3', text: 'Complete the income audit sheet and save it as PDF (Primary)', key: true },
      { id: 'p3-4', text: 'Save income audit supporting documents (Supporting)', key: true, subs: ['PMS report', 'POS detail check report'] },
    ] },
    { id: 'p4', name: 'Audit check reports', when: 'pre', steps: [
      { id: 'p4-1', text: 'Save the audit check reports to the Primary folder', key: true, subs: ['Open checks', 'Voids', 'Management checks', 'Rate check', 'Folios', 'Room status discrepancy', 'Zero-rated rooms'] },
    ] },
    { id: 'p5', name: 'Postings & roll', when: 'pre', steps: [
      { id: 'p5-1', text: 'Post F&B covers', key: true },
      { id: 'p5-2', text: 'Post F&B items sold', key: true },
      { id: 'p5-3', text: 'Final check before roll', key: true, warn: 'All clearing and dispute transaction codes must be $0 before rolling.', subs: ['Arrivals checked', 'Dispute account is $0', 'Covers posting is $0', 'Items posting is $0'] },
      { id: 'p5-4', text: 'Re-check the items and covers posting report', key: true },
      { id: 'p5-5', text: 'Inform the night manager that you are ready to roll', key: true },
      { id: 'p5-6', text: 'Scan and save paperwork', key: true, subs: ['Laundry invoices', 'Registration cards', 'Valet tags', 'Sort checks into the archive box'] },
      { id: 'p5-7', text: 'Roll the system and help the manager roll the POS', key: true, roll: true },
      { id: 'p5-8', text: 'Security walk 03:00–04:00: check emergency stairs and note faults', due: '03:00–04:00' },
    ] },
    { id: 'roll', kind: 'roll', label: 'System roll' },
    { id: 'p6', name: 'After roll: save reports', when: 'post', steps: [
      { id: 'p6-1', text: 'Out of order / out of service by reason report', key: true, subs: ['Audit date (Primary)', 'Business date (team folder)'] },
      { id: 'p6-2', text: 'Daily credit check (Primary, business date)', key: true },
      { id: 'p6-3', text: 'AR activity report (Primary, audit date)', key: true },
      { id: 'p6-4', text: 'Adjustments report (Primary, audit date)', key: true },
      { id: 'p6-5', text: 'Cashier summary from the end-of-day report; check for any cash payment', key: true },
      { id: 'p6-6', text: 'No-show report from the end-of-day report', key: true },
      { id: 'p6-7', text: 'History and forecast reports as PDF', key: true, subs: ['Current month', 'Next month'] },
      { id: 'p6-8', text: 'Arrivals detailed report (business date)', key: true },
    ] },
    { id: 'p7', name: 'Breakfast & forecast', when: 'post', steps: [
      { id: 'p7-1', text: 'Save the breakfast report and print one copy for the kitchen', key: true },
      { id: 'p7-2', text: 'Print reports for F&B', key: true, subs: ['Daily cocktail report', 'Breakfast report: summary and detailed', 'In-house guest report'] },
      { id: 'p7-3', text: 'Complete the daily operations forecast', key: true, due: 'before 05:00' },
    ] },
    { id: 'p8', name: 'Handover & opening', when: 'post', steps: [
      { id: 'p8-1', text: 'Update the whiteboard', subs: ['Occupancy and guest-satisfaction scores', 'Shift members', 'Arrival, departure and stayover details', 'Functions and group bookings'] },
      { id: 'p8-2', text: 'Give reports and keys to F&B' },
      { id: 'p8-3', text: 'Handover to the morning team (issues, faults)' },
      { id: 'p8-4', text: 'At 06:30: open the building', due: '06:30', subs: ['Music on', 'Open restaurant entrance', 'Open main entrance', 'Signage for events'] },
    ] },
  ],
};
