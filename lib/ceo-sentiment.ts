/** CEO-statement sentiment: a compact Loughran-McDonald-style lexicon, quote extraction from press releases, and tercile stats. Pure functions. */

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const POSITIVE = words(`
able abundance acclaimed accomplish accomplished achieve achieved achievement achievements advancement advantage advantageous attain attractive beneficial benefit benefited benefits best better bolstered boom booming breakthrough collaborate compliment conclusive confident constructive creative delight delighted despite diligent distinction distinctive dream effective efficient empower empowered enable enabled encouraged enhance enhanced enhancement enhancing enjoy enjoyed enthusiasm enthusiastic excellence excellent exceptional exceeded excited exciting exclusive exemplary fantastic favorable favorably gain gained gains good great greater greatest happy highest honor ideal impressive improve improved improvement improvements improving incredible innovation innovative inspire inspired insightful integrity invent invention leadership leading lucrative momentum optimistic opportunities opportunity outperform outperformed outstanding pleased pleasure positive positively proactive proficient profitable profitably progress prosper prosperity proud reliable remarkable resolve rebound record rewarding robust satisfaction satisfied smooth solid solves speed spectacular stability stable strength strengthen strengthened strengthening strong stronger strongest succeed succeeded succeeding success successes successful successfully superior surpass surpassed thrilled top tremendous unmatched upturn valuable versatile vibrant win winning wins
`);

const NEGATIVE = words(`
adverse adversely against aggravate allegation allegations annul anticompetitive attrition bad bankruptcy breach burdensome challenge challenged challenges challenging cancel cancelled claims closing closure collapse concern concerns constrained constraint constraints contraction critical crisis curtail curtailed cut cuts damage damaged damages decline declined declines declining decrease decreased decreases decreasing deficit deficiency delay delayed delays deteriorate deteriorated deterioration difficult difficulties difficulty diminish diminished disappoint disappointed disappointing disappointment disruption disruptions downturn downward drop dropped dropping error errors fail failed failing failure failures fall fallen falling falls fraud harm harmful harsh headwind headwinds hurt hurting impair impaired impairment inability ineffective inflationary insolvency instability investigation lack lacking layoff layoffs lawsuit lawsuits litigation lose loses losing loss losses lost lower lowered negative negatively obstacle obstacles penalty poor poorly pressure pressures problem problems recession reduce reduced reduction restructuring risk risks setback severe shortage shortages shrink shrinking slow slowdown slowed slower slowing soft softness struggle struggled struggling suffer suffered terminate terminated threat threats trouble troubled turmoil unable uncertainty unfavorable unfortunately unprofitable volatile volatility warn warned weak weaken weakened weakening weaker weakness worse worsen worsened worst writedown writeoff
`);

const UNCERTAIN = words(`
almost ambiguity anticipate anticipated approximate approximately assume assumed believe believed could depend depends depending doubt doubtful exposure fluctuate fluctuations hidden hopefully imprecise indefinite indeterminate likelihood may maybe might nearly occasionally perhaps possible possibly precaution predict predicted probable probably random reassess recalculate reconsider revise risk risks roughly seems seldom sometimes somewhat speculate sporadic suggest suggests susceptible tentative turbulence uncertain uncertainties uncertainty unclear unconfirmed undetermined unexpected unforeseen unknown unpredictable unproven unquantifiable unreliable unresolved unsettled unspecified untested unusual variability variable variance vary volatile volatility vague
`);

export type Sentiment = { pos: number; neg: number; unc: number; words: number; score: number; uncertainty: number };

/** score = (pos - neg) / (pos + neg + 1); uncertainty = share of words that are uncertainty words. */
export function scoreText(text: string): Sentiment {
  const toks = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let pos = 0,
    neg = 0,
    unc = 0;
  for (const w of toks) {
    if (POSITIVE.has(w)) pos++;
    if (NEGATIVE.has(w)) neg++;
    if (UNCERTAIN.has(w)) unc++;
  }
  return { pos, neg, unc, words: toks.length, score: (pos - neg) / (pos + neg + 1), uncertainty: toks.length ? unc / toks.length : 0 };
}

