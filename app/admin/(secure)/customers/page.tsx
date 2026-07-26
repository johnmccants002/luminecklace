import Link from "next/link";

import { Badge, Card, EmptyState, PageHeader, fieldClass, tableClass } from "@/components/admin/ui";
import { PAGE_SIZE, listCustomers } from "@/lib/admin/data";
import { formatDate, getPage } from "@/lib/admin/format";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const page = getPage(params.page);
  const result = await listCustomers(query, page);
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Search profiles, Shopify purchasers, and necklace ownership." />
      <Card>
        <form className="flex flex-col gap-3 sm:flex-row" role="search">
          <label className="sr-only" htmlFor="customer-search">Search customers</label>
          <input
            id="customer-search"
            name="q"
            defaultValue={query}
            placeholder="Name, email, Shopify order, necklace or NFC tag"
            className={fieldClass}
          />
          <button className="h-10 rounded-full bg-[#2a1214] px-6 text-sm font-semibold text-white">Search</button>
        </form>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-[#765d60]">{result.total} customer{result.total === 1 ? "" : "s"}</p>
          <p className="text-xs text-[#8d7376]">Page {page} of {pages}</p>
        </div>
        {result.rows.length ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead><tr><th>Customer</th><th>Status</th><th>Orders</th><th>Necklaces</th><th>Created</th></tr></thead>
              <tbody>
                {result.rows.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link href={`/admin/customers/${customer.id}`} className="font-semibold hover:underline">
                        {customer.display_name || customer.email}
                      </Link>
                      {customer.display_name ? <p className="mt-0.5 text-xs text-[#8d7376]">{customer.email}</p> : null}
                    </td>
                    <td><Badge tone={customer.account_status === "paused" ? "warning" : "success"}>{customer.account_status}</Badge></td>
                    <td>{customer.orderCount}</td>
                    <td>{customer.necklaceCount}</td>
                    <td>{formatDate(customer.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No customers match this search.</EmptyState>}

        <div className="mt-5 flex justify-between">
          {page > 1 ? <Link className="text-sm font-semibold" href={`?q=${encodeURIComponent(query)}&page=${page - 1}`}>← Previous</Link> : <span />}
          {page < pages ? <Link className="text-sm font-semibold" href={`?q=${encodeURIComponent(query)}&page=${page + 1}`}>Next →</Link> : null}
        </div>
      </Card>
    </div>
  );
}

