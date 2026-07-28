import { MessageSquarePlus } from "lucide-react";
import Link from "next/link";

import {
  MessageEditorForm,
  type EditableCatalogMessage,
} from "@/components/admin/message-editor-form";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  fieldClass,
  tableClass,
} from "@/components/admin/ui";
import { PAGE_SIZE } from "@/lib/admin/data";
import { getPage } from "@/lib/admin/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

type SearchParams = Record<string, string | string[] | undefined>;

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function editorHref(
  current: { q: string; category: string; visibility: string },
  editor: { edit?: string; create?: boolean }
) {
  const params = new URLSearchParams();
  if (current.q) params.set("q", current.q);
  if (current.category) params.set("category", current.category);
  if (current.visibility) params.set("visibility", current.visibility);
  if (editor.edit) params.set("edit", editor.edit);
  if (editor.create) params.set("new", "1");
  return `/admin/messages?${params.toString()}`;
}

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = getPage(params.page);
  const q = param(params.q).replace(/[%,_()]/g, "").trim().slice(0, 100);
  const categoriesResult = await supabaseAdmin
    .from("message_categories")
    .select("key, name, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (categoriesResult.error) {
    throw new Error("Unable to load message categories");
  }
  const categories = categoriesResult.data ?? [];
  const category = categories.some(
    (item) => item.key === param(params.category)
  )
    ? param(params.category)
    : "";
  const visibility = ["explore", "reserve", "inactive"].includes(
    param(params.visibility)
  )
    ? param(params.visibility)
    : "";
  const selectedId = param(params.edit);
  const creating = param(params.new) === "1";
  const from = (page - 1) * PAGE_SIZE;

  let listQuery = supabaseAdmin
    .from("messages")
    .select(
      "id, import_key, title, text, category, tone, is_active, is_explore_published, explore_sort_order, is_reserve_eligible, reserve_default_approved, reserve_sort_order, theme_key, animation_key, sound_key, background_key, font_key, text_size_key, text_alignment_key, text_position_key, created_at",
      { count: "exact" }
    )
    .is("necklace_id", null)
    .is("author_user_id", null)
    .order("category", { ascending: true })
    .order("explore_sort_order", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (q) listQuery = listQuery.or(`text.ilike.%${q}%,title.ilike.%${q}%,import_key.ilike.%${q}%`);
  if (category) listQuery = listQuery.eq("category", category);
  if (visibility === "explore") listQuery = listQuery.eq("is_explore_published", true);
  if (visibility === "reserve") listQuery = listQuery.eq("is_reserve_eligible", true);
  if (visibility === "inactive") listQuery = listQuery.eq("is_active", false);

  const categoryCountQueries = categories.map((item) =>
    supabaseAdmin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("necklace_id", null)
      .is("author_user_id", null)
      .eq("category", item.key)
  );
  const [listResult, ...categoryCounts] = await Promise.all([
    listQuery,
    ...categoryCountQueries,
  ]);
  if (
    listResult.error ||
    categoryCounts.some((result) => result.error)
  ) {
    throw new Error("Unable to load the message catalog");
  }

  let selected: EditableCatalogMessage | null = null;
  if (selectedId && !creating) {
    const result = await supabaseAdmin
      .from("messages")
      .select(
        "id, import_key, title, text, category, tone, is_active, is_explore_published, explore_sort_order, is_reserve_eligible, reserve_default_approved, reserve_sort_order, theme_key, animation_key, sound_key, background_key, font_key, text_size_key, text_alignment_key, text_position_key"
      )
      .eq("id", selectedId)
      .is("necklace_id", null)
      .is("author_user_id", null)
      .maybeSingle();
    if (result.error) throw new Error("Unable to load the selected message");
    selected = result.data;
  }

  const total = listResult.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentFilters = { q, category, visibility };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Message catalog"
        description="The single catalog powering sender Explore suggestions and automatic Reserve."
        actions={
          <Link
            href={editorHref(currentFilters, { create: true })}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-[#2a1214] px-5 text-sm font-semibold text-white"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New message
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {categories.map((item, index) => {
          const active = category === item.key;
          return (
            <Link
              key={item.key}
              href={`/admin/messages?category=${item.key}`}
              className={`rounded-2xl border p-4 transition ${
                active
                  ? "border-[#c9484a] bg-[#fff8f6] shadow-sm"
                  : "border-[#3a1e22]/10 bg-white hover:border-[#c9484a]/40"
              }`}
            >
              <p className="text-sm font-semibold">{item.name}</p>
              <p className="mt-2 text-2xl font-semibold">
                {categoryCounts[index].count ?? 0}
              </p>
              <p className="text-xs text-[#8d7376]">catalog messages</p>
            </Link>
          );
        })}
      </div>

      <Card>
        <form className="grid gap-3 md:grid-cols-[1fr_190px_190px_auto]">
          <input
            name="q"
            defaultValue={q}
            className={fieldClass}
            placeholder="Search message text, title, or import key"
            aria-label="Search message catalog"
          />
          <select
            name="category"
            defaultValue={category}
            className={fieldClass}
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories.map((item) => (
              <option key={item.key} value={item.key}>{item.name}</option>
            ))}
          </select>
          <select
            name="visibility"
            defaultValue={visibility}
            className={fieldClass}
            aria-label="Visibility"
          >
            <option value="">All statuses</option>
            <option value="explore">Published in Explore</option>
            <option value="reserve">Reserve eligible</option>
            <option value="inactive">Inactive</option>
          </select>
          <button className="h-10 rounded-full bg-[#2a1214] px-5 text-sm font-semibold text-white">
            Filter
          </button>
        </form>
      </Card>

      <div className={`grid gap-5 ${selected || creating ? "xl:grid-cols-[minmax(0,1fr)_430px]" : ""}`}>
        <Card>
          <div className="mb-4 flex items-center justify-between text-sm text-[#765d60]">
            <span>{total} message{total === 1 ? "" : "s"}</span>
            <span>Page {page} of {pages}</span>
          </div>
          {(listResult.data ?? []).length ? (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th>Message</th>
                    <th>Category</th>
                    <th>Availability</th>
                    <th>Order</th>
                    <th>Presentation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(listResult.data ?? []).map((message) => (
                    <tr key={message.id}>
                      <td className="max-w-md">
                        <p className="font-medium">{message.text}</p>
                        <p className="mt-1 text-xs text-[#8d7376]">
                          {message.title || message.import_key || message.id.slice(0, 8)}
                        </p>
                      </td>
                      <td className="capitalize">{message.category ?? "Uncategorized"}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {!message.is_active ? <Badge tone="danger">Inactive</Badge> : null}
                          {message.is_explore_published ? <Badge tone="success">Explore</Badge> : null}
                          {message.is_reserve_eligible ? <Badge tone="warning">Reserve</Badge> : null}
                          {message.is_active && !message.is_explore_published && !message.is_reserve_eligible ? <Badge>Draft</Badge> : null}
                        </div>
                      </td>
                      <td>
                        <p>E {message.explore_sort_order ?? "—"}</p>
                        <p className="text-xs text-[#8d7376]">R {message.reserve_sort_order ?? "—"}</p>
                      </td>
                      <td className="text-xs">
                        {message.theme_key ?? "heart"} · {message.animation_key ?? "breathe"} · {message.sound_key ?? "soft"} · {message.background_key ?? "rose_glow"} · {message.font_key ?? "serif"} · {message.text_size_key ?? "medium"} · {message.text_alignment_key ?? "center"} · {message.text_position_key ?? "center"}
                      </td>
                      <td>
                        <Link
                          href={editorHref(currentFilters, { edit: message.id })}
                          className="text-xs font-semibold text-[#b63d42] hover:underline"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No catalog messages match these filters.</EmptyState>
          )}

          <div className="mt-5 flex justify-between">
            {page > 1 ? (
              <Link
                className="text-sm font-semibold"
                href={`?q=${encodeURIComponent(q)}&category=${category}&visibility=${visibility}&page=${page - 1}`}
              >
                ← Previous
              </Link>
            ) : <span />}
            {page < pages ? (
              <Link
                className="text-sm font-semibold"
                href={`?q=${encodeURIComponent(q)}&category=${category}&visibility=${visibility}&page=${page + 1}`}
              >
                Next →
              </Link>
            ) : null}
          </div>
        </Card>

        {selected || creating ? (
          <Card className="h-fit xl:sticky xl:top-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#c9484a]">
                  {selected ? "Edit catalog message" : "New catalog message"}
                </p>
                <h2 className="mt-1 font-serif text-2xl">
                  {selected?.title || (selected ? "Message details" : "Create message")}
                </h2>
              </div>
              <Link href="/admin/messages" className="text-sm text-[#765d60]">Close</Link>
            </div>
            <MessageEditorForm
              message={selected ?? {}}
              categories={categories}
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
