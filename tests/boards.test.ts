import { describe, expect, it } from "vitest";
import {
  createBoard,
  defaultState,
  mergeLegacy,
  deleteBoard,
  MAX_BOARDS,
  MAX_PINS,
  move,
  parseBoards,
  pin,
  renameBoard,
  unpin,
} from "@/lib/boards";
import { displayCode, fromYahoo, isValidId, marketOf, regionOf, toYahoo } from "@/lib/symbols";

describe("stock ids", () => {
  it("keeps ASX codes bare and maps other markets", () => {
    expect(toYahoo("BHP")).toBe("BHP.AX");
    expect(toYahoo("AAPL.US")).toBe("AAPL");
    expect(toYahoo("VOD.L")).toBe("VOD.L");
    expect(fromYahoo("BHP.AX")).toBe("BHP");
    expect(fromYahoo("BRK-B")).toBe("BRK-B.US");
    expect(fromYahoo("0700.HK")).toBe("0700.HK");
    expect(fromYahoo("^AXJO")).toBe("^AXJO");
    expect(fromYahoo("AUDUSD=X")).toBe("AUDUSD=X");
  });
  it("round-trips every supported market", () => {
    for (const id of ["CBA", "MSFT.US", "BT-A.L", "SAP.DE", "MC.PA", "ASML.AS", "7203.T", "0005.HK"]) {
      expect(isValidId(id)).toBe(true);
      expect(fromYahoo(toYahoo(id))).toBe(id);
    }
  });
  it("rejects junk", () => {
    for (const id of ["", "bhp", "TOOLONGCODE", "AAPL.XX", "../etc", "A B", "^AXJO", "X.US.US"]) {
      expect(isValidId(id)).toBe(false);
    }
  });
  it("labels region, market and display code", () => {
    expect([regionOf("BHP"), marketOf("BHP"), displayCode("BHP")]).toEqual(["au", "ASX", "BHP"]);
    expect([regionOf("AAPL.US"), marketOf("AAPL.US"), displayCode("AAPL.US")]).toEqual(["us", "US", "AAPL"]);
    expect([regionOf("SAP.DE"), regionOf("7203.T"), regionOf("0700.HK"), regionOf("VOD.L")]).toEqual(["eu", "jp", "hk", "uk"]);
  });
});

describe("parseBoards", () => {
  it("migrates the old watchlist when nothing is stored", () => {
    const s = parseBoards(null, '["BHP","CBA","BHP","bad code",5]');
    expect(s.boards).toEqual([{ id: "watchlist", name: "Watchlist", ids: ["BHP", "CBA"] }]);
    expect(s.active).toBe("watchlist");
  });
  it("survives bad input", () => {
    for (const raw of [null, "{not json", '{"a":1}', '{"boards":"x"}', '{"boards":[{"id":"BAD ID","name":"x","ids":[]}]}']) {
      expect(parseBoards(raw, "{oops")).toEqual(defaultState());
    }
  });
  it("does not re-migrate once boards exist, even if they are unreadable", () => {
    expect(parseBoards("{not json", '["BHP"]')).toEqual(defaultState());
  });
  it("validates fields and applies limits", () => {
    const many = Array.from({ length: MAX_BOARDS + 3 }, (_, i) => ({ id: `b${i}`, name: `  Board   ${i} `, ids: [] }));
    const ids = Array.from({ length: MAX_PINS + 5 }, (_, i) => `A${i}`);
    many[0].ids = [...ids, "aapl.us", "nope!"] as never[];
    const s = parseBoards(JSON.stringify({ boards: [...many, many[1]], active: "missing" }));
    expect(s.boards).toHaveLength(MAX_BOARDS);
    expect(s.boards[0].name).toBe("Board 0");
    expect(s.boards[0].ids).toHaveLength(MAX_PINS);
    expect(s.active).toBe("b0");
  });
});

describe("board operations", () => {
  const base = defaultState(["BHP", "AAPL.US", "7203.T"]);
  it("creates, renames and deletes", () => {
    let s = createBoard(base, "  Tech  ", "tech");
    expect(s.active).toBe("tech");
    expect(createBoard(s, "   ", "x")).toBe(s);
    expect(createBoard(s, "Dup", "tech")).toBe(s);
    s = renameBoard(s, "tech", "US tech");
    expect(s.boards[1].name).toBe("US tech");
    s = deleteBoard(s, "tech");
    expect(s.boards.map((b) => b.id)).toEqual(["watchlist"]);
    expect(s.active).toBe("watchlist");
    expect(deleteBoard(s, "watchlist")).toBe(s);
  });
  it("pins, unpins and reorders", () => {
    let s = pin(base, "watchlist", "VOD.L");
    expect(s.boards[0].ids).toEqual(["BHP", "AAPL.US", "7203.T", "VOD.L"]);
    expect(pin(s, "watchlist", "VOD.L").boards[0].ids).toHaveLength(4);
    expect(pin(s, "watchlist", "bad id")).toBe(s);
    s = move(s, "watchlist", "VOD.L", -1);
    expect(s.boards[0].ids).toEqual(["BHP", "AAPL.US", "VOD.L", "7203.T"]);
    expect(move(s, "watchlist", "BHP", -1).boards[0].ids).toEqual(s.boards[0].ids);
    s = unpin(s, "watchlist", "BHP");
    expect(s.boards[0].ids).toEqual(["AAPL.US", "VOD.L", "7203.T"]);
  });
});

describe("mergeLegacy", () => {
  it("adds old watchlist stars to the Watchlist board without duplicates", () => {
    const s = createBoard(defaultState(["BHP"]), "Tech", "tech");
    const merged = mergeLegacy(s, '["CBA","BHP","bad code"]');
    expect(merged.boards[0].ids).toEqual(["BHP", "CBA"]);
    expect(merged.boards[1].ids).toEqual([]);
    expect(mergeLegacy(s, "{oops")).toBe(s);
  });
});
