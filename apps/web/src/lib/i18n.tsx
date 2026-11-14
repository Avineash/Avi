'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'si' | 'ta';
export type L10n = { en: string; si?: string; ta?: string } | null | undefined;
export const LANGS: { id: Lang; label: string; long: string }[] = [{ id: 'en', label: 'EN', long: 'English' }, { id: 'si', label: 'සිං', long: 'සිංහල' }, { id: 'ta', label: 'தமிழ்', long: 'தமிழ்' }];

/** Pick the localised string with English fallback (menu content is entered per language by the restaurant). */
export const tr = (o: L10n, lang: Lang) => (o ? (o[lang] || o.en || '') : '');

type Dict = Record<string, string>;
const en: Dict = {
  scanTagline: 'Scan. Order. Pay. Enjoy.', table: 'Table', popular: 'Popular', add: 'Add', soldOut: 'Sold out', viewOrder: 'View order', items: 'items', item: 'item',
  addToOrder: 'Add to order', required: 'Required', chooseUpTo: 'Choose up to', choose: 'Choose', specialInstructions: 'Special instructions', notePlaceholder: 'Allergies, no onions, less spicy…',
  yourOrder: 'Your order', back: 'Back', remove: 'Remove', subtotal: 'Subtotal', serviceCharge: 'Service charge', total: 'Total', yourDetails: 'Your details (optional)',
  name: 'Name', phone: 'Mobile number', email: 'Email for receipt', chooseHowToPay: 'Choose how to pay', payLankaQR: 'Pay with LankaQR', recommended: 'Recommended',
  lankaQRSub: 'Scan with any Sri Lankan banking app', payCard: 'Pay with Credit/Debit Card', cardSub: 'Visa & Mastercard · secure 3-D Secure checkout',
  lankaqrUnavailable: 'LankaQR is temporarily unavailable. You can securely complete your payment using a credit or debit card.', cardUnavailable: 'Card payments are temporarily unavailable. Please try LankaQR or ask staff for help.',
  payNow: 'Pay', placing: 'Please wait…', emptyCart: 'Your cart is empty', browseMenu: 'Browse the menu',
  scanToPay: 'Scan to pay with LankaQR', amountToPay: 'Amount to pay', expiresIn: 'Expires in', waiting: 'Waiting for payment confirmation…', confirmedByBank: 'We only confirm once your bank confirms.',
  howTo1: 'Open your banking app and choose Scan QR / LankaQR', howTo2: 'Scan this code with another phone, or use the button below on this phone', howTo3: 'Check the amount and approve in your app',
  sameDevice: 'Paying from this phone?', openBankApp: 'Open banking app', qrExpired: 'This QR code has expired', newQr: 'Create a new QR', tryAnother: 'Choose another way to pay',
  payFailed: 'Payment did not go through', payFailedHelp: 'You have not been charged for this attempt. You can try again.', redirecting: 'Taking you to our secure card page…', continueCard: 'Continue to secure card checkout',
  paymentCancelled: 'Payment cancelled', orderNumber: 'Order', paid: 'Paid', received: 'Received', preparing: 'Preparing', ready: 'Ready', served: 'Served',
  stRecv: 'We have your order', stPrep: 'The kitchen is preparing your food', stReady: 'Your order is ready!', stServed: 'Enjoy your meal 🙏', eta: 'Estimated', min: 'min',
  viewReceipt: 'View receipt', rateTitle: 'How was it?', rateSend: 'Send feedback', thanks: 'Thank you!', comment: 'Comments (optional)', orderMore: 'Order more',
  receipt: 'Receipt', paymentMethod: 'Payment method', reference: 'Reference', printReceipt: 'Print / save as PDF', sandboxBanner: 'SANDBOX — simulated payment. No real money moves.',
  qrInvalid: 'This QR code is not active. Please ask a team member.', loading: 'Loading…', retry: 'Try again', language: 'Language', fromYourBank: 'Waiting for your bank', orderPlacedAt: 'Placed at',
};
const si: Dict = {
  scanTagline: 'ස්කෑන් කරන්න. ඇණවුම් කරන්න. ගෙවන්න. රස විඳින්න.', table: 'මේසය', popular: 'ජනප්‍රිය', add: 'එක් කරන්න', soldOut: 'අවසන්', viewOrder: 'ඇණවුම බලන්න', items: 'අයිතම', item: 'අයිතමය',
  addToOrder: 'ඇණවුමට එක් කරන්න', required: 'අවශ්‍යයි', chooseUpTo: 'උපරිම තෝරන්න', choose: 'තෝරන්න', specialInstructions: 'විශේෂ උපදෙස්', notePlaceholder: 'අසාත්මිකතා, ළූණු නැතිව, සැර අඩුවෙන්…',
  yourOrder: 'ඔබේ ඇණවුම', back: 'ආපසු', remove: 'ඉවත් කරන්න', subtotal: 'උප එකතුව', serviceCharge: 'සේවා ගාස්තුව', total: 'මුළු මුදල', yourDetails: 'ඔබේ විස්තර (අත්‍යවශ්‍ය නොවේ)',
  name: 'නම', phone: 'ජංගම දුරකථන අංකය', email: 'කුවිතාන්සිය සඳහා ඊමේල්', chooseHowToPay: 'ගෙවන ආකාරය තෝරන්න', payLankaQR: 'LankaQR මගින් ගෙවන්න', recommended: 'නිර්දේශිතයි',
  lankaQRSub: 'ඕනෑම ශ්‍රී ලාංකික බැංකු යෙදුමකින් ස්කෑන් කරන්න', payCard: 'ක්‍රෙඩිට්/ඩෙබිට් කාඩ්පතෙන් ගෙවන්න', cardSub: 'Visa සහ Mastercard · ආරක්ෂිත 3-D Secure',
  lankaqrUnavailable: 'LankaQR තාවකාලිකව නොමැත. ඔබට ක්‍රෙඩිට් හෝ ඩෙබිට් කාඩ්පතකින් ආරක්ෂිතව ගෙවීම සම්පූර්ණ කළ හැක.', cardUnavailable: 'කාඩ්පත් ගෙවීම් තාවකාලිකව නොමැත. LankaQR උත්සාහ කරන්න හෝ කාර්ය මණ්ඩලයෙන් උදව් ඉල්ලන්න.',
  payNow: 'ගෙවන්න', placing: 'රැඳී සිටින්න…', emptyCart: 'ඔබේ කූඩය හිස්ය', browseMenu: 'මෙනුව බලන්න',
  scanToPay: 'LankaQR මගින් ගෙවීමට ස්කෑන් කරන්න', amountToPay: 'ගෙවිය යුතු මුදල', expiresIn: 'කල් ඉකුත් වීමට', waiting: 'ගෙවීම තහවුරු වන තෙක් රැඳී සිටී…', confirmedByBank: 'ඔබේ බැංකුව තහවුරු කළ පසු පමණක් අපි තහවුරු කරමු.',
  howTo1: 'ඔබේ බැංකු යෙදුම විවෘත කර Scan QR / LankaQR තෝරන්න', howTo2: 'මෙම කේතය වෙනත් දුරකථනයකින් ස්කෑන් කරන්න, නැතහොත් මෙම දුරකථනයේ පහත බොත්තම භාවිත කරන්න', howTo3: 'මුදල පරීක්ෂා කර ඔබේ යෙදුමේ අනුමත කරන්න',
  sameDevice: 'මෙම දුරකථනයෙන්ම ගෙවනවාද?', openBankApp: 'බැංකු යෙදුම විවෘත කරන්න', qrExpired: 'මෙම QR කේතය කල් ඉකුත් වී ඇත', newQr: 'නව QR එකක් සාදන්න', tryAnother: 'වෙනත් ආකාරයකින් ගෙවන්න',
  payFailed: 'ගෙවීම සාර්ථක නොවීය', payFailedHelp: 'මෙම උත්සාහයට ඔබෙන් මුදල් අය කර නැත. නැවත උත්සාහ කළ හැක.', redirecting: 'ආරක්ෂිත කාඩ් පිටුවට ගෙන යමින්…', continueCard: 'ආරක්ෂිත කාඩ් ගෙවීමට යන්න',
  paymentCancelled: 'ගෙවීම අවලංගු කළා', orderNumber: 'ඇණවුම', paid: 'ගෙවා ඇත', received: 'ලැබුණා', preparing: 'සකසමින්', ready: 'සූදානම්', served: 'සේවය කළා',
  stRecv: 'ඔබේ ඇණවුම අපට ලැබී ඇත', stPrep: 'ඔබේ ආහාර සකස් කරමින් පවතී', stReady: 'ඔබේ ඇණවුම සූදානම්!', stServed: 'රස විඳින්න 🙏', eta: 'ඇස්තමේන්තුව', min: 'මිනි.',
  viewReceipt: 'කුවිතාන්සිය බලන්න', rateTitle: 'කොහොමද?', rateSend: 'ප්‍රතිචාරය යවන්න', thanks: 'ස්තූතියි!', comment: 'අදහස් (අත්‍යවශ්‍ය නොවේ)', orderMore: 'තව ඇණවුම් කරන්න',
  receipt: 'කුවිතාන්සිය', paymentMethod: 'ගෙවීම් ක්‍රමය', reference: 'යොමුව', printReceipt: 'මුද්‍රණය / PDF ලෙස සුරකින්න', sandboxBanner: 'සැන්ඩ්බොක්ස් — සමාකරණ ගෙවීමකි. සැබෑ මුදල් චලනය නොවේ.',
  qrInvalid: 'මෙම QR කේතය ක්‍රියාත්මක නොවේ. කරුණාකර කාර්ය මණ්ඩලයෙන් විමසන්න.', loading: 'පූරණය වෙමින්…', retry: 'නැවත උත්සාහ කරන්න', language: 'භාෂාව', fromYourBank: 'ඔබේ බැංකුව සඳහා රැඳී සිටී', orderPlacedAt: 'ඇණවුම් කළේ',
};
const ta: Dict = {
  scanTagline: 'ஸ்கேன் செய்யுங்கள். ஆர்டர் செய்யுங்கள். செலுத்துங்கள். ரசியுங்கள்.', table: 'மேசை', popular: 'பிரபலமானவை', add: 'சேர்', soldOut: 'தீர்ந்தது', viewOrder: 'ஆர்டரைப் பார்', items: 'பொருட்கள்', item: 'பொருள்',
  addToOrder: 'ஆர்டரில் சேர்', required: 'அவசியம்', chooseUpTo: 'அதிகபட்சம் தேர்வு செய்க', choose: 'தேர்வு செய்க', specialInstructions: 'சிறப்பு அறிவுறுத்தல்கள்', notePlaceholder: 'ஒவ்வாமை, வெங்காயம் வேண்டாம், காரம் குறைவு…',
  yourOrder: 'உங்கள் ஆர்டர்', back: 'பின்', remove: 'நீக்கு', subtotal: 'துணை மொத்தம்', serviceCharge: 'சேவைக் கட்டணம்', total: 'மொத்தம்', yourDetails: 'உங்கள் விவரங்கள் (விருப்பத்திற்குரியது)',
  name: 'பெயர்', phone: 'கைபேசி எண்', email: 'ரசீதுக்கான மின்னஞ்சல்', chooseHowToPay: 'எப்படி செலுத்துவது என்பதைத் தேர்வு செய்க', payLankaQR: 'LankaQR மூலம் செலுத்து', recommended: 'பரிந்துரைக்கப்படுகிறது',
  lankaQRSub: 'இலங்கை வங்கி செயலி மூலம் ஸ்கேன் செய்யுங்கள்', payCard: 'கிரெடிட்/டெபிட் கார்டு மூலம் செலுத்து', cardSub: 'Visa & Mastercard · பாதுகாப்பான 3-D Secure',
  lankaqrUnavailable: 'LankaQR தற்காலிகமாக கிடைக்கவில்லை. கிரெடிட் அல்லது டெபிட் கார்டு மூலம் பாதுகாப்பாக செலுத்தலாம்.', cardUnavailable: 'கார்டு கட்டணம் தற்காலிகமாக கிடைக்கவில்லை. LankaQR முயற்சிக்கவும் அல்லது ஊழியரிடம் உதவி கேளுங்கள்.',
  payNow: 'செலுத்து', placing: 'காத்திருக்கவும்…', emptyCart: 'உங்கள் கூடை காலியாக உள்ளது', browseMenu: 'மெனுவைப் பார்',
  scanToPay: 'LankaQR மூலம் செலுத்த ஸ்கேன் செய்யுங்கள்', amountToPay: 'செலுத்த வேண்டிய தொகை', expiresIn: 'காலாவதி', waiting: 'கட்டண உறுதிப்படுத்தலுக்காக காத்திருக்கிறது…', confirmedByBank: 'உங்கள் வங்கி உறுதிப்படுத்திய பின்பே நாங்கள் உறுதிப்படுத்துவோம்.',
  howTo1: 'உங்கள் வங்கி செயலியைத் திறந்து Scan QR / LankaQR ஐத் தேர்வு செய்யுங்கள்', howTo2: 'இந்தக் குறியீட்டை வேறு தொலைபேசியில் ஸ்கேன் செய்யுங்கள், அல்லது இந்த தொலைபேசியில் கீழே உள்ள பொத்தானைப் பயன்படுத்துங்கள்', howTo3: 'தொகையைச் சரிபார்த்து செயலியில் அனுமதியுங்கள்',
  sameDevice: 'இதே தொலைபேசியிலிருந்து செலுத்துகிறீர்களா?', openBankApp: 'வங்கி செயலியைத் திற', qrExpired: 'இந்த QR குறியீடு காலாவதியாகிவிட்டது', newQr: 'புதிய QR உருவாக்கு', tryAnother: 'வேறு வழியில் செலுத்து',
  payFailed: 'கட்டணம் நிறைவேறவில்லை', payFailedHelp: 'இந்த முயற்சிக்கு உங்களிடம் கட்டணம் வசூலிக்கப்படவில்லை. மீண்டும் முயற்சிக்கலாம்.', redirecting: 'பாதுகாப்பான கார்டு பக்கத்திற்கு அழைத்துச் செல்கிறோம்…', continueCard: 'பாதுகாப்பான கார்டு கட்டணத்தைத் தொடரவும்',
  paymentCancelled: 'கட்டணம் ரத்து செய்யப்பட்டது', orderNumber: 'ஆர்டர்', paid: 'செலுத்தப்பட்டது', received: 'பெறப்பட்டது', preparing: 'தயாராகிறது', ready: 'தயார்', served: 'பரிமாறப்பட்டது',
  stRecv: 'உங்கள் ஆர்டர் எங்களிடம் உள்ளது', stPrep: 'சமையலறையில் உங்கள் உணவு தயாராகிறது', stReady: 'உங்கள் ஆர்டர் தயார்!', stServed: 'நன்றாக சாப்பிடுங்கள் 🙏', eta: 'மதிப்பீடு', min: 'நிமி.',
  viewReceipt: 'ரசீதைப் பார்', rateTitle: 'எப்படி இருந்தது?', rateSend: 'கருத்தை அனுப்பு', thanks: 'நன்றி!', comment: 'கருத்துகள் (விருப்பத்திற்குரியது)', orderMore: 'மேலும் ஆர்டர் செய்',
  receipt: 'ரசீது', paymentMethod: 'கட்டண முறை', reference: 'குறிப்பு', printReceipt: 'அச்சிடு / PDF ஆகச் சேமி', sandboxBanner: 'சாண்ட்பாக்ஸ் — உருவகப்படுத்தப்பட்ட கட்டணம். உண்மையான பணம் நகராது.',
  qrInvalid: 'இந்த QR குறியீடு செயலில் இல்லை. ஊழியரிடம் கேளுங்கள்.', loading: 'ஏற்றுகிறது…', retry: 'மீண்டும் முயற்சி', language: 'மொழி', fromYourBank: 'உங்கள் வங்கிக்காக காத்திருக்கிறது', orderPlacedAt: 'ஆர்டர் நேரம்',
};
const DICT: Record<Lang, Dict> = { en, si, ta };

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (k: keyof typeof en) => string }
const C = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (k) => en[k] });
export const useI18n = () => useContext(C);

export function I18nProvider({ children, initial = 'en' }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial);
  useEffect(() => { try { const s = localStorage.getItem('tf-lang') as Lang | null; if (s && DICT[s]) setLangState(s); } catch { /* storage blocked */ } }, []);
  useEffect(() => { document.documentElement.lang = lang === 'si' ? 'si' : lang === 'ta' ? 'ta' : 'en'; }, [lang]);
  const value = useMemo<Ctx>(() => ({ lang, setLang: (l) => { setLangState(l); try { localStorage.setItem('tf-lang', l); } catch { /* ignore */ } },
    t: (k) => DICT[lang][k] ?? en[k] ?? String(k) }), [lang]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
