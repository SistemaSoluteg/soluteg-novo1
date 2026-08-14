import { StatusBadge, PriorityBadge } from "../components/StatusBadge";
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Search, User, DollarSign } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useDebounce } from "../hooks/useDebounce";

type WorkOrderStatus = "aberta" | "aguardando_aprovacao" | "em_andamento" | "concluida" | "cancelada";

const STATUS_COLUMNS: { status: WorkOrderStatus; label: string; color: string }[] = [
  { status: "aberta", label: "Aberta", color: "border-blue-200 bg-blue-50" },
  { status: "aguardando_aprovacao", label: "Aguardando", color: "border-yellow-200 bg-yellow-50" },
  { status: "em_andamento", label: "Em Andamento", color: "border-purple-200 bg-purple-50" },
  { status: "concluida", label: "Concluída", color: "border-emerald-200 bg-emerald-50" },
  { status: "cancelada", label: "Cancelada", color: "border-red-200 bg-red-50" },
];

const TYPE_CONFIG = {
  rotina: { label: "Rotina", color: "bg-blue-100 text-blue-800" },
  emergencial: { label: "Emergencial", color: "bg-red-100 text-red-800" },
  orcamento: { label: "Orçamento", color: "bg-purple-100 text-purple-800" },
};

export default function AdminWorkOrderKanban() {
  const [, navigate] = useLocation();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 500);

  const { data, isLoading, refetch } = trpc.workOrders.list.useQuery({
    search: debouncedSearch,
    limit: 100,
  });

  const workOrders = data?.items ?? [];
  const updateStatusMutation = trpc.workOrders.updateStatus.useMutation();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const filteredWorkOrders = workOrders.filter((wo) => {
    if (filterType !== "all" && wo.type !== filterType) return false;
    if (filterPriority !== "all" && wo.priority !== filterPriority) return false;
    return true;
  });

  const groupedWorkOrders = STATUS_COLUMNS.reduce((acc, column) => {
    acc[column.status] = filteredWorkOrders.filter((wo) => wo.status === column.status);
    return acc;
  }, {} as Record<WorkOrderStatus, typeof workOrders>);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const workOrderId = active.id as number;
    const newStatus = over.id as WorkOrderStatus;
    const workOrder = workOrders.find((wo) => wo.id === workOrderId);
    if (!workOrder || workOrder.status === newStatus) return;
    try {
      await updateStatusMutation.mutateAsync({ id: workOrderId, newStatus, notes: "Alterado via Kanban" });
      toast.success("Status atualizado!");
      refetch();
    } catch (e) { toast.error("Erro ao atualizar"); }
  };

  if (isLoading) return <div className="flex justify-center p-20"><Loader2 className="animate-spin" /></div>;

  return (
    <DashboardLayout>
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Kanban Soluteg</h1>
        <Button onClick={() => navigate("/gestor/work-orders/new")}>Nova OS</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-4 rounded-lg shadow-sm border">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <Input placeholder="Buscar OS..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Tipos</SelectItem>
            <SelectItem value="rotina">Rotina</SelectItem>
            <SelectItem value="emergencial">Emergencial</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Prioridades</SelectItem>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="critica">Crítica</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DndContext sensors={sensors} onDragStart={(e) => setActiveId(e.active.id as number)} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {STATUS_COLUMNS.map((col) => (
            <KanbanColumn key={col.status} {...col} workOrders={groupedWorkOrders[col.status] || []} onCardClick={(id: number) => navigate(`/gestor/work-orders/${id}`)} />
          ))}
        </div>
        <DragOverlay>
          {activeId && <WorkOrderCard workOrder={workOrders.find(w => w.id === activeId)} isDragging />}
        </DragOverlay>
      </DndContext>
    </div>
    </DashboardLayout>
  );
}

function KanbanColumn({ status, label, color, workOrders, onCardClick }: any) {
  return (
    <div className="flex flex-col gap-3">
      <div className={`p-3 rounded-t-lg border-b-2 font-bold text-sm ${color}`}>{label} ({workOrders.length})</div>
      <div id={status} className="min-h-[500px] bg-gray-50/50 p-2 rounded-b-lg space-y-3 border">
        {workOrders.map((wo: any) => (
          <div key={wo.id} onClick={() => onCardClick(wo.id)}><WorkOrderCard workOrder={wo} /></div>
        ))}
      </div>
    </div>
  );
}

function WorkOrderCard({ workOrder, isDragging }: any) {
  const typeStyle = TYPE_CONFIG[workOrder.type as keyof typeof TYPE_CONFIG] || TYPE_CONFIG.rotina;
  return (
    <Card className={`hover:shadow-md transition-all ${isDragging ? "opacity-50" : ""}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between items-start">
          <span className="text-[10px] font-mono text-gray-500">#{workOrder.osNumber}</span>
          <PriorityBadge priority={workOrder.priority} />
        </div>
        <h4 className="font-bold text-sm text-gray-800 leading-tight">{workOrder.title}</h4>
        <div className="flex gap-2"><Badge className={`${typeStyle.color} text-[10px]`}>{typeStyle.label}</Badge><StatusBadge status={workOrder.status} /></div>
        <div className="pt-2 border-t space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <User className="w-3 h-3" /> <span className="truncate">{workOrder.clientName || "Sem Cliente"}</span>
          </div>
          {workOrder.technicianName && (
            <div className="flex items-center gap-2 text-xs text-blue-600">
              <User className="w-3 h-3" /> <span className="truncate">{workOrder.technicianName}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}