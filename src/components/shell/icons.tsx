import {
  ArrowLeftRight, Banknote, BarChart3, Building2, CalendarCheck, Calculator, ClipboardList, Coins,
  Circle, Database, Factory, FileText, HandCoins, Hammer, Home, Landmark, Layers, ListChecks, Package,
  PackagePlus, Percent, Receipt, Scale, ScrollText, Search, Settings, Shield, ShoppingCart,
  SlidersHorizontal, Trash2, Truck, Undo2, Users, Wallet, Warehouse, type LucideIcon,
} from "lucide-react";

// Chỉ import icon đang dùng (giữ bundle nhỏ). Thêm icon mới ở đây khi app.config cần.
export const ICONS: Record<string, LucideIcon> = {
  "arrow-left-right": ArrowLeftRight, banknote: Banknote, "bar-chart-3": BarChart3, "building-2": Building2,
  "calendar-check": CalendarCheck, calculator: Calculator, "clipboard-list": ClipboardList, coins: Coins, database: Database,
  factory: Factory, "file-text": FileText, "hand-coins": HandCoins, hammer: Hammer, home: Home,
  landmark: Landmark, layers: Layers, "list-checks": ListChecks, package: Package, "package-plus": PackagePlus,
  percent: Percent, receipt: Receipt, scale: Scale, "scroll-text": ScrollText, search: Search,
  settings: Settings, shield: Shield, "shopping-cart": ShoppingCart, "sliders-horizontal": SlidersHorizontal,
  "trash-2": Trash2, truck: Truck, "undo-2": Undo2, users: Users, wallet: Wallet, warehouse: Warehouse,
};

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const Cmp = ICONS[name] ?? Circle;
  return <Cmp size={size} className={className} aria-hidden />;
}
