export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-label="Loading admin page">
      <div className="h-10 w-64 rounded-xl bg-[#eadbd8]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-32 rounded-2xl bg-white" />
        ))}
      </div>
    </div>
  );
}

