"use client";
import { useState } from "react";
import { Combobox, filterComboOptions, type ComboOption } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
export function SupplierOrderReferenceFilters({ supplier, creator, people }: { supplier: ComboOption | null; creator: ComboOption | null; people: ComboOption[] }) {
  const [partner, setPartner] = useState(supplier), [user, setUser] = useState(creator);
  return <><div className="min-w-48"><Combobox hideLabel label="Lọc nhà cung cấp" placeholder="Nhà cung cấp…" value={partner} onChange={setPartner} loadOptions={q => apiFetch(`/api/partner-lists/suppliers/search?q=${encodeURIComponent(q)}`)} /><input type="hidden" name="partnerId" value={partner?.value ?? ""} /></div><div className="min-w-48"><Combobox hideLabel label="Lọc người đặt" placeholder="Người đặt…" value={user} onChange={setUser} loadOptions={async q => filterComboOptions(people, q)} /><input type="hidden" name="creatorId" value={user?.value ?? ""} /></div></>;
}
