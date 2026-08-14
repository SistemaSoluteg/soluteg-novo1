import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Plus, X, RefreshCw, AlertCircle, Wrench, Calendar } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type OSType = "rotina" | "emergencial" | "instalacao" | "manutencao" | "corretiva" | "preventiva";
type OSPriority = "normal" | "alta" | "critica";
type RecurrenceType = "mensal_fixo" | "mensal_inicio";

export default function AdminCreateWorkOrderNew() {
  const [, navigate] = useLocation();
  const [adminId] = useState(() => {
    const stored = localStorage.getItem("adminId");
    return stored ? parseInt(stored) : 1;
  });

  const [formData, setFormData] = useState({
    clientId: "",
    technicianId: "",
    type: "emergencial" as OSType,
    priority: "normal" as OSPriority,
    title: "",
    description: "",
    serviceType: "",
    scheduledDate: "",
    estimatedHours: "",
    estimatedValue: "",
    isRecurring: false,
    recurrenceType: "mensal_inicio" as RecurrenceType,
    recurrenceDay: "1",
  });

  const [showClientForm, setShowClientForm] = useState(false);
  const [clientForm, setClientForm] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    phone: "",
    cnpjCpf: "",
  });

  // Queries
  const { data: clients = [], refetch: refetchClients } = trpc.clients.list.useQuery(undefined);
  const { data: techniciansList = [] } = (trpc as any).technicians.list.useQuery({ adminId }, { staleTime: 60_000 });
  const createWorkOrderMutation = trpc.workOrders.create.useMutation();
  const createClientMutation = trpc.clients.create.useMutation();

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateClient = async () => {
    if (!clientForm.name || !clientForm.username || !clientForm.password) {
      toast.error("Preencha os campos obrigatórios do cliente");
      return;
    }

    try {
      await createClientMutation.mutateAsync({
        name: clientForm.name,
        email: clientForm.email || "",
        username: clientForm.username,
        password: clientForm.password,
        phone: clientForm.phone || "",
        cnpjCpf: clientForm.cnpjCpf || "",
      });

      toast.success("Cliente criado com sucesso!");
      setShowClientForm(false);
      setClientForm({ name: "", email: "", username: "", password: "", phone: "", cnpjCpf: "" });
      refetchClients();
    } catch (error) {
      toast.error("Erro ao criar cliente");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.clientId) {
      toast.error("Selecione um cliente");
      return;
    }

    if (!formData.title) {
      toast.error("Preencha o título da OS");
      return;
    }

    try {
      const result = await createWorkOrderMutation.mutateAsync({
        clientId: parseInt(formData.clientId),
        technicianId: formData.technicianId ? parseInt(formData.technicianId) : undefined,
        type: formData.type,
        priority: formData.priority,
        title: formData.title,
        description: formData.description || undefined,
        serviceType: formData.serviceType || undefined,
        scheduledDate: formData.scheduledDate || undefined,
        estimatedHours: formData.estimatedHours ? parseInt(formData.estimatedHours) : undefined,
        estimatedValue: formData.estimatedValue ? parseFloat(formData.estimatedValue) : undefined,
        isRecurring: formData.isRecurring ? 1 : 0,
        recurrenceType: formData.isRecurring ? formData.recurrenceType : undefined,
        recurrenceDay: formData.isRecurring && formData.recurrenceType === "mensal_fixo"
          ? parseInt(formData.recurrenceDay)
          : undefined,
      });

      toast.success(`OS ${result.osNumber} criada com sucesso!`);
      navigate("/gestor/work-orders");
    } catch (error) {
      toast.error("Erro ao criar OS");
    }
  };

  const getTypeIcon = (type: OSType) => {
    const icons: Record<OSType, React.ElementType> = {
      rotina: RefreshCw,
      emergencial: AlertCircle,
      instalacao: Wrench,
      manutencao: Wrench,
      corretiva: Wrench,
      preventiva: Wrench,
    };
    return icons[type];
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold mb-2">Nova Ordem de Serviço</h1>
              <p className="text-gray-600">Preencha os dados para criar uma nova OS</p>
            </div>
            <Button variant="outline" onClick={() => navigate("/gestor/work-orders")}>
              ← Voltar
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Tipo de OS */}
          <Card className="p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Tipo de OS</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {(["rotina", "emergencial", "instalacao", "manutencao", "corretiva", "preventiva"] as OSType[]).map((type) => {
                const Icon = getTypeIcon(type);
                const labels: Record<OSType, string> = {
                  rotina: "Rotina",
                  emergencial: "Emergencial",
                  instalacao: "Instalação",
                  manutencao: "Manutenção",
                  corretiva: "Corretiva",
                  preventiva: "Preventiva",
                };
                const descriptions: Record<OSType, string> = {
                  rotina: "Manutenção programada",
                  emergencial: "Atendimento urgente",
                  instalacao: "Instalação de equipamentos",
                  manutencao: "Manutenção geral",
                  corretiva: "Correção de falhas",
                  preventiva: "Prevenção de problemas",
                };
                const activeColors: Record<OSType, string> = {
                  rotina: "border-blue-500 bg-blue-50",
                  emergencial: "border-red-500 bg-red-50",
                  instalacao: "border-green-500 bg-green-50",
                  manutencao: "border-amber-500 bg-amber-50",
                  corretiva: "border-orange-500 bg-orange-50",
                  preventiva: "border-purple-500 bg-purple-50",
                };
                const iconColors: Record<OSType, string> = {
                  rotina: "text-blue-600",
                  emergencial: "text-red-600",
                  instalacao: "text-green-600",
                  manutencao: "text-amber-600",
                  corretiva: "text-orange-600",
                  preventiva: "text-purple-600",
                };

                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleSelectChange("type", type)}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      formData.type === type ? activeColors[type] : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <Icon className={`w-6 h-6 mb-2 ${iconColors[type]}`} />
                    <p className="font-semibold">{labels[type]}</p>
                    <p className="text-sm text-gray-600">{descriptions[type]}</p>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Cliente */}
          <Card className="p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Cliente</h2>
            
            {!showClientForm ? (
              <div className="flex gap-2">
                <Select
                  value={formData.clientId}
                  onValueChange={(value) => handleSelectChange("clientId", value)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Selecione um cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id.toString()}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => setShowClientForm(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Novo
                </Button>
              </div>
            ) : (
              <div className="border rounded-lg p-4 bg-gray-50">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">Novo Cliente</h3>
                  <button type="button" onClick={() => setShowClientForm(false)}>
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Nome *</Label>
                    <Input
                      value={clientForm.name}
                      onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                      placeholder="Nome da empresa"
                    />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={clientForm.email}
                      onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                      placeholder="email@empresa.com"
                    />
                  </div>
                  <div>
                    <Label>Usuário *</Label>
                    <Input
                      value={clientForm.username}
                      onChange={(e) => setClientForm({ ...clientForm, username: e.target.value })}
                      placeholder="usuario_login"
                    />
                  </div>
                  <div>
                    <Label>Senha *</Label>
                    <Input
                      type="password"
                      value={clientForm.password}
                      onChange={(e) => setClientForm({ ...clientForm, password: e.target.value })}
                      placeholder="••••••"
                    />
                  </div>
                  <div>
                    <Label>Telefone</Label>
                    <Input
                      value={clientForm.phone}
                      onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                  <div>
                    <Label>CNPJ/CPF</Label>
                    <Input
                      value={clientForm.cnpjCpf}
                      onChange={(e) => setClientForm({ ...clientForm, cnpjCpf: e.target.value })}
                      placeholder="00.000.000/0000-00"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleCreateClient}
                  className="w-full mt-4 bg-green-600 hover:bg-green-700"
                  disabled={createClientMutation.isPending}
                >
                  {createClientMutation.isPending ? "Criando..." : "Criar Cliente"}
                </Button>
              </div>
            )}
          </Card>

          {/* Técnico Responsável */}
          <Card className="p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Técnico Responsável <span className="text-sm font-normal text-muted-foreground">(opcional)</span></h2>
            <Select
              value={formData.technicianId}
              onValueChange={(value) => handleSelectChange("technicianId", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar técnico..." />
              </SelectTrigger>
              <SelectContent>
                {(techniciansList as any[]).map((t: any) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}{t.specialization ? ` — ${t.specialization}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>

          {/* Detalhes da OS */}
          <Card className="p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Detalhes da OS</h2>
            
            <div className="space-y-4">
              <div>
                <Label>Título *</Label>
                <Input
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  placeholder="Ex: Manutenção de bomba d'água"
                />
              </div>

              <div>
                <Label>Descrição</Label>
                <Textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Descrição detalhada do serviço..."
                  rows={4}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tipo de Serviço</Label>
                  <Input
                    name="serviceType"
                    value={formData.serviceType}
                    onChange={handleInputChange}
                    placeholder="Ex: Manutenção preventiva"
                  />
                </div>
                <div>
                  <Label>Prioridade</Label>
                  <Select
                    value={formData.priority}
                    onValueChange={(value) => handleSelectChange("priority", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="critica">Crítica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Data Agendada</Label>
                  <Input
                    type="date"
                    name="scheduledDate"
                    value={formData.scheduledDate}
                    onChange={handleInputChange}
                  />
                </div>
                <div>
                  <Label>Horas Estimadas</Label>
                  <Input
                    type="number"
                    name="estimatedHours"
                    value={formData.estimatedHours}
                    onChange={handleInputChange}
                    placeholder="0"
                    min="0"
                  />
                </div>
              </div>

            </div>
          </Card>

          {/* Recorrência (apenas para tipo Rotina) */}
          {formData.type === "rotina" && (
            <Card className="p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">Recorrência</h2>
                  <p className="text-sm text-gray-600">Configure a abertura automática mensal</p>
                </div>
                <Switch
                  checked={formData.isRecurring}
                  onCheckedChange={(checked) => setFormData({ ...formData, isRecurring: checked })}
                />
              </div>

              {formData.isRecurring && (
                <div className="space-y-4 pt-4 border-t">
                  <div>
                    <Label>Tipo de Recorrência</Label>
                    <Select
                      value={formData.recurrenceType}
                      onValueChange={(value) => handleSelectChange("recurrenceType", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mensal_inicio">Todo início de mês (dia 1)</SelectItem>
                        <SelectItem value="mensal_fixo">Dia fixo do mês</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.recurrenceType === "mensal_fixo" && (
                    <div>
                      <Label>Dia do Mês</Label>
                      <Select
                        value={formData.recurrenceDay}
                        onValueChange={(value) => handleSelectChange("recurrenceDay", value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                            <SelectItem key={day} value={day.toString()}>
                              Dia {day}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <RefreshCw className="w-4 h-4 inline mr-2" />
                      {formData.recurrenceType === "mensal_inicio"
                        ? "Uma nova OS será criada automaticamente todo dia 1 de cada mês."
                        : `Uma nova OS será criada automaticamente todo dia ${formData.recurrenceDay} de cada mês.`}
                    </p>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Botões */}
          <div className="flex gap-4">
            <Button
              type="submit"
              className="flex-1 bg-orange-500 hover:bg-orange-600 h-12"
              disabled={createWorkOrderMutation.isPending}
            >
              {createWorkOrderMutation.isPending ? "Criando..." : "Criar OS"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/gestor/work-orders")}
              className="flex-1 h-12"
            >
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
