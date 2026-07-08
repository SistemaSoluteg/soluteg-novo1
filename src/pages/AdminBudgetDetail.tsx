import { useState, useEffect, useRef } from "react";
import { useLocation, useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import SignaturePad from "@/components/SignaturePad";
import {
  ArrowLeft, Save, FileText, Plus, Trash2, Loader2,
  CheckCircle, XCircle, History,
  Download, Share2, Send, ExternalLink, Package,
  User, DollarSign, ClipboardList, MessageCircle, Copy, ChevronDown,
  Camera, Pencil, X as XIcon,
} from "lucide-react";
import {
  formatCurrency,
  BUDGET_STATUS_LABEL as STATUS_LABEL,
  BUDGET_STATUS_COLOR as STATUS_COLOR,
  SERVICE_TYPE_LABEL,
} from "@/lib/budgetUtils";

const SERVICE_OPTIONS = Object.entries(SERVICE_TYPE_LABEL).map(([value, label]) => ({ value, label }));

const PRIORITY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica" },
];

const UNIT_OPTIONS = ["un", "m", "m²", "m³", "h", "kg", "l", "cx", "rolo", "par", "vb"];

// ─── Tipos locais ─────────────────────────────────────────────────────────

interface BudgetItem {
  id?: number;
  description: string;
  quantity: number;   // centésimos: 100 = 1,00
  unit: string;
  unitPrice: number;  // centavos
  totalPrice: number; // centavos
  orderIndex: number;
}

// ─── Componente principal ─────────────────────────────────────────────────

