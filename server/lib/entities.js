/**
 * Entity extraction.
 *
 * Pulls the concrete "things" out of a memory so the app can connect evidence
 * across different sources: phone numbers, money, dates, times, emails,
 * websites, booking references and names.
 */

import { cleanText } from "./text.js";

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const PHONE_RE = /(?:\+27[\s-]?|0)(\d{2})[\s-]?(\d{3})[\s-]?(\d{4})\b/g;
const MONEY_RE = /\bR\s?(\d{1,3}(?:[ ,]\d{3})+|\d{2,6})(?:\.(\d{2}))?\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_RE = /\b((?:[a-z0-9-]+\.)+(?:co\.za|com|org|net|gov\.za|io|za|dev|app))(?:\.)?(\/[^\s,;)"']*)?/gi;
const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
const DATE_RE = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*(\d{4})?\b/gi;
const DATE_RE_ALT = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const WEEKDAY_RE = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b/gi;
const REF_RE = /\b(?:ref(?:erence)?|booking|claim|policy|invoice|waybill|ticket)\b[^A-Za-z0-9]{0,14}([A-Z]{2,4}[0-9][A-Z0-9]{2,6})\b/gi;
const QUOTED_RE = /"([^"\n]{3,60})"/g;

/* Words that make a capitalised run *not* a person or organisation. */
const NAME_STOPWORDS = new Set(`
the a an and or but for with from this that these those your you our their his her its
what where when who why how which whose was were is are did do does can could should would will
show find tell give send save saving saved open call called add added buy bought get got go going
today tomorrow yesterday tonight week month year monday tuesday wednesday thursday friday saturday sunday
january february march april may june july august september october november december
level bay lift block unit flat road street avenue lane drive place hill court park gate
cheap flight flights flight fare fares airline airlines return ticket booking booked
screenshot photo photos picture pictures image images camera video
note notes memo list checklist reminder shopping grocery braai recipe dinner
whatsapp instagram chrome browser maps google gmail messages sms messenger safari
wifi password passcode network fibre fibre guest house reception room
parking receipt invoice total vat store shop mall checkers woolworths pick
dentist dental doctor doctor's clinic hospital appointment surgery
washing machine washer dryer laundry drain pump error
gym class classes pilates spin yoga training studio timetable
jacket coat sale price sale winter padded clothing clothes zara
plumber geyser leak pipe plumbing burst
laptop computer computers repair repairs quote screen battery charger
bank banking loan statement balance otp absa fnb standard nedbank capitec
tax sars efiling provisional return irp5 penalty
insurance health medical aid claim claims discovery policy cover
airbnb booking host cottage stay nights check
school trip form learner photos indemnity
series show season episode finale movie
load shedding loadshedding loadshedding stage eskom alert zone inverter
hike hiking trail trailhead reserve nature parking loop km
home house flat cottage office work meeting
info information details contact address email website link url
sale special offer deal discount price rand r
south africa african johannesburg gauteng cape town sandton randburg rosebank melville fourways bryanston dullstroom
`.trim().split(/\s+/));

/* Everyday words that show up capitalised in phone content but are not names. */
const COMMON_WORDS = new Set(`
car cars service services booking bookings confirmation confirmed reminder reminders
grocery groceries shopping basket till total change cash card
wifi password network internet data bundle router
guests guest visitor visitors people person someone somebody anyone
winter summer autumn spring season sale sales
stage evening morning afternoon night tonight
series show shows movie film book books song album podcast
sorry thanks thank hello hey hi yes no okay ok please
reminder update notice alert message messages chat chats
ready open closed pending paid unpaid due overdue
tip note item items quantity qty price prices amount amount
your mine ours theirs his hers
`.trim().split(/\s+/));

/* First names that appear in South African contexts - a light signal that a
   single capitalised word is a person's name rather than a sentence opener. */
const FIRST_NAMES = new Set(`
thabo lerato sipho naledi zanele pieter denzel faizel kurt aisha naidoo mokoena ndlovu
naledi sipho thandiwe jabulani mandla anele bongani siphiwe tshepo katlego lebogang
peter john mary paul sarah david michael james daniel emma linda grace
zanele pieter hendrik johannes morne jacques riaz fatima yusuf
`.trim().split(/\s+/));

/* Imperative verbs that start a name run but are not part of the name. */
const LEADING_VERBS = new Set(`
ask call text sms email tell meet see contact phone whatsapp message remind thank
join visit pay send get give use try bring buy book order check print sign fetch
keep add remove move show share forward reply confirm cancel please
`.trim().split(/\s+/));

/* Last words that mark an organisation rather than a person. */
const ORG_HINTS = new Set(`
computers plumbing hardware air airlines airlink flysafair motors traders hyper express
studio studios bank group holdings pty ltd inc pharmacy spar checkers discovery sanlam mica
mall school clinic hospital reserve nursery fuel motors tyres autos centre center garage
`.trim().split(/\s+/));

function push(map, type, value, label) {
  if (!value) return;
  const key = `${type}:${label ?? value}`;
  if (map.has(key)) return;
  map.set(key, { type, value, label: label ?? value, key });
}