/** Strip an HTML press release to plain text, decoding the common entities. */
export function htmlToText(html: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", mdash: "—", ndash: "–" };
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d)>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m)
    .replace(/[ \s]+/g, " ")
    .trim();
}

export type CeoQuote = { speaker: string; text: string };

const NAME = String.raw`([A-Z][a-z]+(?: [A-Z]\.)?(?: (?:[A-Z][a-zA-Z'’-]+|de|van|von)){1,2})`;
const TITLE = /\b(CEO|Chief Executive|Chairman|founder|President)\b/;
const AFTER = new RegExp(String.raw`^[\s,.]*(?:said|says|added|commented|stated|noted|continued)\s+${NAME}([^“]{0,100})`);
const BEFORE = new RegExp(String.raw`${NAME},?\s[^“]{0,100}?(?:CEO|Chief Executive)[^“]{0,40}?(?:said|says|stated|commented)\W*$`);

/** Quoted passages attributed to a CEO/founder, one entry per speaker (their quotes joined). */
export function extractCeoQuotes(text: string): CeoQuote[] {
  const t = text.replace(/[“”"]/g, "“");
  const parts = t.split("“");
  const bySpeaker = new Map<string, string[]>();
  // odd parts sit inside quotation marks
  for (let i = 1; i < parts.length; i += 2) {
    const q = parts[i].trim();
    if (q.length < 40) continue;
    const before = parts[i - 1].slice(-220);
    const after = parts[i + 1] ?? "";
    let speaker: string | null = null;
    const a = AFTER.exec(after);
    if (a && TITLE.test(a[2])) speaker = a[1];
    else {
      const b = BEFORE.exec(before);
      if (b) speaker = b[1];
    }
    if (!speaker) continue;
    speaker = speaker.replace(/\s+(Chief|Chairman|President|CEO)$/, "").trim();
    const list = bySpeaker.get(speaker) ?? [];
    list.push(q);
    bySpeaker.set(speaker, list);
  }
  return [...bySpeaker].map(([speaker, qs]) => ({ speaker, text: qs.join(" ") }));
}

export type Tercile = "low" | "mid" | "high";
export type SplitStats = { n: number; mean: number; hit: number; t: number };
export type Row = { score: number; ex: number | null };

/** Mean, hit rate (% > 0) and t-stat of a list of excess returns (percent). */
export function stats(xs: number[]): SplitStats {
  const n = xs.length;
  if (!n) return { n: 0, mean: 0, hit: 0, t: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, hit: (100 * xs.filter((x) => x > 0).length) / n, t: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0 };
}

/** Split by sentiment score into thirds and summarise the excess return of each. */
export function terciles(rows: Row[]): Record<Tercile, SplitStats> {
  const r = rows.filter((x) => x.ex !== null).sort((a, b) => a.score - b.score);
  const k = Math.floor(r.length / 3);
  const pick = (a: Row[]) => stats(a.map((x) => x.ex as number));
  return { low: pick(r.slice(0, k)), mid: pick(r.slice(k, r.length - k)), high: pick(r.slice(r.length - k)) };
}

export function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Shape of data/ceo-sentiment.json. Returns are percent; e* = excess over ^GSPC across the same window. */
export type CeoStatement = { d: string; sym: string; ceo: string; s: number; u: number; q: string; r1: number | null; r5: number | null; r20: number | null; e1: number | null; e5: number | null; e20: number | null };
export type CeoSplit = { low: SplitStats; mid: SplitStats; high: SplitStats; corr: number; n: number };
export type CeoSentimentFile = {
  updatedAt: string | null;
  note: string;
  statements: CeoStatement[];
  overall: Record<"e1" | "e5" | "e20", CeoSplit> | null;
  byCeo: { ceo: string; sym: string; e5: CeoSplit; e20: CeoSplit }[];
};

export function splitOf(rows: Row[]): CeoSplit {
  const ok = rows.filter((x) => x.ex !== null);
  return { ...terciles(rows), corr: correlation(ok.map((x) => x.score), ok.map((x) => x.ex as number)), n: ok.length };
}
