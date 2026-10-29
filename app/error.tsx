"use client";
import Link from "next/link";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex h-full max-w-md flex-col justify-center gap-2">
      <p className="font-medium">Something went wrong showing this page</p>
      <p className="text-sm text-muted">The rest of the app still works. Try again, or go back to the overview.</p>
      <div className="flex gap-3">
        <button onClick={reset} className="rounded border border-line px-3 py-1 text-sm hover:border-accent hover:text-accent">
          Try again
        </button>
        <Link href="/" className="px-1 py-1 text-sm text-accent hover:underline">
          Overview
        </Link>
      </div>
    </div>
  );
}
