import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, AlertCircle, CheckCircle, Upload, Plus, FileText, Trash2, Wrench, Zap } from "lucide-react";
import { maskCnpjCpf, maskPhone, isValidCnpjCpf, isValidPhone } from "@/lib/masks";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function EditClient() {
  const [, setLocation] = useLocation();

  // Extrai o ID do cliente da URL (/gestor/clientes/editar/123 → 123)
  const pathParts = window.location.pathname.split("/");
  const clientId = Number(pathParts[pathParts.length - 1]) || null;

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    username: "",
    cnpjCpf: "",
    phone: "",
    address: "",
    syndicName: "",
    type: "com_portal" as "com_portal" | "sem_portal",
    newPassword: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // ── Estado do formulário de novo equipamento ─────────────────
  const [newEquipType, setNewEquipType] = useState<"bomba" | "gerador">("bomba");
  const [newEquipDesc, setNewEquipDesc] = useState("");

  // ── Equipamentos do cliente ──────────────────────────────────
  const { data: equipment = [], refetch: refetchEquipment } = trpc.clients.equipment.list.useQuery(
    { clientId: clientId ?? 0 },
    { enabled: !!clientId }
  );

  const addEquipmentMutation = trpc.clients.equipment.add.useMutation({
    onSuccess: (data) => {
      refetchEquipment();
      setNewEquipDesc("");
      const os = data.monthlyOs;
      if (os.osCreated) {
        toast.success(`Equipamento adicionado! OS "${os.titulo}" criada automaticamente.`);
      } else {
        toast.success(`Equipamento adicionado! Checklist incluído na OS "${os.titulo}".`);
      }
    },
    onError: (e: any) => toast.error("Erro ao adicionar equipamento: " + e.message),
  });

  const removeEquipmentMutation = trpc.clients.equipment.remove.useMutation({
    onSuccess: () => { refetchEquipment(); toast.success("Equipamento removido."); },
    onError:   (e: any) => toast.error("Erro ao remover equipamento: " + e.message),
  });

  const handleAddEquipment = () => {
    if (!clientId || !newEquipDesc.trim()) return;
    addEquipmentMutation.mutate({ clientId, type: newEquipType, description: newEquipDesc.trim() });
  };

  // ── Busca dados do cliente e dos laudos associados via tRPC ──────────────────────────
  const { data: client, isLoading, refetch: refetchClient } = trpc.clients.getById.useQuery(
    { id: clientId ?? 0 },
    { enabled: !!clientId }
  );

  // Popula o formulário quando os dados chegam — sem causar loop
  useEffect(() => {
    if (!client) return;
    setFormData({
      name: client.name ?? "",
      email: client.email ?? "",
      username: client.username ?? "",
      cnpjCpf: client.cnpjCpf ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
      syndicName: client.syndicName ?? "",
      type: (client.type === "sem_portal" ? "sem_portal" : "com_portal"),
      newPassword: "",
    });
  }, [client]);

  // Busca todos os laudos vinculados a este cliente para exibir na ficha
  const { data: laudosCliente = [] } = trpc.laudos.list.useQuery(
    { clienteId: clientId ?? 0 },
    { enabled: !!clientId, staleTime: 30_000 }
  );

  // ── Mutations via tRPC ───────────────────────────────────────
  const updateMutation = trpc.clients.update.useMutation();
  const updatePasswordMutation = trpc.clients.updatePassword.useMutation();
  const uploadPhotoMutation = trpc.clientProfile.uploadPhoto.useMutation({
    onSuccess: (data: any) => {
      toast.success("Foto atualizada!");
      refetchClient();
      setPhotoPreview(null);
    },
    onError: (e: any) => toast.error("Erro ao enviar foto: " + e.message),
  });

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem muito grande. Máximo 5MB."); return; }
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleUploadPhoto = async () => {
    if (!clientId || !photoPreview) return;
    await uploadPhotoMutation.mutateAsync({ clientId, imageBase64: photoPreview });
  };

  // ── Submit ───────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!clientId) { setError("ID do cliente não encontrado"); return; }
    if (!formData.name.trim()) { setError("Nome é obrigatório"); return; }
    if (formData.cnpjCpf && !isValidCnpjCpf(formData.cnpjCpf)) { setError("CNPJ/CPF inválido"); return; }
    if (formData.phone && !isValidPhone(formData.phone)) { setError("Telefone inválido"); return; }

    try {
      // Atualiza dados principais
      await updateMutation.mutateAsync({
        id: clientId,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        address: formData.address,
        cnpjCpf: formData.cnpjCpf,
        syndicName: formData.syndicName,
        type: formData.type,
      });

      // Atualiza senha separadamente só se foi preenchida
      if (formData.newPassword.trim()) {
        await updatePasswordMutation.mutateAsync({
          id: clientId,
          newPassword: formData.newPassword,
        });
      }

      setSuccess("Cliente atualizado com sucesso!");
      setTimeout(() => setLocation("/gestor/clientes"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar cliente");
    }
  };

  // ── Loading state ────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
          <p className="text-slate-600">Carregando dados do cliente...</p>
        </div>
      </div>
    );
  }

  if (!client && !isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Cliente não encontrado.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isSaving = updateMutation.isPending || updatePasswordMutation.isPending;
  const isFormValid =
    formData.name.trim() !== "" &&
    (formData.cnpjCpf === "" || isValidCnpjCpf(formData.cnpjCpf)) &&
    (formData.phone === "" || isValidPhone(formData.phone));

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="mb-4">
        <Button
          variant="ghost"
          onClick={() => setLocation("/gestor/clientes")}
          className="gap-2 text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Clientes
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-slate-900">Editar Cliente</h1>
        <p className="text-slate-600 mt-1">Atualize os dados do cliente</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informações do Cliente</CardTitle>
          <CardDescription>Preencha os campos para atualizar os dados</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Foto de Perfil */}
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
              {photoPreview || (client as any)?.profilePhoto ? (
                <img
                  src={photoPreview || (client as any)?.profilePhoto}
                  alt="Foto"
                  className="w-16 h-16 rounded-full object-cover ring-2 ring-amber-400"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-amber-500 flex items-center justify-center text-xl font-bold text-white">
                  {(client?.name || "?").slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium">Foto de Perfil</p>
                <div className="flex gap-2 flex-wrap">
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
                    <span className="inline-flex items-center gap-1.5 text-xs border border-slate-300 rounded px-2.5 py-1.5 hover:bg-white transition-colors cursor-pointer">
                      <Upload className="w-3.5 h-3.5" /> Selecionar foto
                    </span>
                  </label>
                  {photoPreview && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
                      onClick={handleUploadPhoto}
                      disabled={uploadPhotoMutation.isPending}
                    >
                      {uploadPhotoMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Enviar para Cloudinary"}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-400">Máximo 5MB. JPG, PNG ou WebP.</p>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">{success}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Nome */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome *</label>
                <Input
                  placeholder="Nome completo ou razão social"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              {/* Nome do Síndico */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome do Síndico</label>
                <Input
                  placeholder="Nome do síndico responsável"
                  value={formData.syndicName}
                  onChange={(e) => setFormData({ ...formData, syndicName: e.target.value })}
                />
              </div>

              {/* E-mail */}
              <div className="space-y-2">
                <label className="text-sm font-medium">E-mail (opcional)</label>
                <Input
                  type="email"
                  placeholder="cliente@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              {/* Nome de Usuário */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome de Usuário</label>
                <Input
                  placeholder="nome_usuario"
                  value={formData.username}
                  disabled // username não é editável para evitar quebrar o login
                  className="bg-slate-50 text-slate-500"
                />
                <p className="text-xs text-slate-400">O nome de usuário não pode ser alterado</p>
              </div>

              {/* CNPJ/CPF */}
              <div className="space-y-2">
                <label className="text-sm font-medium">CNPJ/CPF</label>
                <Input
                  placeholder="00.000.000/0000-00"
                  value={formData.cnpjCpf}
                  onChange={(e) => setFormData({ ...formData, cnpjCpf: maskCnpjCpf(e.target.value) })}
                />
                {formData.cnpjCpf && !isValidCnpjCpf(formData.cnpjCpf) && (
                  <p className="text-xs text-red-500">CNPJ/CPF inválido</p>
                )}
              </div>

              {/* Telefone */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Telefone</label>
                <Input
                  placeholder="(11) 98765-4321"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                />
                {formData.phone && !isValidPhone(formData.phone) && (
                  <p className="text-xs text-red-500">Telefone inválido</p>
                )}
              </div>

              {/* Endereço */}
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Endereço (opcional)</label>
                <Input
                  placeholder="Rua, número, complemento"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              {/* Tipo */}
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Tipo de Cliente</label>
                <Select
                  value={formData.type}
                  onValueChange={(value: "com_portal" | "sem_portal") =>
                    setFormData({ ...formData, type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="com_portal">Com Portal (Acesso ao painel)</SelectItem>
                    <SelectItem value="sem_portal">Sem Portal (Apenas cadastro)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Nova Senha */}
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Nova Senha (opcional)</label>
                <PasswordInput
                  placeholder="Deixe em branco para manter a senha atual"
                  value={formData.newPassword}
                  onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                />
                <p className="text-xs text-slate-500">
                  Preencha apenas se quiser alterar a senha do cliente
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                className="bg-orange-500 hover:bg-orange-600"
                disabled={isSaving || !isFormValid}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar Alterações"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/gestor/clientes")}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Seção de Equipamentos do Cliente ─────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Equipamentos
          </CardTitle>
          <CardDescription>
            Bombas e geradores cadastrados. Para cada equipamento será gerado um checklist
            na OS mensal automática de vistoria.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Lista de equipamentos existentes */}
          {equipment.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              Nenhum equipamento cadastrado.
            </p>
          ) : (
            <div className="divide-y rounded-lg border overflow-hidden">
              {(equipment as any[]).map((equip: any) => (
                <div key={equip.id} className="flex items-center justify-between px-3 py-2.5 bg-white">
                  <div className="flex items-center gap-2.5">
                    {equip.type === "gerador" ? (
                      <Zap className="h-4 w-4 text-amber-500 shrink-0" />
                    ) : (
                      <Wrench className="h-4 w-4 text-blue-500 shrink-0" />
                    )}
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 mr-2">
                        {equip.type === "gerador" ? "Gerador" : "Bomba"}
                      </span>
                      <span className="text-sm text-slate-800">{equip.description}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEquipmentMutation.mutate({ id: equip.id })}
                    disabled={removeEquipmentMutation.isPending}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded"
                    title="Remover equipamento"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Formulário inline para adicionar equipamento */}
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Select
              value={newEquipType}
              onValueChange={(v: "bomba" | "gerador") => setNewEquipType(v)}
            >
              <SelectTrigger className="w-full sm:w-36 h-10 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bomba">Bomba</SelectItem>
                <SelectItem value="gerador">Gerador</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Descrição / Localização (ex: Torre 1 - Subsolo)"
              value={newEquipDesc}
              onChange={(e) => setNewEquipDesc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddEquipment()}
              className="h-10 flex-1"
            />
            <Button
              type="button"
              onClick={handleAddEquipment}
              disabled={addEquipmentMutation.isPending || !newEquipDesc.trim()}
              className="h-10 bg-orange-500 hover:bg-orange-600 shrink-0"
            >
              {addEquipmentMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <><Plus className="h-4 w-4 mr-1" />Adicionar</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Seção de Laudos Técnicos do Cliente ──────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Laudos Técnicos
            </CardTitle>
            <CardDescription>
              Laudos associados a este cliente
            </CardDescription>
          </div>
          {/* Botão para criar novo laudo pré-vinculado a este cliente */}
          <Button
            size="sm"
            onClick={() => setLocation(`/gestor/laudos/novo?clienteId=${clientId}`)}
            className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Novo laudo</span>
          </Button>
        </CardHeader>
        <CardContent>
          {(laudosCliente as any[]).length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              Nenhum laudo técnico cadastrado para este cliente.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="pb-2 pr-4">Número</th>
                    <th className="pb-2 pr-4">Tipo</th>
                    <th className="pb-2 pr-4 hidden sm:table-cell">Título</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(laudosCliente as any[]).map((laudo: any) => (
                    <tr
                      key={laudo.id}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => setLocation(`/gestor/laudos/${laudo.id}`)}
                    >
                      <td className="py-2.5 pr-4 font-mono text-xs font-medium text-orange-700">
                        {laudo.numero ?? `#${laudo.id}`}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-slate-600 whitespace-nowrap">
                        {laudo.tipo === "instalacao_eletrica" ? "Instalação Elétrica" :
                         laudo.tipo === "inspecao_predial" ? "Inspeção Predial" :
                         laudo.tipo === "nr10_nr12" ? "NR-10/12" :
                         laudo.tipo === "grupo_gerador" ? "Grupo Gerador" : "Adequações"}
                      </td>
                      <td className="py-2.5 pr-4 hidden sm:table-cell text-slate-700 max-w-[200px] truncate">
                        {laudo.titulo}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge className={`text-[11px] px-2 py-0.5 ${
                          laudo.status === "rascunho"   ? "bg-slate-100 text-slate-700" :
                          laudo.status === "finalizado" ? "bg-blue-100 text-blue-800" :
                          laudo.status === "enviado"    ? "bg-green-100 text-green-800" :
                                                          "bg-red-100 text-red-700"
                        }`}>
                          {laudo.status === "rascunho"   ? "Rascunho" :
                           laudo.status === "finalizado" ? "Finalizado" :
                           laudo.status === "enviado"    ? "Enviado" : "Cancelado"}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-xs text-slate-500 whitespace-nowrap">
                        {laudo.dataInspecao
                          ? new Date(laudo.dataInspecao).toLocaleDateString("pt-BR")
                          : laudo.createdAt
                          ? new Date(laudo.createdAt).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
