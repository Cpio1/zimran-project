import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3 py-10">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">It may have been removed, or it belongs to a different demo space.</p>
      <Link href="/" className="text-sm text-brand-700 hover:underline">Go to Home</Link>
    </div>
  );
}