export default function AdminBudgetDetail() {
  const [, navigate] = useLocation();
  const [matchNew] = useRoute("/gestor/orcamentos/novo");
  const [matchDetail, params] = useRoute("/gestor/orcamentos/:id");

  const budgetId = matchDetail ? parseInt(params!.id) : null;
  const isNew = matchNew || !budgetId;

  const [adminId] = useState(() => parseInt(localStorage.getItem("adminId") ?? "1"));
  const [adminName] = useState(() => localStorage.getItem("adminName") ?? "Admin");

  // ─── Campos do formulário ─────────────────────────────────────────────
  const [clientId, setClientId] = useState<number | null>(null);
  const [serviceType, setServiceType] = useState("instalacao");
  const [priority, setPriority] = useState("normal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState("");
  const [validityDays, setValidityDays] = useState(30);
  const [internalNotes, setInternalNotes] = useState("");
  const [clientNotes, setClientNotes] = useState("");

  // ─── Itens ───────────────────────────────────────────────────────────
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [itemsDirty, setItemsDirty] = useState(false);

  // ─── Modais ──────────────────────────────────────────────────────────
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [techName, setTechName] = useState(adminName);
  const [techDoc, setTechDoc] = useState("");
  const [techSignature, setTechSignature] = useState("");

  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [clientSigName, setClientSigName] = useState("");
  const [clientSignature, setClientSignature] = useState("");

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // ─── Fotos ───────────────────────────────────────────────────────────
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<number | null>(null);
  const [editingCaptionText, setEditingCaptionText] = useState("");

  // ─── Queries / Mutations ─────────────────────────────────────────────
  const { data: budget, refetch: refetchBudget } = trpc.budgets.getById.useQuery(
    { id: budgetId! },
    { enabled: !!budgetId }
  );
  const { data: rawItems, refetch: refetchItems } = trpc.budgets.getItems.useQuery(
    { budgetId: budgetId! },
    { enabled: !!budgetId }
  );
  const { data: history } = trpc.budgets.getHistory.useQuery(
    { budgetId: budgetId! },
    { enabled: !!budgetId }
  );
  const { data: clientsData } = trpc.clients.list.useQuery(undefined);

  const createMutation = trpc.budgets.create.useMutation({
    onSuccess: (res) => { toast.success("Orçamento criado!"); navigate(`/gestor/orcamentos/${res.id}`); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMutation = trpc.budgets.update.useMutation({
    onSuccess: () => { toast.success("Salvo!"); refetchBudget(); },
    onError: (e: any) => toast.error(e.message),
  });
  const saveItemsMutation = trpc.budgets.saveItems.useMutation({
    onSuccess: () => { toast.success("Itens salvos!"); setItemsDirty(false); refetchBudget(); refetchItems(); },
    onError: (e: any) => toast.error(e.message),
  });
  const finalizeMutation = trpc.budgets.finalize.useMutation({
    onSuccess: (res) => {
      toast.success("Orçamento finalizado! Link de aprovação gerado.");
      setFinalizeModalOpen(false);
      refetchBudget();
      // Copia link para clipboard
      const url = `${window.location.origin}/orcamento/${res.token}`;
      navigator.clipboard.writeText(url).catch(() => {});
      toast.info("Link copiado para a área de transferência.", { duration: 5000 });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const approveMutation = trpc.budgets.approve.useMutation({
    onSuccess: (res) => {
      toast.success("Orçamento aprovado! OS gerada.");
      setApproveModalOpen(false);
      refetchBudget();
      if (res.osId) {
        setTimeout(() => navigate(`/gestor/work-orders/${res.osId}`), 1500);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });
  const generateOsMutation = trpc.budgets.generateOs.useMutation({
    onSuccess: (res) => {
      toast.success("OS gerada com sucesso!");
      refetchBudget();
      if (res.osId) setTimeout(() => navigate(`/gestor/work-orders/${res.osId}`), 1500);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const rejectMutation = trpc.budgets.rejectByAdmin.useMutation({
    onSuccess: () => { toast.success("Orçamento reprovado."); setRejectModalOpen(false); refetchBudget(); },
    onError: (e: any) => toast.error(e.message),
  });
  const exportPdfMutation = trpc.budgets.exportPDF.useMutation({
    onSuccess: (res) => {
      const link = document.createElement("a");
      link.href = `data:application/pdf;base64,${res.pdf}`;
      link.download = res.filename;
      link.click();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const sharePortalMutation = trpc.budgets.shareToPortal.useMutation({
    onSuccess: () => toast.success("Compartilhado no portal do cliente."),
    onError: (e: any) => toast.error(e.message),
  });
  const whatsappAdminMutation = trpc.budgets.sendWhatsappBudget.useMutation({
    onSuccess: () => toast.success("Orçamento enviado via WhatsApp para o admin."),
    onError: (e: any) => toast.error(e.message),
  });
  const whatsappClientMutation = trpc.budgets.sendWhatsappBudget.useMutation({
    onSuccess: () => toast.success("Orçamento enviado via WhatsApp para o cliente."),
    onError: (e: any) => toast.error(e.message),
  });

  // ─── Fotos: queries / mutations ───────────────────────────────────────
  const { data: photos = [], refetch: refetchPhotos } = (trpc as any).budgets.attachments.list.useQuery(
    { budgetId: budgetId! },
    { enabled: !!budgetId }
  );
  const createPhotoMutation = (trpc as any).budgets.attachments.create.useMutation({
    onSuccess: () => { toast.success("Foto adicionada!"); refetchPhotos(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateCaptionMutation = (trpc as any).budgets.attachments.updateCaption.useMutation({
    onSuccess: () => { setEditingCaptionId(null); refetchPhotos(); },
    onError: (e: any) => toast.error(e.message),
  });
  const deletePhotoMutation = (trpc as any).budgets.attachments.delete.useMutation({
    onSuccess: () => { toast.success("Foto removida."); refetchPhotos(); },
    onError: (e: any) => toast.error(e.message),
  });

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !budgetId) return;
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetch("/api/work-orders/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Erro no upload");
      for (const u of data.urls) {
        await createPhotoMutation.mutateAsync({
          budgetId,
          fileName:   u.fileName,
          fileKey:    u.key,
          fileUrl:    u.url,
          fileType:   u.fileType,
          fileSize:   u.fileSize,
          uploadedBy: adminName,
        });
      }
      toast.success(`${data.urls.length} foto(s) adicionada(s)!`);
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar foto");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  // ─── Preenche formulário ao carregar ─────────────────────────────────
  useEffect(() => {
    if (!budget) return;
    setClientId(budget.clientId);
    setServiceType(budget.serviceType);
    setPriority(budget.priority);
    setTitle(budget.title);
    setDescription(budget.description ?? "");
    setScope(budget.scope ?? "");
    setValidityDays(budget.validityDays);
    setInternalNotes(budget.internalNotes ?? "");
    setClientNotes(budget.clientNotes ?? "");
  }, [budget]);

  useEffect(() => {
    if (!rawItems) return;
    setItems(rawItems.map((it: any) => ({ ...it })));
  }, [rawItems]);

  // ─── Helpers de itens ─────────────────────────────────────────────────

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { description: "", quantity: 100, unit: "un", unitPrice: 0, totalPrice: 0, orderIndex: prev.length },
    ]);
    setItemsDirty(true);
  };

  const addLaborItem = () => {
    setItems((prev) => [
      ...prev,
      { description: "Mão de Obra", quantity: 100, unit: "vb", unitPrice: 0, totalPrice: 0, orderIndex: prev.length },
    ]);
    setItemsDirty(true);
  };

  const updateItem = (idx: number, field: keyof BudgetItem, raw: string | number) => {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[idx] };
      (item as any)[field] = raw;

      if (field === "quantity" || field === "unitPrice") {
        const qty = field === "quantity" ? Number(raw) : item.quantity;
        const price = field === "unitPrice" ? Number(raw) : item.unitPrice;
        item.totalPrice = Math.round((qty / 100) * price);
      }
      updated[idx] = item;
      return updated;
    });
    setItemsDirty(true);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, orderIndex: i })));
    setItemsDirty(true);
  };

  const grandTotal = items.reduce((s, it) => s + it.totalPrice, 0);

  // ─── Salvar cabeçalho ─────────────────────────────────────────────────

  const handleSave = () => {
    if (!title.trim()) { toast.error("Informe o título"); return; }

    if (isNew) {
      if (!clientId) { toast.error("Selecione um cliente"); return; }
      createMutation.mutate({
        clientId,
        serviceType: serviceType as any,
        priority: priority as any,
        title,
        description: description || undefined,
        scope: scope || undefined,
        validityDays,
        internalNotes: internalNotes || undefined,
        clientNotes: clientNotes || undefined,
      });
    } else {
      updateMutation.mutate({
        id: budgetId!,
        serviceType: serviceType as any,
        priority: priority as any,
        title,
        description: description || undefined,
        scope: scope || undefined,
        validityDays,
        internalNotes: internalNotes || undefined,
        clientNotes: clientNotes || undefined,
        totalValue: grandTotal > 0 ? grandTotal : undefined,
        saveSnapshot: budget?.status === "finalizado",
      });
    }
  };

  const handleSaveItems = () => {
    if (!budgetId) return;
    saveItemsMutation.mutate({ budgetId, items });
  };

  // ─── Finalizar ────────────────────────────────────────────────────────

  const handleFinalize = () => {
    if (!techSignature) { toast.error("Assine antes de finalizar"); return; }
    if (!techName.trim()) { toast.error("Informe o nome do responsável"); return; }
    finalizeMutation.mutate({
      id: budgetId!,
      technicianName: techName,
      technicianSignature: techSignature,
      technicianDocument: techDoc || undefined,
      validityDays,
      adminId,
    });
  };

  // ─── Aprovar (pelo admin) ─────────────────────────────────────────────

  const handleApprove = () => {
    if (!clientSignature) { toast.error("Assinatura do cliente é obrigatória"); return; }
    if (!clientSigName.trim()) { toast.error("Informe o nome do aprovador"); return; }
    approveMutation.mutate({
      token: budget!.approvalToken!,
      clientSignature,
      clientSignatureName: clientSigName,
      approvedBy: clientSigName,
      createOs: true,
    });
  };

  // ─── Copiar link de aprovação ─────────────────────────────────────────

  const copyApprovalLink = () => {
    if (!budget?.approvalToken) { toast.error("Finalize o orçamento primeiro para gerar o link"); return; }
    const url = `${window.location.origin}/orcamento/${budget.approvalToken}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Link copiado!"));
  };

  // Permite edição tanto no status "pendente" quanto em "finalizado" (para revisar antes de re-finalizar)
  const isEditable = !budget || ["pendente", "finalizado"].includes(budget.status);
  const canFinalize = budget && ["pendente", "finalizado"].includes(budget.status);
  const canApprove = budget?.status === "finalizado";
  const canReject = budget?.status === "finalizado";

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto pb-32">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate("/gestor/orcamentos")} className="gap-2 text-slate-600">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              {isNew ? "Novo Orçamento" : budget?.budgetNumber ?? "Orçamento"}
            </h1>
            {budget && (
              <Badge className={`text-xs mt-0.5 border ${STATUS_COLOR[budget.status]}`}>
                {STATUS_LABEL[budget.status]}
              </Badge>
            )}
          </div>
        </div>

        {/* Ações rápidas */}
        {budget && (
          <div className="flex items-center gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Share2 className="w-4 h-4" /> Compartilhar <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {budget.approvalToken && (
                  <DropdownMenuItem onClick={copyApprovalLink} className="gap-2 cursor-pointer">
                    <Copy className="w-4 h-4" /> Copiar link de aprovação
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => sharePortalMutation.mutate({ id: budgetId! })} className="gap-2 cursor-pointer">
                  <Share2 className="w-4 h-4" /> Enviar para portal do cliente
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => whatsappAdminMutation.mutate({ id: budgetId!, target: "admin" })}
                  disabled={whatsappAdminMutation.isPending}
                  className="gap-2 cursor-pointer text-green-700 focus:text-green-700"
                >
                  {whatsappAdminMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />} WhatsApp Admin
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => whatsappClientMutation.mutate({ id: budgetId!, target: "client" })}
                  disabled={whatsappClientMutation.isPending}
                  className="gap-2 cursor-pointer text-green-700 focus:text-green-700"
                >
                  {whatsappClientMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />} WhatsApp Cliente
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => exportPdfMutation.mutate({ id: budgetId! })}
                  disabled={exportPdfMutation.isPending}
                  className="gap-2 cursor-pointer"
                >
                  {exportPdfMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canFinalize && (
              <Button size="sm" onClick={() => {
                if (itemsDirty) { toast.error("Salve os itens antes de finalizar"); return; }
                if (grandTotal <= 0) { toast.error("Adicione itens com preço antes de finalizar. O orçamento não pode ter valor zero."); return; }
                setFinalizeModalOpen(true);
              }} className="gap-2 bg-blue-600 hover:bg-blue-700">
                <Send className="w-4 h-4" /> {budget.status === "finalizado" ? "Re-Finalizar (Revisão)" : "Finalizar"}
              </Button>
            )}
            {canApprove && (
              <Button size="sm" onClick={() => setApproveModalOpen(true)} className="gap-2 bg-green-600 hover:bg-green-700">
                <CheckCircle className="w-4 h-4" /> Aprovar (Admin)
              </Button>
            )}
            {canReject && (
              <Button size="sm" variant="destructive" onClick={() => setRejectModalOpen(true)} className="gap-2">
                <XCircle className="w-4 h-4" /> Reprovar
              </Button>
            )}
            {budget.generatedOsId && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/gestor/work-orders/${budget.generatedOsId}`)} className="gap-2">
                <ExternalLink className="w-4 h-4" /> Ver OS Gerada
              </Button>
            )}
            {budget.status === "aprovado" && (
              <Button size="sm" variant="outline" onClick={() => generateOsMutation.mutate({ id: budgetId! })} disabled={generateOsMutation.isPending} className="gap-2 text-green-700 border-green-300 hover:bg-green-50">
                {generateOsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Gerar OS
              </Button>
            )}
          </div>
        )}
      </div>

      <Tabs defaultValue="dados">
        <TabsList className="mb-6">
          <TabsTrigger value="dados"><ClipboardList className="w-4 h-4 mr-2" />Dados</TabsTrigger>
          <TabsTrigger value="itens" disabled={isNew}><Package className="w-4 h-4 mr-2" />Itens</TabsTrigger>
          <TabsTrigger value="fotos" disabled={isNew}><Camera className="w-4 h-4 mr-2" />Fotos ({photos.length})</TabsTrigger>
          <TabsTrigger value="historico" disabled={isNew}><History className="w-4 h-4 mr-2" />Histórico</TabsTrigger>
        </TabsList>

        {/* ─── Aba Dados ─────────────────────────────────────────────────── */}
        <TabsContent value="dados">
          <div className="space-y-6">

            {/* Bloco: Info básica */}
            <Card>
              <CardHeader><CardTitle className="text-base">Informações Básicas</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {isNew && (
                  <div>
                    <Label>Cliente *</Label>
                    <Select value={clientId ? String(clientId) : ""} onValueChange={(v) => setClientId(parseInt(v))}>
                      <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                      <SelectContent>
                        {(clientsData ?? []).map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {!isNew && budget && (
                  <div className="flex items-center gap-2 text-slate-700 text-sm font-medium">
                    <User className="w-4 h-4 text-slate-400" /> {budget.clientName}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Tipo de Serviço *</Label>
                    <Select value={serviceType} onValueChange={setServiceType} disabled={!isEditable && !isNew}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SERVICE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-400 mt-1">Define o tipo de OS gerada ao aprovar</p>
                  </div>
                  <div>
                    <Label>Prioridade</Label>
                    <Select value={priority} onValueChange={setPriority} disabled={!isEditable && !isNew}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Título *</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Manutenção do sistema de bombeamento" disabled={!isEditable && !isNew} />
                </div>

                <div>
                  <Label>Descrição</Label>
                  <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contexto do serviço..." disabled={!isEditable && !isNew} />
                </div>

                <div>
                  <Label>Escopo dos Serviços</Label>
                  <Textarea rows={5} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Descreva em detalhes os serviços incluídos neste orçamento..." disabled={!isEditable && !isNew} />
                </div>
              </CardContent>
            </Card>

            {/* Bloco: Validade e valores */}
            <Card>
              <CardHeader><CardTitle className="text-base">Valores e Validade</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Validade (dias)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={validityDays}
                      onChange={(e) => setValidityDays(parseInt(e.target.value) || 30)}
                      disabled={!isEditable && !isNew}
                    />
                    <p className="text-xs text-slate-400 mt-1">A partir da data de finalização</p>
                  </div>
                  <div>
                    <Label>Total Estimado</Label>
                    <div className="h-10 flex items-center px-3 bg-slate-50 rounded-md border text-green-700 font-bold text-sm">
                      {formatCurrency(grandTotal)}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Soma dos itens (incluindo mão de obra)</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bloco: Notas */}
            <Card>
              <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Notas para o Cliente</Label>
                  <Textarea rows={3} value={clientNotes} onChange={(e) => setClientNotes(e.target.value)} placeholder="Condições de pagamento, prazo de execução, garantias..." disabled={!isEditable && !isNew} />
                </div>
                <div>
                  <Label>Notas Internas</Label>
                  <Textarea rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="Anotações internas (não aparecem no PDF)..." />
                </div>
              </CardContent>
            </Card>

            {/* Assinaturas (se existirem) */}
            {budget && (budget.technicianSignature || budget.clientSignature) && (
              <Card>
                <CardHeader><CardTitle className="text-base">Assinaturas</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {budget.technicianSignature && (
                      <div className="text-center">
                        <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Responsável Técnico</p>
                        <img src={budget.technicianSignature} alt="Assinatura técnico" className="border rounded-lg max-h-28 mx-auto" />
                        <p className="text-sm font-medium text-slate-700 mt-1">{budget.technicianName}</p>
                        {budget.finalizedAt && (
                          <p className="text-xs text-slate-400">{new Date(budget.finalizedAt).toLocaleString("pt-BR")}</p>
                        )}
                      </div>
                    )}
                    {budget.clientSignature && (
                      <div className="text-center">
                        <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Cliente / Aprovador</p>
                        <img src={budget.clientSignature} alt="Assinatura cliente" className="border rounded-lg max-h-28 mx-auto" />
                        <p className="text-sm font-medium text-slate-700 mt-1">{budget.clientSignatureName}</p>
                        {budget.approvedAt && (
                          <p className="text-xs text-slate-400">{new Date(budget.approvedAt).toLocaleString("pt-BR")}</p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Botão salvar */}
            {(isNew || isEditable) && (
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="w-full gap-2">
                {createMutation.isPending || updateMutation.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <Save className="w-4 h-4" />}
                {isNew ? "Criar Orçamento" : "Salvar Alterações"}
              </Button>
            )}
            {!isNew && !isEditable && (
              <p className="text-center text-sm text-slate-400">
                Orçamento {STATUS_LABEL[budget?.status ?? ""]}. Para editar, clique em "Re-Finalizar".
              </p>
            )}
          </div>
        </TabsContent>

        {/* ─── Aba Itens ─────────────────────────────────────────────────── */}
        <TabsContent value="itens">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-slate-800">Itens do Orçamento</h2>
              {(isEditable || budget?.status === "finalizado") && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={addLaborItem} variant="outline" className="gap-2 text-blue-700 border-blue-200 hover:bg-blue-50">
                    <Plus className="w-4 h-4" /> Mão de Obra
                  </Button>
                  <Button size="sm" onClick={addItem} variant="outline" className="gap-2">
                    <Plus className="w-4 h-4" /> Adicionar Item
                  </Button>
                </div>
              )}
            </div>

            {/* Tabela de itens */}
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left p-3 font-semibold text-slate-600">Descrição</th>
                      <th className="text-center p-3 font-semibold text-slate-600 w-24">Qtd.</th>
                      <th className="text-center p-3 font-semibold text-slate-600 w-20">Un.</th>
                      <th className="text-right p-3 font-semibold text-slate-600 w-28">Vl. Unit.</th>
                      <th className="text-right p-3 font-semibold text-slate-600 w-28">Total</th>
                      {(isEditable || budget?.status === "finalizado") && <th className="w-12" />}
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-slate-400 py-8">
                          Nenhum item adicionado. Clique em "Adicionar Item".
                        </td>
                      </tr>
                    ) : (
                      items.map((item, idx) => (
                        <tr key={idx} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="p-2">
                            <Input
                              value={item.description}
                              onChange={(e) => updateItem(idx, "description", e.target.value)}
                              placeholder="Descrição do item..."
                              className="border-0 shadow-none focus-visible:ring-0 bg-transparent"
                              disabled={!isEditable && budget?.status !== "finalizado"}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              value={item.quantity / 100}
                              onChange={(e) => updateItem(idx, "quantity", Math.round(parseFloat(e.target.value || "0") * 100))}
                              className="border-0 shadow-none focus-visible:ring-0 bg-transparent text-center w-20"
                              disabled={!isEditable && budget?.status !== "finalizado"}
                            />
                          </td>
                          <td className="p-2">
                            <Select
                              value={item.unit}
                              onValueChange={(v) => updateItem(idx, "unit", v)}
                              disabled={!isEditable && budget?.status !== "finalizado"}
                            >
                              <SelectTrigger className="border-0 shadow-none w-16 h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {UNIT_OPTIONS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              value={item.unitPrice / 100}
                              onChange={(e) => updateItem(idx, "unitPrice", Math.round(parseFloat(e.target.value || "0") * 100))}
                              className="border-0 shadow-none focus-visible:ring-0 bg-transparent text-right w-24 ml-auto"
                              disabled={!isEditable && budget?.status !== "finalizado"}
                            />
                          </td>
                          <td className="p-3 text-right font-semibold text-slate-700">
                            {formatCurrency(item.totalPrice)}
                          </td>
                          {(isEditable || budget?.status === "finalizado") && (
                            <td className="p-2 text-center">
                              <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                  {items.length > 0 && (
                    <tfoot className="bg-slate-50 border-t">
                      <tr>
                        <td colSpan={4} className="p-3 text-right font-black text-slate-800 text-base">TOTAL</td>
                        <td className="p-3 text-right font-black text-green-700 text-base">{formatCurrency(grandTotal)}</td>
                        {(isEditable || budget?.status === "finalizado") && <td />}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </CardContent>
            </Card>

            {(isEditable || budget?.status === "finalizado") && itemsDirty && (
              <Button onClick={handleSaveItems} disabled={saveItemsMutation.isPending} className="gap-2">
                {saveItemsMutation.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <Save className="w-4 h-4" />}
                Salvar Itens
              </Button>
            )}
          </div>
        </TabsContent>

        {/* ─── Aba Fotos ──────────────────────────────────────────────────── */}
        <TabsContent value="fotos">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-800">Fotos do Local (Antes)</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Estas fotos serão copiadas automaticamente como anexos "Antes" na OS gerada após aprovação.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto}
              >
                {uploadingPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                {uploadingPhoto ? "Enviando..." : "Adicionar Fotos"}
              </Button>
              <input
                ref={photoInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </div>

            {photos.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                  <Camera className="w-10 h-10 opacity-30" />
                  <p className="text-sm">Nenhuma foto adicionada ainda.</p>
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => photoInputRef.current?.click()}>
                    <Camera className="w-4 h-4" /> Adicionar primeira foto
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {photos.map((photo: any) => (
                  <div key={photo.id} className="group relative rounded-lg border overflow-hidden bg-white shadow-sm">
                    {/* Imagem */}
                    <a href={photo.fileUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={photo.fileUrl}
                        alt={photo.fileName}
                        className="w-full aspect-square object-cover"
                      />
                    </a>

                    {/* Botão excluir */}
                    <button
                      className="absolute top-1.5 right-1.5 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow"
                      onClick={() => deletePhotoMutation.mutate({ id: photo.id })}
                      title="Remover foto"
                    >
                      <XIcon className="w-3 h-3" />
                    </button>

                    {/* Legenda */}
                    <div className="p-2">
                      {editingCaptionId === photo.id ? (
                        <div className="flex gap-1">
                          <input
                            autoFocus
                            className="flex-1 text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            value={editingCaptionText}
                            onChange={(e) => setEditingCaptionText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") updateCaptionMutation.mutate({ id: photo.id, caption: editingCaptionText });
                              if (e.key === "Escape") setEditingCaptionId(null);
                            }}
                            placeholder="Legenda..."
                          />
                          <button
                            className="text-blue-600 hover:text-blue-800"
                            onClick={() => updateCaptionMutation.mutate({ id: photo.id, caption: editingCaptionText })}
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center gap-1 cursor-pointer group/caption"
                          onClick={() => { setEditingCaptionId(photo.id); setEditingCaptionText(photo.caption ?? ""); }}
                        >
                          <span className={`text-xs flex-1 truncate ${photo.caption ? "text-slate-700" : "text-slate-400 italic"}`}>
                            {photo.caption || "Adicionar legenda..."}
                          </span>
                          <Pencil className="w-3 h-3 text-slate-300 group-hover/caption:text-slate-500 flex-shrink-0" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ─── Aba Histórico ──────────────────────────────────────────────── */}
        <TabsContent value="historico">
          <div className="space-y-3">
            {!history || history.length === 0 ? (
              <p className="text-center text-slate-400 py-8">Nenhuma ação registrada ainda.</p>
            ) : (
              history.map((h: any) => (
                <div key={h.id} className="flex gap-3 p-3 bg-white rounded-lg border border-slate-200">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <History className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm capitalize text-slate-800">{h.action}</span>
                      {h.newStatus && (
                        <Badge className={`text-xs border ${STATUS_COLOR[h.newStatus] ?? "bg-slate-100 text-slate-700 border-slate-200"}`}>
                          {STATUS_LABEL[h.newStatus] ?? h.newStatus}
                        </Badge>
                      )}
                      <span className="text-xs text-slate-400 ml-auto">
                        {new Date(h.createdAt).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    {h.notes && <p className="text-xs text-slate-500 mt-1">{h.notes}</p>}
                    {h.snapshotData && (
                      <p className="text-xs text-blue-500 mt-1 italic">Snapshot salvo nesta revisão</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── Modal: Finalizar ──────────────────────────────────────────────── */}
      <Dialog open={finalizeModalOpen} onOpenChange={setFinalizeModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {budget?.status === "finalizado" ? "Re-Finalizar (Nova Revisão)" : "Finalizar Orçamento"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                Valor total do orçamento: <span className="font-bold">{formatCurrency(grandTotal)}</span>
              </p>
            </div>
            {budget?.status === "finalizado" && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                Ao re-finalizar, uma nova revisão será salva no histórico e um novo link de aprovação será gerado.
              </div>
            )}
            <div>
              <Label>Nome do Responsável *</Label>
              <Input value={techName} onChange={(e) => setTechName(e.target.value)} placeholder="Nome completo" />
            </div>
            <div>
              <Label>CPF / RG (opcional)</Label>
              <Input value={techDoc} onChange={(e) => setTechDoc(e.target.value)} placeholder="000.000.000-00" />
            </div>
            <div>
              <Label>Assinatura *</Label>
              <SignaturePad onSave={setTechSignature} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setFinalizeModalOpen(false)}>Cancelar</Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 gap-2"
                onClick={handleFinalize}
                disabled={finalizeMutation.isPending}
              >
                {finalizeMutation.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <Send className="w-4 h-4" />}
                Finalizar e Enviar Link
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Modal: Aprovar pelo Admin ─────────────────────────────────────── */}
      <Dialog open={approveModalOpen} onOpenChange={setApproveModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Aprovar Orçamento (Admin)</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
              Ao aprovar, uma OS de serviço será criada automaticamente.
            </div>
            <div>
              <Label>Nome do Aprovador *</Label>
              <Input value={clientSigName} onChange={(e) => setClientSigName(e.target.value)} placeholder="Nome do representante" />
            </div>
            <div>
              <Label>Assinatura *</Label>
              <SignaturePad onSave={setClientSignature} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setApproveModalOpen(false)}>Cancelar</Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700 gap-2" onClick={handleApprove} disabled={approveMutation.isPending}>
                {approveMutation.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                Aprovar e Gerar OS
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Modal: Reprovar ───────────────────────────────────────────────── */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Reprovar Orçamento</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Motivo da Reprovação *</Label>
              <Textarea
                rows={4}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Descreva o motivo da reprovação..."
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setRejectModalOpen(false)}>Cancelar</Button>
              <Button
                variant="destructive"
                className="flex-1 gap-2"
                disabled={rejectMutation.isPending || !rejectReason.trim()}
                onClick={() => rejectMutation.mutate({ id: budgetId!, rejectionReason: rejectReason })}
              >
                {rejectMutation.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                Confirmar Reprovação
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
