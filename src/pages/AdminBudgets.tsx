import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Eye, Trash2, Search, Loader2,
  ChevronLeft, ChevronRight, User, Calendar, ArrowLeft,
  FileText, CheckCircle, XCircle, Clock, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Checkbox } from "@/components/ui/checkbox";
import { useDebounce } from "../hooks/useDebounce";
import {
  formatCurrency,
  BUDGET_STATUS_LABEL as STATUS_LABEL,
  BUDGET_STATUS_COLOR as STATUS_COLOR,
  BUDGET_STATUS_STRIPE as STATUS_STRIPE,
  SERVICE_TYPE_LABEL as SERVICE_LABEL,
} from "@/lib/budgetUtils";

const STATUS_ICON: Record<string, React.ReactNode> = {
  pendente: <Clock className="w-3.5 h-3.5" />,
  finalizado: <AlertCircle className="w-3.5 h-3.5" />,
  aprovado: <CheckCircle className="w-3.5 h-3.5" />,
  reprovado: <XCircle className="w-3.5 h-3.5" />,
};

// ─── Componente principal ─────────────────────────────────────────────────

export default function AdminBudgets() {
  const [, navigate] = useLocation();

  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteSingleId, setDeleteSingleId] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.budgets.list.useQuery({
    page,
    limit: pageSize,
    search: debouncedSearch,
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  const budgets = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const { data: metrics } = trpc.budgets.getMetrics.useQuery();

  const deleteMutation = trpc.budgets.delete.useMutation({
    onSuccess: () => {
      toast.success("Orçamento excluído");
      setSelectedIds([]);
      setDeleteDialogOpen(false);
      setDeleteSingleId(null);
      refetch();
    },
    onError: (e: any) => toast.error("Erro ao excluir: " + e.message),
  });

  const toggleSelect = (id: number) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  return (
    <DashboardLayout>
    <div className="max-w-7xl mx-auto pb-12">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">Orçamentos</h1>
            <p className="text-slate-500 text-sm">Gerencie propostas e aprovações de serviços.</p>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            {selectedIds.length > 0 && (
              <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="w-4 h-4 mr-2" /> Excluir ({selectedIds.length})
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate("/gestor/dashboard")} className="gap-2 text-slate-600 hover:text-slate-900">
              <ArrowLeft className="w-4 h-4" /> Dashboard
            </Button>
            <Button onClick={() => navigate("/gestor/orcamentos/novo")}>
              <Plus className="w-4 h-4 mr-2" /> Novo Orçamento
            </Button>
          </div>
        </div>

        {/* Métricas rápidas */}
        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Pendentes", value: metrics.pending, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
              { label: "Ag. Aprovação", value: metrics.finalized, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200" },
              { label: "Aprovados", value: metrics.approved, color: "text-green-600", bg: "bg-green-50", border: "border-green-200" },
              { label: "Reprovados", value: metrics.rejected, color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
            ].map((m) => (
              <Card key={m.label} className={`p-3 border ${m.border} ${m.bg} shadow-none`}>
                <p className="text-xs text-slate-500 font-medium">{m.label}</p>
                <p className={`text-2xl font-extrabold ${m.color}`}>{m.value}</p>
              </Card>
            ))}
          </div>
        )}

        {/* Filtros */}
        <Card className="p-4 shadow-sm border-none bg-white">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar por número, título ou cliente..."
                className="pl-9 bg-slate-50"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-slate-50"><SelectValue placeholder="Filtrar por status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Status</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="finalizado">Ag. Aprovação</SelectItem>
                <SelectItem value="aprovado">Aprovado</SelectItem>
                <SelectItem value="reprovado">Reprovado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Lista */}
        <div className="mt-2">
          {isLoading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="animate-spin text-blue-600" />
            </div>
          ) : budgets.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Nenhum orçamento encontrado</p>
            </div>
          ) : (
            <div className="space-y-3">
              {budgets.map((budget) => {
                const stripeColor = STATUS_STRIPE[budget.status] ?? "#94a3b8";
                const isExpired =
                  budget.status === "finalizado" &&
                  budget.validUntil &&
                  new Date(budget.validUntil) < new Date();

                return (
                  <div
                    key={budget.id}
                    className="bg-white rounded-xl shadow-sm hover:shadow-md transition-all border-2 border-slate-200 cursor-pointer flex flex-col relative overflow-hidden"
                    onClick={() => navigate(`/gestor/orcamentos/${budget.id}`)}
                  >
                    {/* Barra lateral colorida por status */}
                    <div className="absolute left-0 top-0 bottom-0 w-[8px] z-20" style={{ backgroundColor: stripeColor }} />

                    {/* Faixa superior */}
                    <div className="px-4 py-1.5 flex justify-between items-center relative z-10 pl-6 bg-slate-800">
                      <span className="text-[10px] font-black uppercase tracking-widest text-white flex items-center gap-1.5">
                        <FileText className="w-3 h-3" /> Orçamento · {SERVICE_LABEL[budget.serviceType] ?? budget.serviceType}
                      </span>
                      <span className="text-[10px] font-bold text-white/80 font-mono">
                        #{budget.budgetNumber || budget.id}
                      </span>
                    </div>

                    {/* Conteúdo */}
                    <div className="p-4 flex items-center justify-between pl-8 relative z-10">
                      <div className="flex items-center gap-4 flex-1">
                        <div onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.includes(budget.id)}
                            onCheckedChange={() => toggleSelect(budget.id)}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge className={`text-xs font-semibold border ${STATUS_COLOR[budget.status]} flex items-center gap-1`}>
                              {STATUS_ICON[budget.status]}
                              {STATUS_LABEL[budget.status]}
                            </Badge>
                            {isExpired && (
                              <Badge className="text-xs bg-red-100 text-red-700 border-red-200 border">
                                Expirado
                              </Badge>
                            )}
                            {budget.generatedOsId && (
                              <Badge className="text-xs bg-purple-100 text-purple-700 border-purple-200 border">
                                OS Gerada
                              </Badge>
                            )}
                          </div>
                          <h3 className="text-slate-900 font-black text-lg leading-tight truncate">{budget.title}</h3>
                          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500 font-bold flex-wrap">
                            <span className="flex items-center gap-1">
                              <User className="w-3.5 h-3.5" /> {budget.clientName || "Sem cliente"}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5" /> {new Date(budget.createdAt).toLocaleDateString("pt-BR")}
                            </span>
                            {budget.totalValue ? (
                              <span className="text-green-700 font-extrabold">{formatCurrency(budget.totalValue)}</span>
                            ) : null}
                            {budget.validUntil && budget.status === "finalizado" && (
                              <span className={isExpired ? "text-red-600" : "text-slate-400"}>
                                Válido até {new Date(budget.validUntil).toLocaleDateString("pt-BR")}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Ações */}
                      <div className="flex items-center gap-2 ml-4 border-l pl-4 border-slate-100" onClick={(e) => e.stopPropagation()}>
                        <div
                          className="p-2 bg-slate-50 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"
                          onClick={() => navigate(`/gestor/orcamentos/${budget.id}`)}
                        >
                          <Eye className="w-5 h-5" />
                        </div>
                        <div
                          className="p-2 bg-slate-50 hover:bg-red-100 rounded-lg text-red-500 transition-colors"
                          onClick={() => { setDeleteSingleId(budget.id); setDeleteDialogOpen(true); }}
                        >
                          <Trash2 className="w-5 h-5" />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-6 border-t mt-6">
            <p className="text-sm text-slate-500 font-medium">Total: {totalCount}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                Próximo <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialog exclusão */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.{" "}
              {deleteSingleId ? "O orçamento será removido permanentemente." : `${selectedIds.length} orçamento(s) serão removidos permanentemente.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-3 mt-4">
            <AlertDialogCancel onClick={() => setDeleteSingleId(null)}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const ids = deleteSingleId ? [deleteSingleId] : selectedIds;
                ids.forEach((id) => deleteMutation.mutate({ id }));
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : "Excluir"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </DashboardLayout>
  );
}
