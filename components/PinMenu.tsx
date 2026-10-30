"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MAX_BOARDS, MAX_NAME } from "@/lib/boards";
import { useBoards } from "@/lib/use-boards";

/** Pin button for a stock page: a popover with a checkbox per dashboard. */
export function PinMenu({ id }: { id: string }) {
  const { boards, pin, unpin, create } = useBoards();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const count = boards.filter((b) => b.ids.includes(id)).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const addBoard = () => {
    const boardId = create(name);
    if (boardId) {
      pin(boardId, id);
      setName("");
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={menuId}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
          count ? "border-accent bg-accent text-accentink" : "border-line hover:border-accent hover:text-accent"
        }`}
      >
        {count ? `Pinned (${count})` : "Pin"}
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute top-full right-0 z-50 mt-1 w-64 rounded-md border border-line bg-panel p-2 text-sm shadow-lg"
        >
          <p className="px-1 pb-1 text-xs text-muted">Pin to dashboards</p>
          <ul className="max-h-56 overflow-auto">
            {boards.map((b) => {
              const on = b.ids.includes(id);
              return (
                <li key={b.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-panel2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => (on ? unpin(b.id, id) : pin(b.id, id))}
                      className="accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    <span className="text-xs text-muted">{b.ids.length}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {boards.length < MAX_BOARDS && (
            <form
              className="mt-2 flex gap-1.5 border-t border-line pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                addBoard();
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_NAME}
                placeholder="New dashboard"
                aria-label="New dashboard name"
                className="h-7 min-w-0 flex-1 rounded border border-line bg-bg px-2 text-sm outline-none placeholder:text-muted focus:border-accent"
              />
              <button
                type="submit"
                disabled={!name.trim()}
                className="rounded border border-line px-2 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
              >
                Create and pin
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
