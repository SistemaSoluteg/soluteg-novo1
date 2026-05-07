import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LogOut, Download, FileText, Loader2, Search, AlertCircle,
  FileQuestion, Calendar, Droplet, ChevronDown, ClipboardList,
  Home, FolderOpen, Activity, ChevronRight, Upload, Lock, User,
  ArrowLeft,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { APP_LOGO } from "@/const";
import { SolutegFooter } from "@/components/SolutegFooter";
import { trpc } from "@/lib/trpc";
import InstallPWAPrompt from "@/components/InstallPWAPrompt";
import { useClientManifest } from "@/hooks/useClientManifest";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WaterTankContent } from "./WaterTankMonitoring";

type Page = "home" | "documents" | "monitoring";

interface Document {
  id: number;
  title: string;
  description?: string | null;
  documentType: string;
  fileUrl: string;
  uploadedAt: Date;
  month?: number | null;
  year?: number | null;
}

interface GroupedDocuments {
  [key: string]: Document[];
}

const MONTH_NAMES = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTH_NAMES_FULL = [
  "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const STATUS_LABEL: Record<string, string> = {
  aberta: "Aberta",
  aguardando_aprovacao: "Ag. Aprovação",
  aprovada: "Aprovada",
  rejeitada: "Rejeitada",
  em_andamento: "Em Andamento",
  concluida: "Concluída",
  aguardando_pagamento: "Ag. Pagamento",
  cancelada: "Cancelada",
};

