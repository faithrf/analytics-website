"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { SearchHit } from "@/lib/yahoo";
import { isValidId } from "@/lib/symbols";

type Status = "idle" | "loading" | "done" | "error";

export function SearchBox() {
  const router = useRouter();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = q.trim();

  useEffect(() => {
    if (!query) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: SearchHit[] };
        setHits(body.results);
        setActive(0);
        setStatus("done");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setStatus("error");
      }
    }, 250);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (code: string) => {
    setOpen(false);
    setQ("");
    router.push(`/stock/${code}`);
  };

  // Enter before suggestions arrive: search now and open the best match, so a
  // company name works and a code like "WISE" is not assumed to be on the ASX.
  const searchNow = async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { results: SearchHit[] };
      if (body.results[0]) return go(body.results[0].id);
      setHits([]);
      setStatus("done");
    } catch {
      if (isValidId(query.toUpperCase())) return go(query.toUpperCase());
      setStatus("error");
    }
  };

  const showList = open && query.length > 0;
  const shown = query ? hits : [];

  return (
    <div ref={box} className="relative w-full max-w-xl">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (shown[active]) go(shown[active].id);
            else void searchNow();
          }
        }}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search stocks"
        placeholder="Search by company name or code, e.g. Commonwealth Bank, Apple, 7203"
        className="h-8 w-full rounded-md border border-line bg-bg px-3 text-sm outline-none placeholder:text-muted focus:border-accent"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-auto rounded-md border border-line bg-panel shadow-lg"
        >
          {status === "loading" && shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">Searching...</li>}
          {status === "error" && (
            <li className="px-3 py-2 text-sm text-muted">Search is unavailable right now. Type a full code such as BHP or AAPL.US and press Enter.</li>
          )}
          {status === "done" && shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches for &ldquo;{query}&rdquo;.</li>}
          {shown.map((h, i) => (
            <li
              key={h.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                go(h.id);
              }}
              className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm ${i === active ? "bg-panel2" : ""}`}
            >
              <span className="w-16 truncate font-semibold text-accent">{h.code}</span>
              <span className="min-w-0 flex-1 truncate">{h.name}</span>
              <span className="w-20 text-right text-xs text-muted">
                {h.market} {h.type === "ETF" ? "ETF" : "stock"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
