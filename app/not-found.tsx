import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-2">
      <p className="font-medium">Page not found</p>
      <Link href="/" className="text-sm text-accent hover:underline">
        Back to the market overview
      </Link>
    </div>
  );
}