const STATUS_COLOR: Record<string, string> = {
  aberta: "bg-blue-100 text-blue-800",
  aguardando_aprovacao: "bg-yellow-100 text-yellow-800",
  aprovada: "bg-green-100 text-green-800",
  rejeitada: "bg-red-100 text-red-800",
  em_andamento: "bg-purple-100 text-purple-800",
  concluida: "bg-green-200 text-green-900",
  aguardando_pagamento: "bg-orange-100 text-orange-800",
  cancelada: "bg-gray-100 text-gray-800",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export default function ClientPortal() {
  // Troca o manifest PWA para o do cliente enquanto este portal está aberto
  useClientManifest();

  const [activePage, setActivePage] = useState<Page>("home");
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientName, setClientName] = useState("");
  const [activeTab, setActiveTab] = useState("vistoria");

  // Profile edit dialog
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "", syndicName: "", phone: "",
    currentPassword: "", newPassword: "", confirmPassword: "",
  });
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);

  // Dialog state
  const [isOpenDialogOpen, setIsOpenDialogOpen] = useState(false);
  const [osType, setOsType] = useState<"emergencial" | "orcamento">("emergencial");
  const [osFormData, setOsFormData] = useState({
    title: "",
    description: "",
    serviceType: "manutencao" as string,
    priority: "normal" as "critica" | "alta" | "normal",
  });
  const [osLoading, setOsLoading] = useState(false);

  // Per-tab: input value (typed) and applied value (on button click / Enter)
  const [tabSearchInputs, setTabSearchInputs] = useState<Record<string, string>>({
    vistoria: "", visita: "", nota_fiscal: "", servico: "", orcamentos: "",
  });
  const [tabSearches, setTabSearches] = useState<Record<string, string>>({
    vistoria: "", visita: "", nota_fiscal: "", servico: "", orcamentos: "",
  });
  const [tabMonths, setTabMonths] = useState<Record<string, string>>({
    vistoria: "all", visita: "all", nota_fiscal: "all", servico: "all", orcamentos: "all",
  });
  const [tabYears, setTabYears] = useState<Record<string, string>>({
    vistoria: "all", visita: "all", nota_fiscal: "all", servico: "all", orcamentos: "all",
  });

  const applySearch = (tabKey: string) => {
    setTabSearches((prev) => ({ ...prev, [tabKey]: tabSearchInputs[tabKey] || "" }));
  };

  useEffect(() => {
    const token = localStorage.getItem("clientToken");
    const id = localStorage.getItem("clientId");
    const name = localStorage.getItem("clientName");
    if (!token || !id) {
      window.location.href = "/client/login";
      return;
    }
    setClientId(parseInt(id));
    setClientName(name || "Cliente");
  }, []);

  // profileData useEffect is below the query declaration

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem muito grande. Máximo 5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setProfilePhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    if (!clientId) return;
    try {
      // Upload photo first (if a new one was selected)
      if (profilePhotoPreview) {
        await uploadPhotoMutation.mutateAsync({ imageBase64: profilePhotoPreview });
      }
      // Then update the text fields
      await updateProfileMutation.mutateAsync({
        name: profileForm.name || undefined,
        syndicName: profileForm.syndicName || undefined,
        phone: profileForm.phone || undefined,
      });
    } catch {
      // errors already shown via onError
    }
  };

  const handleSavePassword = async () => {
    if (!clientId) return;
    if (!profileForm.currentPassword || !profileForm.newPassword) {
      toast.error("Preencha a senha atual e a nova senha");
      return;
    }
    if (profileForm.newPassword !== profileForm.confirmPassword) {
      toast.error("As senhas não conferem");
      return;
    }
    if (profileForm.newPassword.length < 6) {
      toast.error("A nova senha deve ter ao menos 6 caracteres");
      return;
    }
    await changePasswordMutation.mutateAsync({
      currentPassword: profileForm.currentPassword,
      newPassword: profileForm.newPassword,
    });
  };

  const { data: documents = [], isLoading } = trpc.documents.list.useQuery(
    {},
    { enabled: !!clientId }
  );

  const { data: sharedWorkOrders = [] } = trpc.workOrders.getSharedForPortal.useQuery(
    undefined,
    { enabled: !!clientId }
  );

  const { data: clientBudgets, refetch: refetchBudgets } = trpc.budgets.getForPortal.useQuery(
    undefined,
    { enabled: !!clientId }
  );

  const { data: profileData, refetch: refetchProfile } = trpc.clientProfile.getProfile.useQuery(
    undefined,
    { enabled: !!clientId }
  );

  useEffect(() => {
    if (!profileData) return;
    setProfileForm((f) => ({
      ...f,
      name: (profileData as any).name || "",
      syndicName: (profileData as any).syndicName || "",
      phone: (profileData as any).phone || "",
    }));
    setProfilePhoto((profileData as any).profilePhoto || null);
  }, [profileData]);

  const updateProfileMutation = trpc.clientProfile.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Perfil atualizado!");
      refetchProfile();
      setIsProfileOpen(false);
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const uploadPhotoMutation = (trpc as any).clientProfile.uploadMyPhoto.useMutation({
    onSuccess: (data: any) => {
      setProfilePhoto(data.photoUrl);
      setProfilePhotoPreview(null);
      refetchProfile();
      toast.success("Foto atualizada!");
    },
    onError: (e: any) => toast.error("Erro ao enviar foto: " + e.message),
  });

  const changePasswordMutation = trpc.clientProfile.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Senha alterada!");
      setProfileForm((f) => ({ ...f, currentPassword: "", newPassword: "", confirmPassword: "" }));
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const createBudgetMutation = trpc.budgets.create.useMutation({
    onSuccess: () => {
      toast.success("Solicitação de orçamento enviada com sucesso!");
      setOsFormData({ title: "", description: "", serviceType: "manutencao", priority: "normal" });
      setIsOpenDialogOpen(false);
      refetchBudgets();
    },
    onError: (e: any) => toast.error("Erro ao solicitar orçamento: " + e.message),
  });

  const exportPDFMutation = trpc.workOrders.exportPDFForPortal.useMutation({
    onSuccess: (data: any) => {
      const byteCharacters = atob(data.pdf);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { link.remove(); window.URL.revokeObjectURL(url); }, 100);
      toast.success("PDF baixado com sucesso!");
    },
    onError: () => toast.error("Erro ao baixar PDF"),
  });

  // Available years derived from documents
  const availableYears = (() => {
    const currentYear = new Date().getFullYear();
    const yearsSet = new Set<number>();
    yearsSet.add(currentYear);
    (documents as any[]).forEach((doc: any) => {
      const y = doc.year || new Date(doc.uploadedAt).getFullYear();
      yearsSet.add(y);
    });
    return Array.from(yearsSet).sort((a, b) => b - a);
  })();

  const getTabDocuments = (tabType: string) => {
    const search = tabSearches[tabType] || "";
    const month = tabMonths[tabType] || "all";
    const year = tabYears[tabType] || "all";

    const typeMap: Record<string, string[]> = {
      vistoria: ["vistoria"],
      visita: ["visita", "relatorio_visita", "rel_visita"],
      nota_fiscal: ["nota_fiscal", "nf"],
      servico: ["servico", "relatorio_servico", "rel_servico"],
    };

    const allowedTypes = typeMap[tabType] || [];

    return (documents as any[]).filter((doc: any) => {
      const matchesType = allowedTypes.includes(doc.documentType);
      const matchesSearch = !search || doc.title.toLowerCase().includes(search.toLowerCase());
      const docYear = doc.year || new Date(doc.uploadedAt).getFullYear();
      const docMonth = doc.month || new Date(doc.uploadedAt).getMonth() + 1;
      const matchesYear = year === "all" || docYear === parseInt(year);
      const matchesMonth = month === "all" || docMonth === parseInt(month);
      return matchesType && matchesSearch && matchesYear && matchesMonth;
    });
  };

  const groupDocumentsByPeriod = (docs: Document[]): GroupedDocuments => {
    const grouped: GroupedDocuments = {};
    docs.forEach((doc) => {
      const y = doc.year || new Date(doc.uploadedAt).getFullYear();
      const m = doc.month || new Date(doc.uploadedAt).getMonth() + 1;
      const key = `${MONTH_NAMES[m]} ${y}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(doc);
    });
    return grouped;
  };

  const sortedPeriods = (grouped: GroupedDocuments): string[] => {
    return Object.keys(grouped).sort((a, b) => {
      const parse = (str: string) => {
        const [month, year] = str.split(" ");
        const monthMap: Record<string, number> = {
          Jan: 1, Fev: 2, Mar: 3, Abr: 4, Mai: 5, Jun: 6,
          Jul: 7, Ago: 8, Set: 9, Out: 10, Nov: 11, Dez: 12,
        };
        return new Date(parseInt(year), (monthMap[month] || 1) - 1);
      };
      return parse(b).getTime() - parse(a).getTime();
    });
  };

  const handleLogout = () => {
    fetch("/api/client-logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("clientToken");
    localStorage.removeItem("clientId");
    localStorage.removeItem("clientName");
    window.location.href = "/";
  };

  const handleCreateWorkOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!osFormData.title.trim()) { toast.error("Título é obrigatório"); return; }

    if (osType === "orcamento") {
      createBudgetMutation.mutate({
        clientId: clientId!,
        serviceType: osFormData.serviceType as any,
        priority: osFormData.priority,
        title: osFormData.title,
        description: osFormData.description || undefined,
      });
      return;
    }

    setOsLoading(true);
    try {
      const response = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId, type: osType, title: osFormData.title,
          description: osFormData.description, serviceType: osFormData.serviceType,
          priority: osFormData.priority,
        }),
      });
      if (!response.ok) throw new Error("Erro ao criar OS");
      toast.success("Solicitação enviada com sucesso!");
      setOsFormData({ title: "", description: "", serviceType: "manutencao", priority: "normal" });
      setIsOpenDialogOpen(false);
    } catch {
      toast.error("Erro ao criar OS");
    } finally {
      setOsLoading(false);
    }
  };

  // ─── Sub-components ─────────────────────────────────────────────────────────

  const WorkOrderCard = ({ wo }: { wo: typeof sharedWorkOrders[0] }) => (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <ClipboardList className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="font-mono text-xs text-slate-500">{wo.osNumber}</span>
              <Badge className={`text-xs px-1.5 py-0 ${STATUS_COLOR[wo.status] || "bg-gray-100 text-gray-800"}`}>
                {STATUS_LABEL[wo.status] || wo.status}
              </Badge>
            </div>
            <p className="font-semibold text-sm truncate">{wo.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {wo.scheduledDate
                ? new Date(wo.scheduledDate).toLocaleDateString("pt-BR")
                : new Date(wo.createdAt).toLocaleDateString("pt-BR")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 flex-shrink-0"
            onClick={() => exportPDFMutation.mutate({ id: wo.id })}
            disabled={exportPDFMutation.isPending}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const BUDGET_STATUS_LABEL: Record<string, string> = {
    pendente: "Solicitado",
    finalizado: "Pend. Aprovação",
    aprovado: "Aprovado",
    reprovado: "Reprovado",
  };
  const BUDGET_STATUS_COLOR: Record<string, string> = {
    pendente: "bg-slate-100 text-slate-700",
    finalizado: "bg-blue-100 text-blue-800",
    aprovado: "bg-green-100 text-green-800",
    reprovado: "bg-red-100 text-red-700",
  };

  const BudgetCard = ({ budget }: { budget: any }) => (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <FileQuestion className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="font-mono text-xs text-slate-500">{budget.budgetNumber}</span>
              <Badge className={`text-xs px-1.5 py-0 ${BUDGET_STATUS_COLOR[budget.status] || "bg-gray-100 text-gray-800"}`}>
                {BUDGET_STATUS_LABEL[budget.status] || budget.status}
              </Badge>
            </div>
            <p className="font-semibold text-sm truncate">{budget.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {new Date(budget.createdAt).toLocaleDateString("pt-BR")}
              {budget.totalValue ? ` · R$ ${(budget.totalValue / 100).toFixed(2).replace(".", ",")}` : ""}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const DocumentCard = ({ doc }: { doc: Document }) => (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <p className="font-semibold text-sm truncate">{doc.title}</p>
            </div>
            {doc.description && (
              <p className="text-xs text-slate-500 line-clamp-1">{doc.description}</p>
            )}
            <p className="text-xs text-slate-400 mt-0.5">
              {new Date(doc.uploadedAt).toLocaleDateString("pt-BR")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 flex-shrink-0"
            onClick={() => window.open(doc.fileUrl, "_blank")}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const TabFilterBar = ({ tabKey }: { tabKey: string }) => (
    <div className="space-y-2 bg-slate-50 p-3 rounded-lg">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            className="pl-9 h-9"
            placeholder="Buscar..."
            value={tabSearchInputs[tabKey] || ""}
            onChange={(e) => setTabSearchInputs({ ...tabSearchInputs, [tabKey]: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") applySearch(tabKey); }}
          />
        </div>
        <Button size="sm" className="h-9 bg-amber-600 hover:bg-amber-700 px-3" onClick={() => applySearch(tabKey)}>
          <Search className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex gap-2">
        <Select
          value={tabMonths[tabKey] || "all"}
          onValueChange={(v) => setTabMonths({ ...tabMonths, [tabKey]: v })}
        >
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="Mês" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os meses</SelectItem>
            {MONTH_NAMES_FULL.slice(1).map((name, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={tabYears[tabKey] || "all"}
          onValueChange={(v) => setTabYears({ ...tabYears, [tabKey]: v })}
        >
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="Ano" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os anos</SelectItem>
            {availableYears.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  const recentDocs = [...(documents as any[])]
    .sort((a: any, b: any) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .slice(0, 4);

  const recentWorkOrders = [...(sharedWorkOrders as any[])].slice(0, 3);

  return (
    <div className="min-h-screen bg-slate-50 pb-20 md:pb-0">

      {/* Banner de instalação PWA — convida o cliente a adicionar atalho à tela inicial */}
      <InstallPWAPrompt
        storageKey="pwa_client_install_dismissed_at"
        label="Adicionar atalho à tela inicial para acesso rápido"
      />

      {/* ── Header ── */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className={`mx-auto px-4 h-14 flex items-center justify-between max-w-2xl ${activePage === "monitoring" ? "md:max-w-6xl" : "md:max-w-5xl"}`}>
          <div className="flex items-center gap-3">
            {activePage !== "home" && (
              <button
                onClick={() => setActivePage("home")}
                className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
                aria-label="Voltar ao início"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <img src={APP_LOGO} alt="Soluteg" className="h-8 object-contain" />
            <div className="leading-tight hidden sm:block">
              <p className="font-bold text-sm text-white">Portal do Cliente</p>
              <p className="text-[10px] text-slate-400">JNC Elétrica &amp; Bombas</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Desktop navigation links */}
            <nav className="hidden md:flex items-center gap-1 mr-4">
              {[
                { page: "home" as Page, label: "Início", icon: Home },
                { page: "documents" as Page, label: "Documentos", icon: FolderOpen },
                { page: "monitoring" as Page, label: "Monitoramento", icon: Activity },
              ].map(({ page, label, icon: Icon }) => (
                <button
                  key={page}
                  onClick={() => setActivePage(page)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activePage === page
                      ? "bg-amber-500/20 text-amber-400"
                      : "text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </nav>
            <button onClick={() => setIsProfileOpen(true)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              {profilePhoto ? (
                <img src={profilePhoto} alt="Foto" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                  {getInitials(clientName)}
                </div>
              )}
              <span className="text-sm text-slate-300 hidden sm:block truncate max-w-[140px]">{clientName}</span>
            </button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-400 hover:text-white hover:bg-slate-800 h-8 px-2">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Page: Home ── */}
      {activePage === "home" && (
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">

          {/* Profile card */}
          <Card className="bg-gradient-to-br from-slate-800 to-slate-900 text-white border-0 shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <button onClick={() => setIsProfileOpen(true)} className="relative flex-shrink-0 group">
                  {profilePhotoPreview || profilePhoto ? (
                    <img
                      src={profilePhotoPreview || profilePhoto!}
                      alt="Foto"
                      className="w-16 h-16 rounded-full object-cover ring-2 ring-amber-400"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-amber-500 flex items-center justify-center text-2xl font-bold">
                      {getInitials(clientName)}
                    </div>
                  )}
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Upload className="w-5 h-5 text-white" />
                  </div>
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-slate-400 text-xs uppercase tracking-wide">Portal do Cliente</p>
                  <h2 className="text-xl font-bold leading-tight mt-0.5 truncate">{clientName}</h2>
                  <p className="text-amber-400 text-xs mt-0.5">JNC Elétrica &amp; Bombas</p>
                  <button
                    onClick={() => setIsProfileOpen(true)}
                    className="text-xs text-slate-400 hover:text-white mt-1 transition-colors underline underline-offset-2"
                  >
                    Editar perfil
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick actions */}
          <div>
            <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">Solicitar</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setOsType("emergencial"); setIsOpenDialogOpen(true); }}
                className="flex flex-col items-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl p-4 transition-colors text-left"
              >
                <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-red-700 text-sm">Atendimento</p>
                  <p className="text-xs text-red-500">Emergencial</p>
                </div>
              </button>
              <button
                onClick={() => { setOsType("orcamento"); setIsOpenDialogOpen(true); }}
                className="flex flex-col items-center gap-2 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl p-4 transition-colors text-left"
              >
                <div className="w-10 h-10 bg-amber-600 rounded-full flex items-center justify-center">
                  <FileQuestion className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-amber-800 text-sm">Orçamento</p>
                  <p className="text-xs text-amber-600">Solicitar cotação</p>
                </div>
              </button>
            </div>
          </div>

          {/* Quick access */}
          <div>
            <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">Acesso Rápido</h3>
            <div className="space-y-2">
              <button
                onClick={() => setActivePage("documents")}
                className="w-full flex items-center gap-3 bg-white rounded-xl p-4 border hover:border-amber-300 transition-colors"
              >
                <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FolderOpen className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-sm">Meus Documentos</p>
                  <p className="text-xs text-slate-500">{documents.length} documento{documents.length !== 1 ? "s" : ""} disponíveis</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
              <button
                onClick={() => setActivePage("monitoring")}
                className="w-full flex items-center gap-3 bg-white rounded-xl p-4 border hover:border-amber-300 transition-colors"
              >
                <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Droplet className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-sm">Monitoramento</p>
                  <p className="text-xs text-slate-500">Controle de reservatórios</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>

          {/* Recent work orders */}
          {recentWorkOrders.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">OS Recentes</h3>
                <button onClick={() => { setActivePage("documents"); setActiveTab("orcamentos"); }} className="text-xs text-amber-600 font-medium">
                  Ver todas
                </button>
              </div>
              <div className="space-y-2">
                {recentWorkOrders.map((wo) => <WorkOrderCard key={wo.id} wo={wo} />)}
              </div>
            </div>
          )}

          {/* Recent documents */}
          {recentDocs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Docs. Recentes</h3>
                <button onClick={() => setActivePage("documents")} className="text-xs text-amber-600 font-medium">
                  Ver todos
                </button>
              </div>
              <div className="space-y-2">
                {recentDocs.map((doc) => <DocumentCard key={doc.id} doc={doc} />)}
              </div>
            </div>
          )}

          {recentDocs.length === 0 && recentWorkOrders.length === 0 && (
            <div className="text-center py-10 text-slate-400">
              <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum documento disponível ainda.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Page: Documents ── */}
      {activePage === "documents" && (
        <div className="max-w-2xl mx-auto px-4 py-5">
          <h2 className="text-lg font-bold mb-4">Meus Documentos</h2>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="overflow-x-auto -mx-4 px-4">
              <TabsList className="inline-flex w-auto min-w-full mb-4 h-9">
                <TabsTrigger value="vistoria" className="text-xs px-3">Vistoria</TabsTrigger>
                <TabsTrigger value="visita" className="text-xs px-3">Visita</TabsTrigger>
                <TabsTrigger value="nota_fiscal" className="text-xs px-3">NF</TabsTrigger>
                <TabsTrigger value="servico" className="text-xs px-3">Serviço</TabsTrigger>
                <TabsTrigger value="orcamentos" className="text-xs px-3">Orçamentos</TabsTrigger>
              </TabsList>
            </div>

            {/* Orcamentos tab */}
            <TabsContent value="orcamentos" className="space-y-3 mt-0">
              <div className="space-y-2">
                {(clientBudgets?.items ?? []).length > 0 ? (
                  (clientBudgets?.items ?? []).map((b: any) => (
                    <BudgetCard key={b.id} budget={b} />
                  ))
                ) : (
                  <p className="text-center py-10 text-slate-400 text-sm">Nenhum orçamento disponível.</p>
                )}
              </div>
            </TabsContent>

            {/* Document tabs */}
            {(["vistoria", "visita", "nota_fiscal", "servico"] as const).map((tab) => {
              const tabDocs = getTabDocuments(tab);
              const grouped = groupDocumentsByPeriod(tabDocs);
              const periods = sortedPeriods(grouped);
              const tabWorkOrders = (sharedWorkOrders as any[])
                .filter((wo: any) => wo.portalTab === tab)
                .filter((wo: any) => !tabSearches[tab] ||
                  wo.title.toLowerCase().includes(tabSearches[tab].toLowerCase()) ||
                  wo.osNumber.toLowerCase().includes(tabSearches[tab].toLowerCase()));

              return (
                <TabsContent key={tab} value={tab} className="space-y-3 mt-0">
                  <TabFilterBar tabKey={tab} />

                  <div className="space-y-2">
                    {/* Shared work orders for this tab */}
                    {tabWorkOrders.map((wo) => (
                      <WorkOrderCard key={`wo-${wo.id}`} wo={wo} />
                    ))}

                    {/* Grouped documents */}
                    {periods.length > 0 ? (
                      periods.map((period) => (
                        <Collapsible key={period} defaultOpen={true}>
                          <CollapsibleTrigger className="flex items-center gap-2 w-full p-3 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                            <ChevronDown className="w-4 h-4 transition-transform flex-shrink-0" />
                            <Calendar className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            <span className="font-semibold text-sm text-slate-900">{period}</span>
                            <span className="ml-auto text-xs text-slate-500">
                              {grouped[period].length} doc{grouped[period].length !== 1 ? "s" : ""}
                            </span>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="pt-2 pl-4 space-y-2">
                            {grouped[period].map((doc) => (
                              <DocumentCard key={doc.id} doc={doc} />
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      ))
                    ) : tabWorkOrders.length === 0 ? (
                      <p className="text-center py-10 text-slate-400 text-sm">Nenhum documento encontrado.</p>
                    ) : null}
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
        </div>
      )}

      {/* ── Page: Monitoring ── */}
      {activePage === "monitoring" && clientId && (
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => setActivePage("home")}
              className="md:hidden h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors text-slate-500"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Monitoramento</h2>
              <p className="text-sm text-slate-500">Controle de reservatórios em tempo real</p>
            </div>
          </div>
          <WaterTankContent clientId={clientId} clientName={clientName} />
        </div>
      )}

      {/* ── Footer ── */}
      <div className="mb-20">
        <SolutegFooter full={false} />
      </div>

      {/* ── Bottom Navigation (mobile only) ── */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-700 z-40 safe-area-bottom md:hidden">
        <div className="max-w-2xl mx-auto flex">
          <button
            onClick={() => setActivePage("home")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
              activePage === "home" ? "text-amber-400" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Home className="w-5 h-5" />
            <span>Início</span>
          </button>
          <button
            onClick={() => setActivePage("documents")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
              activePage === "documents" ? "text-amber-400" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FolderOpen className="w-5 h-5" />
            <span>Documentos</span>
          </button>
          <button
            onClick={() => setActivePage("monitoring")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
              activePage === "monitoring" ? "text-amber-400" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Activity className="w-5 h-5" />
            <span>Monitoramento</span>
          </button>
        </div>
      </nav>

      {/* ── Dialog: Profile Edit ── */}
      <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
        <DialogContent className="max-w-sm mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Perfil</DialogTitle>
            <DialogDescription>Atualize seus dados e foto de perfil.</DialogDescription>
          </DialogHeader>

          {/* Photo */}
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="relative">
              {profilePhotoPreview || profilePhoto ? (
                <img
                  src={profilePhotoPreview || profilePhoto!}
                  alt="Foto"
                  className="w-20 h-20 rounded-full object-cover ring-2 ring-amber-400"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-amber-500 flex items-center justify-center text-3xl font-bold text-white">
                  {getInitials(clientName)}
                </div>
              )}
            </div>
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoSelect}
              />
              <span className="flex items-center gap-1.5 text-xs text-amber-600 font-medium border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-50 transition-colors">
                <Upload className="w-3.5 h-3.5" /> Alterar foto (máx. 5MB)
              </span>
            </label>
          </div>

          <hr className="border-slate-200" />

          {/* Profile data */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Dados
            </p>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Nome do Cliente / Condomínio</label>
              <Input
                value={profileForm.name}
                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                placeholder="Nome"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Nome do Síndico</label>
              <Input
                value={profileForm.syndicName}
                onChange={(e) => setProfileForm({ ...profileForm, syndicName: e.target.value })}
                placeholder="Nome do síndico"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Telefone</label>
              <Input
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                placeholder="(00) 00000-0000"
              />
            </div>
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700"
              onClick={handleSaveProfile}
              disabled={updateProfileMutation.isPending || uploadPhotoMutation.isPending}
            >
              {(updateProfileMutation.isPending || uploadPhotoMutation.isPending)
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
                : "Salvar Dados"}
            </Button>
          </div>

          <hr className="border-slate-200" />

          {/* Password change */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Alterar Senha
            </p>
            <Input
              type="password"
              placeholder="Senha atual"
              value={profileForm.currentPassword}
              onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })}
            />
            <Input
              type="password"
              placeholder="Nova senha (mín. 6 caracteres)"
              value={profileForm.newPassword}
              onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })}
            />
            <Input
              type="password"
              placeholder="Confirmar nova senha"
              value={profileForm.confirmPassword}
              onChange={(e) => setProfileForm({ ...profileForm, confirmPassword: e.target.value })}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSavePassword}
              disabled={changePasswordMutation.isPending}
            >
              {changePasswordMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Alterando...</>
                : "Alterar Senha"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Create Work Order ── */}
      <Dialog open={isOpenDialogOpen} onOpenChange={setIsOpenDialogOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>
              {osType === "emergencial" ? "Solicitar Atendimento" : "Solicitar Orçamento"}
            </DialogTitle>
            <DialogDescription>Preencha os dados abaixo para sua solicitação.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateWorkOrder} className="space-y-3">
            <Input
              placeholder="Título *"
              value={osFormData.title}
              onChange={(e) => setOsFormData({ ...osFormData, title: e.target.value })}
              required
            />
            {osType === "orcamento" ? (
              <Select
                value={osFormData.serviceType}
                onValueChange={(v) => setOsFormData({ ...osFormData, serviceType: v })}
              >
                <SelectTrigger><SelectValue placeholder="Tipo de serviço *" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="instalacao">Instalação</SelectItem>
                  <SelectItem value="manutencao">Manutenção</SelectItem>
                  <SelectItem value="corretiva">Corretiva</SelectItem>
                  <SelectItem value="preventiva">Preventiva</SelectItem>
                  <SelectItem value="rotina">Rotina</SelectItem>
                  <SelectItem value="emergencial">Emergencial</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="Tipo de serviço"
                value={osFormData.serviceType}
                onChange={(e) => setOsFormData({ ...osFormData, serviceType: e.target.value })}
              />
            )}
            <Select
              value={osFormData.priority}
              onValueChange={(value: any) => setOsFormData({ ...osFormData, priority: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Prioridade Normal</SelectItem>
                <SelectItem value="alta">Prioridade Alta</SelectItem>
                <SelectItem value="critica">Prioridade Crítica</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Descrição..."
              value={osFormData.description}
              onChange={(e) => setOsFormData({ ...osFormData, description: e.target.value })}
              rows={3}
            />
            <Button type="submit" className="w-full bg-amber-600 hover:bg-amber-700" disabled={osLoading || createBudgetMutation.isPending}>
              {(osLoading || createBudgetMutation.isPending) ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</> : "Enviar Solicitação"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
