import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseFeed, mergeNews, cleanText } = await import("@/lib/feeds");

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>
<item><title><![CDATA[Shares &amp; bonds <b>rally</b>]]></title><link>https://ex.com/a?utm_source=x</link><pubDate>Tue, 06 Oct 2026 03:00:00 GMT</pubDate></item>
<item><title>No date &#8211; story</title><link>https://ex.com/b</link></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
<item><title></title><link>https://ex.com/c</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>F</title><link href="https://ex.com/" rel="self"/>
<entry><title type="html">Atom &lt;i&gt;headline&lt;/i&gt;</title><link rel="self" href="https://ex.com/self"/><link rel="alternate" href="https://ex.com/atom1"/><updated>2026-10-06T01:02:03Z</updated></entry>
<entry><title>Second</title><link href='https://ex.com/atom2'/><published>2026-10-05T00:00:00+10:00</published></entry>
</feed>`;

const RDF = `<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="x"><title>N</title></channel>
<item rdf:about="https://ex.com/r1"><title>RDF story</title><link>https://ex.com/r1</link><dc:date>2026-10-06T05:00:00+09:00</dc:date></item></rdf:RDF>`;

const GOOGLE = `<rss version="2.0"><channel><item><title>BHP lifts output - The Australian Financial Review</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Tue, 06 Oct 2026 02:00:00 GMT</pubDate><source url="https://afr.com">The Australian Financial Review</source></item>
<item><title>Rio - BHP merger talk - Reuters</title><link>https://news.google.com/rss/articles/def</link><source url="https://reuters.com">Reuters</source></item></channel></rss>`;

describe("parseFeed", () => {
  it("parses RSS with CDATA, entities, tag stripping and missing dates", () => {
    const items = parseFeed(RSS, "Ex");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Shares & bonds rally", publisher: "Ex", time: Date.parse("2026-10-06T03:00:00Z") });
    expect(items[1].title).toBe("No date – story");
    expect(items[1].time).toBeNull();
  });
  it("parses Atom and picks the alternate link", () => {
    const items = parseFeed(ATOM);
    expect(items.map((i) => i.link)).toEqual(["https://ex.com/atom1", "https://ex.com/atom2"]);
    expect(items[0].title).toBe("Atom headline");
    expect(items[0].time).toBe(Date.parse("2026-10-06T01:02:03Z"));
  });
  it("parses RDF", () => {
    const items = parseFeed(RDF, "Nikkei");
    expect(items).toEqual([
      { title: "RDF story", link: "https://ex.com/r1", publisher: "Nikkei", time: Date.parse("2026-10-05T20:00:00Z") },
    ]);
  });
  it("splits Google-style ' - Publisher' titles", () => {
    const items = parseFeed(GOOGLE, "Google News");
    expect(items[0]).toMatchObject({ title: "BHP lifts output", publisher: "The Australian Financial Review" });
    expect(items[1]).toMatchObject({ title: "Rio - BHP merger talk", publisher: "Reuters" });
  });
  it("never throws on junk", () => {
    expect(parseFeed("")).toEqual([]);
    expect(parseFeed("<html>nope</html>")).toEqual([]);
    expect(parseFeed(null as unknown as string)).toEqual([]);
  });
  it("cleanText strips tags and decodes entities", () => {
    expect(cleanText("<![CDATA[A &amp;amp; <em>B</em>]]>")).toBe("A & B");
  });
});

describe("mergeNews", () => {
  it("dedupes by normalised title or link, keeps the first, sorts newest first and caps", () => {
    const a = { title: "Stocks Rally, Again!", link: "https://a.com/1", time: 100 };
    const b = { title: "stocks rally again", link: "https://b.com/9", time: 300 };
    const c = { title: "Other", link: "https://www.c.com/x/?utm_source=q", time: 200 };
    const d = { title: "Different title", link: "https://c.com/x", time: 150 };
    const e = { title: "Old", link: "https://e.com", time: null };
    const out = mergeNews([a, b, c, d, e], 10);
    expect(out).toEqual([c, a, e]);
    expect(mergeNews([a, c, e], 2)).toEqual([c, a]);
  });
  it("calls onDuplicate with the kept item", () => {
    const kept = { title: "T", link: "https://a.com", time: 1, n: 0 };
    mergeNews([kept, { title: "t", link: "https://z.com", time: 2, n: 1 }], 5, (k, d) => {
      k.n += d.n;
    });
    expect(kept.n).toBe(1);
  });
});
