import { useEffect, useRef, useState, CSSProperties } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard, LogOut, PanelLeft, Package, ShoppingCart,
  DollarSign, FileText, Upload, Users, History,
} from "lucide-react";
import { useIsMobile } from "@/hooks/useMobile";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard",     path: "/pdv" },
  { icon: Package,         label: "Produtos",       path: "/pdv/produtos" },
  { icon: ShoppingCart,    label: "Vendas",         path: "/pdv/vendas" },
  { icon: History,         label: "Histórico",      path: "/pdv/historico" },
  { icon: Users,           label: "Clientes",       path: "/pdv/clientes" },
  { icon: DollarSign,      label: "Fluxo de Caixa", path: "/pdv/caixa" },
  { icon: FileText,        label: "Relatórios",     path: "/pdv/relatorios" },
  { icon: Upload,          label: "Importar",       path: "/pdv/importar" },
];

const SIDEBAR_WIDTH_KEY = "pdv-sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function PdvLayout({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const [adminName, setAdminName] = useState<string>("");
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  const logoutMutation = trpc.adminAuth.logout.useMutation();

  // Verifica se o admin está autenticado (mesmo padrão das páginas /gestor/*)
  useEffect(() => {
    const id = localStorage.getItem("adminId");
    const name = localStorage.getItem("adminName");
    if (!id) {
      setLocation("/gestor/login?redirect=/pdv");
      return;
    }
    setAdminName(name || "Admin");
  }, []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // ignora falha de rede — cookie expirará naturalmente pelo JWT
    } finally {
      localStorage.removeItem("adminId");
      localStorage.removeItem("adminName");
      setLocation("/gestor/login?redirect=/pdv");
    }
  };

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <PdvLayoutContent setSidebarWidth={setSidebarWidth} adminName={adminName} onLogout={handleLogout}>
        {children}
      </PdvLayoutContent>
    </SidebarProvider>
  );
}

function PdvLayoutContent({
  children,
  setSidebarWidth,
  adminName,
  onLogout,
}: {
  children: React.ReactNode;
  setSidebarWidth: (w: number) => void;
  adminName: string;
  onLogout: () => void | Promise<void>;
}) {
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const activeMenuItem = menuItems.find(item => item.path === location);

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - left;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-20 justify-center" style={{ backgroundColor: "#2D3748", borderBottom: "2px solid #D4A15E" }}>
            <div className="flex items-center gap-3 px-2 w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-slate-600 rounded-lg transition-colors focus:outline-none"
                aria-label="Toggle navigation"
                style={{ color: "#D4A15E" }}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              {!isCollapsed && (
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-bold truncate" style={{ color: "#D4A15E" }}>Sistema Soluteg</span>
                  <span className="text-xs truncate" style={{ color: "#94A3B8" }}>Ponto de Venda</span>
                </div>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location === item.path || (item.path !== "/pdv" && location.startsWith(item.path));
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal ${isActive ? "bg-slate-700 hover:bg-slate-600 text-white border-l-2" : "hover:bg-slate-100"}`}
                      style={isActive ? { borderLeftColor: "#D4A15E" } : {}}
                    >
                      <item.icon className="h-4 w-4" style={isActive ? { color: "#D4A15E" } : {}} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-0">
            <div className="px-3 py-2 text-center group-data-[collapsible=icon]:hidden" style={{ backgroundColor: "#2D3748", borderTop: "2px solid #D4A15E" }}>
              <p className="text-xs font-semibold" style={{ color: "#D4A15E" }}>JNC Comércio e Serviços</p>
              <p className="text-xs mt-0.5" style={{ color: "#94A3B8" }}>Sistema Soluteg de Vendas</p>
            </div>
            <div className="p-3 border-t">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none">
                    <Avatar className="h-9 w-9 border shrink-0" style={{ borderColor: "#D4A15E" }}>
                      <AvatarFallback className="text-xs font-medium" style={{ backgroundColor: "#2D3748", color: "#D4A15E" }}>
                        {adminName?.charAt(0).toUpperCase() || "A"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                      <p className="text-sm font-medium truncate leading-none">{adminName || "Admin"}</p>
                      <p className="text-xs text-muted-foreground truncate mt-1.5">Gestor</p>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={onLogout} className="cursor-pointer text-destructive focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sair</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="tracking-tight text-foreground">{activeMenuItem?.label ?? "PDV"}</span>
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