/** Extract structured entities from a blob of text. */
export function extractEntities(text) {
  const out = new Map();
  const body = cleanText(text);
  if (!body) return { entities: [], byKey: new Map() };

  let m;
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(body))) {
    const digits = `0${m[1]}${m[2]}${m[3]}`;
    const pretty = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    push(out, "phone", digits, pretty);
  }

  MONEY_RE.lastIndex = 0;
  while ((m = MONEY_RE.exec(body))) {
    const whole = Number(m[1].replace(/[ ,]/g, ""));
    if (!Number.isFinite(whole) || whole < 10) continue;
    const amount = whole + (m[2] ? Number(`0.${m[2]}`) : 0);
    push(out, "money", `R${amount}`, `R${whole.toLocaleString("en-ZA")}${m[2] ? "." + m[2] : ""}`);
  }

  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(body))) push(out, "email", m[0].toLowerCase());

  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(body))) {
    const host = m[1].toLowerCase();
    if (/^\d/.test(host)) continue;
    push(out, "website", `${host}${m[2] ? "" : ""}`, m[2] ? `${host}${m[2]}` : host);
  }

  TIME_RE.lastIndex = 0;
  while ((m = TIME_RE.exec(body))) push(out, "time", m[0].padStart(5, "0"));

  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(body))) {
    const day = Number(m[1]);
    const mon = MONTHS[m[2].toLowerCase().replace(/\.$/, "")];
    const year = m[3] ? Number(m[3]) : null;
    if (!mon || day < 1 || day > 31) continue;
    const iso = `${year ?? "????"}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    push(out, "date", iso, `${m[1]} ${m[2].replace(/\.$/, "")}${year ? " " + year : ""}`);
  }

  DATE_RE_ALT.lastIndex = 0;
  while ((m = DATE_RE_ALT.exec(body))) push(out, "date", m[0], m[0]);

  WEEKDAY_RE.lastIndex = 0;
  while ((m = WEEKDAY_RE.exec(body))) {
    const wd = m[0].toLowerCase();
    const canonical = wd.slice(0, 3);
    if (["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(canonical)) push(out, "weekday", canonical);
  }

  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(body))) push(out, "reference", m[1].toUpperCase());

  QUOTED_RE.lastIndex = 0;
  while ((m = QUOTED_RE.exec(body))) push(out, "quote", m[1]);

  const nameType = new Map();
  for (const name of extractNames(body)) {
    const kind = /(computers|plumbing|hardware|airlines?|bank|studio|express|pty|ltd|mall|school|clinic|hardware)$/i.test(name) ? "org" : "person";
    nameType.set(name, kind);
    push(out, kind === "org" ? "org" : "name", name, name);
  }

  const entities = [...out.values()];
  const byKey = out;
  return { entities, byKey };
}

/**
 * Capitalised word runs that behave like people or organisations.
 * Runs are 2-3 words, or a single word that is a known first name, and any run
 * containing an everyday noun is rejected - which keeps "Car service" and
 * "How to claim from the RAF" out of the contact list.
 */
export function extractNames(text) {
  const results = new Map();
  const lines = String(text || "").split(/\n+/);
  for (const line of lines) {
    const parts = line.split(/\s+/).filter(Boolean);
    let run = [];
    const flush = () => {
      // "Ask Thabo Mokoena" / "Call Dr Naidoo" -> keep just the name
      while (run.length > 1 && LEADING_VERBS.has(run[0].word.toLowerCase())) run.shift();
      if (run.length >= 2 && run.length <= 3) {
        const words = run.map((r) => r.word);
        const lower = words.map((w) => w.toLowerCase());
        const blocked = lower.some((w) => NAME_STOPWORDS.has(w) || COMMON_WORDS.has(w));
        const isOrg = lower.some((w) => ORG_HINTS.has(w));
        if (!blocked || isOrg) {
          const phrase = words.join(" ").replace(/[^\w'\- ]/g, "").trim();
          const key = phrase.toLowerCase();
          if (!results.has(key)) results.set(key, { phrase, type: isOrg ? "org" : "person" });
        }
      } else if (run.length === 1) {
        const word = run[0].word.replace(/['\u2019]s$/i, "");
        const lower = word.toLowerCase().replace(/['\u2019]s$/, "");
        if (FIRST_NAMES.has(lower) && !NAME_STOPWORDS.has(lower) && !COMMON_WORDS.has(lower)) {
          if (!results.has(lower)) results.set(lower, { phrase: word, type: "person" });
        }
      }
      run = [];
    };
    for (let i = 0; i < parts.length; i++) {
      const raw = parts[i].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'\-]+$/gu, "");
      const trailing = /[.!?,;:]$/.test(parts[i]);
      const previous = parts[i - 1] || "";
      const isTitle = /^(dr|mr|mrs|ms|prof|adv|sir|rev)\.?$/i.test(previous);
      const isCap = /^[A-Z][a-z'\-]{1,}$/.test(raw) || /^[A-Z]{2,5}$/.test(raw);
      if (isCap) {
        run.push({ word: raw, title: isTitle });
      }
      if (!isCap || trailing) flush();
      if (run.length === 3) flush();
    }
    flush();
  }
  return [...results.values()]
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .map((r) => r.phrase);
}

/**
 * Entity kinds that are strong evidence for the "connect your life" view.
 */
export const CONNECTABLE = ["phone", "money", "email", "website", "reference", "date", "time", "quote", "name"];

/** Normalised view of a phone number for cross-source matching (last 9 digits). */
export function phoneKey(value) {
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

/** Entity identity used when connecting documents (so 0715550199 == 071 555 0199). */
export function entityIdentity(entity) {
  if (entity.type === "phone") return `phone:${phoneKey(entity.value)}`;
  if (entity.type === "name") return `name:${entity.value.toLowerCase()}`;
  if (entity.type === "money") return `money:${entity.value}`;
  if (entity.type === "website") return `website:${String(entity.value).replace(/^www\./, "").toLowerCase()}`;
  if (entity.type === "date") return `date:${entity.value}`;
  if (entity.type === "time") return `time:${entity.value}`;
  return `${entity.type}:${String(entity.value).toLowerCase()}`;
}
